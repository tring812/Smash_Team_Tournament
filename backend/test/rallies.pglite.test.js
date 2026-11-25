'use strict';
/**
 * Biên bản diễn biến điểm (PGlite): thêm / hoàn tác sự kiện, chống 2 máy cùng bấm, quyền, BTC sửa tay,
 * xác nhận kết quả, nhật ký chỉ ghi sửa người giao / hoàn tác / xác nhận.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');
const categorySvc = require('../src/services/categoryService');
const entrySvc = require('../src/services/entryService');
const matchSvc = require('../src/services/matchService');
const rallies = require('../src/services/rallyService');
const { beginMatch } = require('./support/match');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000d1', full_name: 'Admin', role: 'admin' };
const REF = { id: '00000000-0000-4000-8000-0000000000d2', full_name: 'Trọng tài', role: 'user' };
const OUTSIDER = { id: '00000000-0000-4000-8000-0000000000d3', full_name: 'Người ngoài', role: 'user' };
const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

async function rejectsWith(p, status, code) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

describe('Biên bản diễn biến điểm (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  /** @type {any} */ let t;
  /** @type {any} */ let match;

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    for (const u of [ADMIN, REF, OUTSIDER]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
    t = await svc.createTournament(pool, ADMIN, { slug: 'rally-cup', name: 'Rally Cup', startsAt: future(7), courts: 2 });
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    const md = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'MD', name: 'Đôi nam', isDoubles: true, groupCount: 1, advancePerGroup: 1 });
    await entrySvc.addEntries(pool, ADMIN, md.id, [
      { player1Name: 'Phạm Vũ Chí Cường', player2Name: 'Phạm Thị Hiếu' },
      { player1Name: 'Phạm Thiên Phúc', player2Name: 'Phạm Tú Hằng' },
    ]);
    await svc.drawGroups(pool, ADMIN, md.id);
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
    match = (await matchSvc.listMatches(pool, t.id))[0];
    match = await beginMatch(pool, ADMIN, REF, match);
  });
  after(async () => { await pool?.end(); });

  const add = (viewer, body) => rallies.addRally(pool, viewer, match.id, body);

  test('người ngoài không ghi được; điểm trước khi chọn người giao bị từ chối', async () => {
    await rejectsWith(add(OUTSIDER, { type: 'start', server: 'a2', receiver: 'b2', expectedSeq: 1 }), 403);
    await rejectsWith(add(REF, { type: 'point', side: 'a', expectedSeq: 1 }), 422);
  });

  test('chọn người giao / nhận rồi bấm điểm: máy chủ tính tỉ số, người giao; games cập nhật cùng lúc', async () => {
    await add(REF, { type: 'start', server: 'a2', receiver: 'b2', expectedSeq: 1 });
    await add(REF, { type: 'point', side: 'a', expectedSeq: 2 });
    await add(REF, { type: 'point', side: 'b', expectedSeq: 3 });
    const m = await matchSvc.getMatch(pool, match.id);
    assert.deepEqual(m.games, [[1, 1]]);
    assert.equal(m.status, 'live');
    const list = await rallies.listRallies(pool, match.id);
    assert.deepEqual(list.map((e) => e.type), ['start', 'point', 'point']);
    assert.deepEqual(list[2].score, [1, 1]);
    assert.equal(list[2].server, 'b1', '1 lẻ → ô trái của đội b là Phúc (Hằng nhận ở ô phải)');
    assert.ok(!('created_by' in list[0]) && !('by' in list[0]), 'không lộ người bấm ra công khai');
  });

  test('2 máy cùng bấm: expectedSeq lệch → 409 RALLY_CONFLICT, không ghi gì', async () => {
    await rejectsWith(add(REF, { type: 'point', side: 'a', expectedSeq: 3 }), 409, 'RALLY_CONFLICT');
    assert.equal((await rallies.listRallies(pool, match.id)).length, 3);
  });

  test('hoàn tác xoá sự kiện cuối (đúng seq), tính lại tỉ số; nhật ký ghi hoàn tác', async () => {
    await rejectsWith(rallies.undoRally(pool, REF, match.id, 2), 409, 'RALLY_CONFLICT');
    await rallies.undoRally(pool, REF, match.id, 3);
    assert.deepEqual((await matchSvc.getMatch(pool, match.id)).games, [[1, 0]]);
    const actions = (await svc.listEvents(pool, ADMIN, t.id)).map((e) => e.action);
    assert.ok(actions.includes('rally_undo'));
  });

  test('sửa người giao: ghi nhật ký kèm tên; điểm không ghi nhật ký', async () => {
    await add(REF, { type: 'fix_server', server: 'a1', expectedSeq: 3 });
    const evs = await svc.listEvents(pool, ADMIN, t.id);
    const fix = evs.find((e) => e.action === 'rally_fix_server');
    // Ô a1 = VĐV 1 của đội a — đội nào là a tuỳ kết quả bốc thăm ngẫu nhiên.
    assert.equal(fix.details.name, (await matchSvc.getMatch(pool, match.id)).a.players[0].name);
    assert.ok(!evs.some((e) => e.action === 'rally_point'));
  });

  test('BTC sửa tay tỉ số khác biên bản → mốc override; xác nhận → nhật ký; trận xong thì khoá biên bản', async () => {
    const m = await matchSvc.getMatch(pool, match.id);
    await matchSvc.recordScore(pool, ADMIN, match.id, { action: 'save', version: m.version, games: [[20, 5]] });
    const list = await rallies.listRallies(pool, match.id);
    assert.equal(list[list.length - 1].type, 'override');
    assert.deepEqual(list[list.length - 1].games, [[20, 5]]);
    // Điểm tiếp theo tính từ bản sửa.
    await add(REF, { type: 'point', side: 'a', expectedSeq: list.length + 1 });
    let fresh = await matchSvc.getMatch(pool, match.id);
    assert.deepEqual(fresh.games, [[21, 5]]);
    // Game 2: chọn lại người giao / nhận.
    const seq = (await rallies.listRallies(pool, match.id)).length + 1;
    await add(REF, { type: 'start', server: 'b2', receiver: 'a1', expectedSeq: seq });
    for (let i = 0; i < 21; i += 1) await add(REF, { type: 'point', side: 'a', expectedSeq: seq + 1 + i });
    fresh = await matchSvc.getMatch(pool, match.id);
    assert.deepEqual(fresh.games, [[21, 5], [21, 0]]);
    await matchSvc.recordScore(pool, REF, match.id, { action: 'finish', version: fresh.version, games: fresh.games });
    const confirm = (await svc.listEvents(pool, ADMIN, t.id)).find((e) => e.action === 'score_confirm');
    assert.equal(confirm.details.winner, 'a');
    const n = (await rallies.listRallies(pool, match.id)).length;
    assert.equal((await rallies.listRallies(pool, match.id)).filter((e) => e.type === 'override').length, 1, 'xác nhận đúng tỉ số biên bản không thêm mốc sửa');
    await rejectsWith(add(REF, { type: 'point', side: 'a', expectedSeq: n + 1 }), 409, 'MATCH_CLOSED');
    await rejectsWith(rallies.undoRally(pool, REF, match.id, n), 409, 'MATCH_CLOSED');
  });

  test('giải đã kết thúc: không ghi biên bản', async () => {
    await matchSvc.reopenMatch(pool, ADMIN, match.id);
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'completed' });
    const n = (await rallies.listRallies(pool, match.id)).length;
    await rejectsWith(add(REF, { type: 'point', side: 'b', expectedSeq: n + 1 }), 409, 'TOURNAMENT_CLOSED');
  });
});

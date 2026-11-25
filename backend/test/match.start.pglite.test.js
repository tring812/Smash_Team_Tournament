'use strict';
/** Bắt đầu trận nhận sân độc quyền; chỉ giải phóng sân khi xác nhận hoàn thành hoặc bỏ cuộc. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const svc = require('../src/services/tournamentService');
const courts = require('../src/services/courtService');
const rallies = require('../src/services/rallyService');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }
const ADMIN = { id: '00000000-0000-4000-8000-0000000000a1', full_name: 'Admin thử nghiệm', role: 'admin' };
const REF = { id: '00000000-0000-4000-8000-0000000000a2', full_name: 'Trọng tài thử nghiệm', role: 'user' };
const OTHER = { id: '00000000-0000-4000-8000-0000000000a3', full_name: 'Người ngoài', role: 'user' };
async function rejectsWith(promise, code, status = 409) {
  await assert.rejects(promise, (err) => err.status === status && err.code === code);
}

describe('Bắt đầu và hoàn thành trận (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  let sequence = 0;
  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    const dir = path.join(__dirname, '..', 'migrations');
    for (const f of fs.readdirSync(dir).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const u of [ADMIN, REF, OTHER]) await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
  });
  after(async () => { await pool?.end(); });

  async function fixture() {
    const t = await svc.createTournament(pool, ADMIN, { slug: `start-${++sequence}`, name: 'Giải thử bắt đầu trận', startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), courts: 2 });
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    const cat = await svc.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 1 });
    await svc.addEntries(pool, ADMIN, cat.id, ['An', 'Bình', 'Chi', 'Dũng'].map((player1Name) => ({ player1Name })));
    await svc.drawGroups(pool, ADMIN, cat.id);
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
    const matches = await svc.listMatches(pool, t.id);
    const a = matches[0];
    const b = matches.find((m) => ![a.a.id, a.b.id].includes(m.a.id) && ![a.a.id, a.b.id].includes(m.b.id));
    return { t, cat, a, b };
  }
  async function assign(mid, court) {
    await courts.moveMatch(pool, ADMIN, mid, { court });
    return svc.getMatch(pool, mid);
  }
  async function start(mid, viewer = REF) {
    const m = await svc.getMatch(pool, mid);
    await svc.startMatch(pool, viewer, mid, { version: m.version });
    return svc.getMatch(pool, mid);
  }

  test('chưa bắt đầu: chặn lưu điểm, biên bản, hoàn tác và xác nhận kết quả', async () => {
    const { a } = await fixture();
    const m = await assign(a.id, 1);
    await rejectsWith(svc.recordScore(pool, REF, m.id, { action: 'save', version: m.version, games: [[1, 0]] }), 'MATCH_NOT_STARTED');
    await rejectsWith(rallies.addRally(pool, REF, m.id, { type: 'start', server: 'a1', expectedSeq: 1 }), 'MATCH_NOT_STARTED');
    await rejectsWith(rallies.undoRally(pool, REF, m.id, 1), 'MATCH_NOT_STARTED');
    await rejectsWith(svc.recordScore(pool, REF, m.id, { action: 'finish', version: m.version, games: [[21, 0], [21, 0]] }), 'MATCH_NOT_STARTED');
    assert.deepEqual(await svc.getMatch(pool, m.id), m);
    assert.deepEqual(await rallies.listRallies(pool, m.id), []);
  });

  test('không có sân: yêu cầu BTC gán sân trước', async () => {
    const { a } = await fixture();
    await rejectsWith(start(a.id), 'COURT_REQUIRED');
    assert.equal((await svc.getMatch(pool, a.id)).status, 'pending');
  });

  test('sân rảnh: bắt đầu được dù chưa gọi; giữ giờ dự kiến và chưa tạo pha cầu', async () => {
    const { t, a } = await fixture();
    const before = await assign(a.id, 1);
    const m = await start(a.id);
    assert.equal(m.status, 'live');
    assert.equal(m.version, before.version + 1);
    assert.equal(m.scheduledAt, before.scheduledAt);
    assert.ok(m.courtSince);
    assert.equal(m.referee.id, REF.id);
    assert.deepEqual(m.games, []);
    assert.deepEqual(await rallies.listRallies(pool, a.id), []);
    assert.equal((await svc.getTournament(pool, t.slug, ADMIN)).status, 'ongoing');
    assert.ok((await svc.listEvents(pool, ADMIN, t.id)).some((e) => e.action === 'start_match'));
  });

  test('trận đã được BTC gọi vào sân có thể bắt đầu, giữ thời điểm gọi', async () => {
    const { a } = await fixture();
    await courts.callMatch(pool, ADMIN, a.id, { court: 1 });
    const before = await svc.getMatch(pool, a.id);
    const m = await start(a.id);
    assert.deepEqual(m.courtSince, before.courtSince);
  });

  for (const mode of ['called', 'live']) {
    test(`chặn bắt đầu ở sân có trận ${mode === 'live' ? 'đang đánh' : 'đã gọi'}`, async () => {
      const { a, b } = await fixture();
      await assign(b.id, 1);
      await courts.callMatch(pool, ADMIN, a.id, { court: 1 });
      if (mode === 'live') await start(a.id);
      await rejectsWith(start(b.id), 'COURT_BUSY');
      assert.equal((await svc.getMatch(pool, b.id)).status, 'pending');
    });
  }

  test('chặn VĐV đang ở nội dung khác dù sân mới trống', async () => {
    const { t, a } = await fixture();
    const cat = await svc.createCategory(pool, ADMIN, t.id, { code: 'XD', name: 'Đôi nam nữ', isDoubles: true, groupCount: 1 });
    await svc.addEntries(pool, ADMIN, cat.id, [
      { player1Name: 'Hoa', player2Name: a.a.name }, { player1Name: 'Lan', player2Name: 'Mai' },
    ]);
    await svc.drawGroups(pool, ADMIN, cat.id);
    const b = (await svc.listMatches(pool, t.id)).find((m) => m.category.id === cat.id);
    await assign(a.id, 1);
    await assign(b.id, 2);
    await start(a.id);
    await rejectsWith(start(b.id), 'PLAYER_BUSY');
  });

  test('đủ điểm chưa giải phóng sân; hoàn thành hợp lệ mới cho trận khác bắt đầu', async () => {
    const { a, b } = await fixture();
    await assign(a.id, 1);
    await assign(b.id, 1);
    let m = await start(a.id);
    await rejectsWith(svc.recordScore(pool, REF, m.id, { action: 'finish', version: m.version, games: [[1, 0]] }), 'VALIDATION_FAILED', 422);
    await svc.recordScore(pool, REF, m.id, { action: 'save', version: m.version, games: [[21, 0], [21, 0]] });
    await rejectsWith(start(b.id), 'COURT_BUSY');
    m = await svc.getMatch(pool, m.id);
    await svc.recordScore(pool, REF, m.id, { action: 'finish', version: m.version, games: m.games });
    assert.equal((await start(b.id)).status, 'live');
  });

  test('hai yêu cầu nhận cùng sân chỉ có một yêu cầu thành công', async () => {
    const { a, b } = await fixture();
    await assign(a.id, 1);
    await assign(b.id, 1);
    const results = await Promise.allSettled([start(a.id), start(b.id)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'COURT_BUSY');
  });

  test('quyền: người ngoài và trọng tài khác phân công không được bắt đầu', async () => {
    const { t, a } = await fixture();
    await assign(a.id, 1);
    await rejectsWith(start(a.id, OTHER), 'FORBIDDEN', 403);
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: OTHER.id, role: 'referee' });
    await svc.assignReferee(pool, ADMIN, a.id, OTHER.id);
    await rejectsWith(start(a.id), 'FORBIDDEN', 403);
    assert.equal((await start(a.id, OTHER)).status, 'live');
  });

  test('phiên bản cũ và giải đã kết thúc không được bắt đầu', async () => {
    const { t, a } = await fixture();
    const m = await assign(a.id, 1);
    await rejectsWith(svc.startMatch(pool, REF, a.id, { version: m.version - 1 }), 'VERSION_CONFLICT');
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'completed' });
    await rejectsWith(start(a.id), 'TOURNAMENT_CLOSED');
  });

  test('giữ luồng xử bỏ cuộc trước khi bắt đầu, không nhận sân', async () => {
    const { a } = await fixture();
    await svc.recordScore(pool, REF, a.id, { action: 'walkover', version: a.version, walkoverWinner: 'a' });
    assert.equal((await svc.getMatch(pool, a.id)).status, 'walkover');
  });
});

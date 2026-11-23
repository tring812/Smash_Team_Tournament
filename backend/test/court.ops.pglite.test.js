'use strict';
/**
 * Điều phối theo sân (PGlite): gợi ý trận kế tiếp, gọi / rút trận, chống 1 VĐV ở 2 sân (kể cả khác nội dung),
 * dời giờ/sân một trận, trọng tài phụ trách sân, VĐV vừa đánh xong được nghỉ.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');
const courts = require('../src/services/courtService');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000c1', full_name: 'Admin', role: 'admin' };
const REF = { id: '00000000-0000-4000-8000-0000000000c2', full_name: 'TT Sân 2', role: 'user' };
const REF2 = { id: '00000000-0000-4000-8000-0000000000c3', full_name: 'TT khác', role: 'user' };
const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

async function rejectsWith(p, status, code) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

describe('Điều phối sân (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  /** @type {any} */ let t;
  /** @type {any} */ let ms;
  /** @type {any} */ let ws;

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    for (const u of [ADMIN, REF, REF2]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
    t = await svc.createTournament(pool, ADMIN, { slug: 'court-cup', name: 'Court Cup', startsAt: future(7), courts: 4 });
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF2.id, role: 'referee' });
    ms = await svc.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 1, advancePerGroup: 1 });
    ws = await svc.createCategory(pool, ADMIN, t.id, { code: 'XS', name: 'Đơn phụ', isDoubles: false, groupCount: 1, advancePerGroup: 1 });
    await svc.addEntries(pool, ADMIN, ms.id, ['An', 'Bình', 'Chi', 'Dũng'].map((n) => ({ player1Name: n })));
    // "an" (khác hoa thường) cũng đánh nội dung khác → cùng một người với "An".
    await svc.addEntries(pool, ADMIN, ws.id, ['an', 'Khoa', 'Long'].map((n) => ({ player1Name: n })));
    await svc.drawGroups(pool, ADMIN, ms.id);
    await svc.drawGroups(pool, ADMIN, ws.id);
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
  });
  after(async () => { await pool?.end(); });

  const board = () => courts.courtBoard(pool, ADMIN, t.id);
  const matchesOf = async () => svc.listMatches(pool, t.id);
  const names = (m) => [m.a.name.toLowerCase(), m.b.name.toLowerCase()];

  test('gợi ý: mỗi sân trống 1 trận, không 2 gợi ý nào chung VĐV', async () => {
    const b = await board();
    assert.equal(b.courts.length, 4);
    const all = await matchesOf();
    const picked = b.courts.map((c) => c.suggestionId).filter(Boolean).map((id) => all.find((m) => m.id === id));
    assert.ok(picked.length >= 2, 'ít nhất 2 sân có gợi ý');
    const people = picked.flatMap(names);
    assert.equal(new Set(people).size, people.length, `gợi ý trùng VĐV: ${people}`);
    assert.equal(b.queue.length, 9);
  });

  test('gọi trận: sân bận, VĐV bận (kể cả khác nội dung) bị chặn; rút trận trả về hàng chờ', async () => {
    const all = await matchesOf();
    const msA = all.find((m) => m.category.code === 'MS' && names(m).includes('an'));
    await courts.callMatch(pool, ADMIN, msA.id, { court: 1 });
    const called = await svc.getMatch(pool, msA.id);
    assert.equal(called.court, 1);
    assert.ok(called.calledAt);

    const other = all.find((m) => m.category.code === 'MS' && !names(m).includes('an') && m.id !== msA.id
      && !names(m).some((n) => names(msA).includes(n)));
    await rejectsWith(courts.callMatch(pool, ADMIN, other.id, { court: 1 }), 409, 'COURT_BUSY');

    const wsAn = all.find((m) => m.category.code === 'XS' && names(m).includes('an'));
    await rejectsWith(courts.callMatch(pool, ADMIN, wsAn.id, { court: 3 }), 409, 'PLAYER_BUSY');
    await rejectsWith(courts.callMatch(pool, ADMIN, other.id, { court: 9 }), 422);

    const b = await board();
    assert.equal(b.courts[0].current.id, msA.id);
    assert.ok(b.queue.find((q) => q.match.id === wsAn.id).busyWith.some((x) => x.court === 1));

    await courts.uncallMatch(pool, ADMIN, msA.id);
    assert.equal((await svc.getMatch(pool, msA.id)).calledAt, null);
    await rejectsWith(courts.uncallMatch(pool, ADMIN, msA.id), 409, 'NOT_CALLED');
    await courts.callMatch(pool, ADMIN, wsAn.id, { court: 3 }); // giờ "an" rảnh → gọi được
    await courts.uncallMatch(pool, ADMIN, wsAn.id);
  });

  /** Một trận chờ có giờ + sân dự kiến (dời bằng moveMatch). */
  async function plannedMatch(days, court) {
    const m = (await board()).queue.find((q) => !q.busyWith.length).match;
    await courts.moveMatch(pool, ADMIN, m.id, { scheduledAt: future(days), court });
    return svc.getMatch(pool, m.id);
  }

  test('gọi trận không ghi đè giờ / sân dự kiến; rút về trả lại sân dự kiến', async () => {
    const planned = await plannedMatch(5, 2);
    const m = planned;
    const other = planned.court === 1 ? 2 : 1; // mọi sân đang trống ở bước này
    await courts.callMatch(pool, ADMIN, m.id, { court: other });
    const called = await svc.getMatch(pool, m.id);
    assert.equal(called.court, other);
    assert.equal(new Date(called.scheduledAt).toISOString(), new Date(planned.scheduledAt).toISOString(), 'giờ dự kiến giữ nguyên');
    assert.equal(called.status, planned.status);
    assert.ok(called.calledAt);
    await courts.uncallMatch(pool, ADMIN, m.id);
    const back = await svc.getMatch(pool, m.id);
    assert.equal(back.court, planned.court, 'về lại sân dự kiến');
    assert.equal(new Date(back.scheduledAt).toISOString(), new Date(planned.scheduledAt).toISOString());
    assert.equal(back.calledAt, null);
    await courts.moveMatch(pool, ADMIN, m.id, { scheduledAt: null, court: null }); // trả lại như cũ cho các test sau
  });

  test('migration 009 sửa trận đã bị gọi ghi đè giờ / sân (dữ liệu cũ)', async () => {
    const planned = await plannedMatch(6, 3);
    const m = planned;
    // Giả lập bản cũ: gọi vào sân khác → scheduled_at = giờ gọi, rồi rút về (called_at = NULL, sân vẫn là sân gọi).
    const callAt = new Date();
    const wrongCourt = planned.court === 4 ? 3 : 4;
    await pool.query(
      `INSERT INTO tournament_events (tournament_id, category_id, actor_user_id, action, details, created_at)
       VALUES ($1, $2, $3, 'call_match', $4::jsonb, $5)`,
      [t.id, planned.category.id, ADMIN.id, JSON.stringify({ matchId: m.id, court: wrongCourt, fromCourt: planned.court, plannedAt: planned.scheduledAt }), callAt.toISOString()],
    );
    await pool.query("UPDATE matches SET scheduled_at = $2, court = $3, status = 'scheduled', called_at = NULL WHERE id = $1",
      [m.id, callAt.toISOString(), wrongCourt]);
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '009_planned_court.sql'), 'utf8'));
    const fixed = await svc.getMatch(pool, m.id);
    assert.equal(new Date(fixed.scheduledAt).toISOString(), new Date(planned.scheduledAt).toISOString());
    assert.equal(fixed.court, planned.court);
    // Chạy lại không đổi gì (idempotent).
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '009_planned_court.sql'), 'utf8'));
    assert.equal(new Date((await svc.getMatch(pool, m.id)).scheduledAt).toISOString(), new Date(planned.scheduledAt).toISOString());
    await courts.moveMatch(pool, ADMIN, m.id, { scheduledAt: null, court: null });
  });

  test('trọng tài phụ trách sân: chỉ người đó (hoặc trọng tài gán riêng) nhập điểm trận ở sân', async () => {
    await courts.setCourtReferee(pool, ADMIN, t.id, 2, REF.id);
    const m = (await board()).queue.find((q) => !q.busyWith.length).match;
    await courts.callMatch(pool, ADMIN, m.id, { court: 2 });
    const fresh = await svc.getMatch(pool, m.id);
    await rejectsWith(svc.recordScore(pool, REF2, m.id, { action: 'save', version: fresh.version, games: [[1, 0]] }), 403);
    const q = await svc.refereeQueue(pool, REF);
    assert.equal(q[0].id, m.id, 'trận ở sân mình lên đầu hàng đợi');
    assert.ok(!(await svc.refereeQueue(pool, REF2)).some((x) => x.id === m.id));
    await svc.recordScore(pool, REF, m.id, { action: 'save', version: fresh.version, games: [[1, 0]] });
    await rejectsWith(courts.uncallMatch(pool, ADMIN, m.id), 409, 'NOT_CALLED'); // đã có điểm → không rút
    await rejectsWith(courts.setCourtReferee(pool, ADMIN, t.id, 1, '00000000-0000-4000-8000-0000000000ff'), 422);
  });

  test('chuyển sân trận đang đánh; không đổi giờ trận đang ở sân; dời giờ trận chờ bị chặn khi VĐV trùng khung', async () => {
    const live = (await matchesOf()).find((m) => m.status === 'live');
    await courts.moveMatch(pool, ADMIN, live.id, { court: 4 });
    assert.equal((await svc.getMatch(pool, live.id)).court, 4);
    await rejectsWith(courts.moveMatch(pool, ADMIN, live.id, { scheduledAt: future(1) }), 422);

    const waiting = (await matchesOf()).filter((m) => ['pending', 'scheduled'].includes(m.status) && !m.calledAt);
    const [x, y] = waiting.filter((m) => m.category.code === 'MS' && names(m).includes('bình'));
    const at = future(2);
    await courts.moveMatch(pool, ADMIN, x.id, { scheduledAt: at, court: 1 });
    const moved = await svc.getMatch(pool, x.id);
    assert.equal(moved.status, 'scheduled');
    assert.equal(new Date(moved.scheduledAt).toISOString(), at);
    await rejectsWith(courts.moveMatch(pool, ADMIN, y.id, { scheduledAt: at, court: 2 }), 409, 'PLAYER_TAKEN');
    const z = waiting.find((m) => !names(m).some((n) => names(x).includes(n)));
    await rejectsWith(courts.moveMatch(pool, ADMIN, z.id, { scheduledAt: at, court: 1 }), 409, 'COURT_TAKEN');
  });

  test('đánh xong → sân trống; VĐV vừa đánh được ghi đang nghỉ; nhật ký có thao tác điều phối', async () => {
    const live = (await matchesOf()).find((m) => m.status === 'live');
    await svc.recordScore(pool, REF, live.id, { action: 'finish', version: live.version, games: [[21, 10], [21, 12]] });
    const b = await board();
    assert.equal(b.courts[3].current, null);
    const resting = b.queue.filter((q) => q.restingMinutes > 0).map((q) => q.match.id);
    assert.ok(resting.length > 0);
    // Gợi ý tham lam theo từng sân, không 2 gợi ý chung VĐV: sân nào gợi ý trận có VĐV đang nghỉ thì lúc đó
    // KHÔNG được còn trận nào không ai nghỉ, không ai bận, chưa gợi ý và không chung VĐV với các gợi ý trước.
    const byId = new Map(b.queue.map((q) => [q.match.id, q]));
    const takenIds = new Set();
    const takenPeople = new Set();
    for (const c of b.courts) {
      const q = c.suggestionId ? byId.get(c.suggestionId) : null;
      if (!q) continue;
      if (q.restingMinutes > 0) {
        const alt = b.queue.find((x) => !x.restingMinutes && !x.busyWith.length && !takenIds.has(x.match.id)
          && x.match.id !== q.match.id && !names(x.match).some((n) => takenPeople.has(n)));
        assert.ok(!alt, `sân ${c.court} gợi ý trận có VĐV đang nghỉ trong khi còn trận không ai nghỉ: ${alt && names(alt.match)}`);
      }
      takenIds.add(q.match.id);
      names(q.match).forEach((n) => takenPeople.add(n));
    }
    const actions = (await svc.listEvents(pool, ADMIN, t.id)).map((e) => e.action);
    for (const a of ['call_match', 'uncall_match', 'move_match', 'court_referee']) assert.ok(actions.includes(a), a);
  });

  test('xếp lịch lại không đụng trận đã gọi vào sân', async () => {
    const m = (await board()).queue.find((q) => !q.busyWith.length).match;
    await courts.callMatch(pool, ADMIN, m.id, { court: 3 });
    const before = await svc.getMatch(pool, m.id);
    await svc.scheduleTournament(pool, ADMIN, t.id, { stage: 'group', startAt: future(3) });
    const after = await svc.getMatch(pool, m.id);
    assert.equal(after.court, 3);
    assert.equal(after.scheduledAt.toString(), before.scheduledAt.toString());
    assert.ok(after.calledAt);
  });

  test('người ngoài BTC không xem/điều phối được', async () => {
    await rejectsWith(courts.courtBoard(pool, REF, t.id), 403);
    const m = (await matchesOf()).find((x) => x.status === 'scheduled' && !x.calledAt);
    await rejectsWith(courts.callMatch(pool, REF, m.id, { court: 1 }), 403);
  });

  // Chạy CUỐI: đóng giải.
  test('giải đã kết thúc: trận trả tournamentStatus để Bàn điểm khoá; máy chủ từ chối nhập điểm', async () => {
    const m = (await matchesOf()).find((x) => ['pending', 'scheduled'].includes(x.status) && x.a && x.b);
    assert.ok(['published', 'ongoing'].includes(m.tournamentStatus));
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'completed' });
    const closed = await svc.getMatch(pool, m.id);
    assert.equal(closed.tournamentStatus, 'completed');
    await rejectsWith(svc.recordScore(pool, ADMIN, m.id, { action: 'save', version: closed.version, games: [[1, 0]] }), 409, 'TOURNAMENT_CLOSED');
    assert.deepEqual((await svc.getMatch(pool, m.id)).games, []);
  });
});

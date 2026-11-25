'use strict';
/**
 * Test tích hợp service layer với PostgreSQL THẬT.
 * Cần biến môi trường TEST_PG_HOST / TEST_PG_PORT / TEST_PG_DB (database sẽ bị XOÁ SẠCH).
 * Không đặt TEST_PG_* thì chạy trên PGlite trong bộ nhớ. Áp dụng TẤT CẢ migration theo thứ tự.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const svc = require('../src/services/tournamentService');
const categorySvc = require('../src/services/categoryService');
const entrySvc = require('../src/services/entryService');
const matchSvc = require('../src/services/matchService');
const { beginMatch } = require('./support/match');

const fs = require('node:fs');

const HOST = process.env.TEST_PG_HOST;
const PORT = Number(process.env.TEST_PG_PORT ?? 5432);
const DB = process.env.TEST_PG_DB;
const usePg = Boolean(HOST && DB);
if (DB && !/test/.test(DB)) throw new Error('Từ chối chạy: TEST_PG_DB phải chứa chữ "test" (DB sẽ bị xoá sạch)');
let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }
const skip = usePg || hasPglite ? false : 'cần TEST_PG_HOST/TEST_PG_DB hoặc @electric-sql/pglite';

const ADMIN = { id: '00000000-0000-4000-8000-000000000001', full_name: 'Admin CLB', role: 'admin' };
const REF = { id: '00000000-0000-4000-8000-000000000002', full_name: 'Trọng tài Lan', role: 'user' };
const REF2 = { id: '00000000-0000-4000-8000-000000000003', full_name: 'Trọng tài Minh', role: 'user' };
const NOBODY = { id: '00000000-0000-4000-8000-000000000004', full_name: 'Khán giả', role: 'user' };

/** Postgres thật (CI) nếu có TEST_PG_*, không thì PGlite trong bộ nhớ. @returns {any} */
function makePool() {
  if (!usePg) return require('../src/db').createPool('pglite:memory');
  // eslint-disable-next-line global-require
  const { Pool } = require('pg');
  return new Pool({ host: HOST, port: PORT, database: DB, user: process.env.TEST_PG_USER ?? 'postgres', password: process.env.PGPASSWORD, options: '-c TimeZone=UTC' });
}

/** Promise phải reject với HttpError có status/code cho trước. */
async function rejectsWith(p, status, code) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

/** Thắng 2-0 cho bên `side`. */
const twoNil = (side) => (side === 'a' ? [[21, 15], [21, 15]] : [[15, 21], [15, 21]]);

describe('tournament service (real Postgres)', { skip }, () => {
  /** @type {any} */ let pool;
  /** @type {any} */ let t;
  /** @type {any} */ let ms;

  before(async () => {
    pool = makePool();
    if (usePg) await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const dir = path.join(__dirname, '..', 'migrations');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    for (const u of [ADMIN, REF, REF2, NOBODY]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
  });
  after(async () => { await pool?.end(); });

  test('only a club admin can create a tournament; creator becomes organizer', async () => {
    const input = { slug: 'smash-team-iv', name: 'Smash Team IV', venue: 'Aurora', startsAt: '2026-12-05T01:00:00Z', courts: 3, slotMinutes: 30 };
    await rejectsWith(svc.createTournament(pool, REF, input), 403);
    t = await svc.createTournament(pool, ADMIN, input);
    assert.equal(t.status, 'draft');
    await rejectsWith(svc.createTournament(pool, ADMIN, input), 409, 'SLUG_TAKEN');
  });

  test('draft tournaments are hidden from non-staff', async () => {
    await rejectsWith(svc.getTournament(pool, 'smash-team-iv', NOBODY), 404);
    await rejectsWith(svc.getTournament(pool, 'smash-team-iv', null), 404);
    const seen = await svc.getTournament(pool, 'smash-team-iv', ADMIN);
    assert.equal(seen.viewerRole, 'admin');
  });

  test('staff can only be added once they have an account', async () => {
    await rejectsWith(svc.upsertStaff(pool, ADMIN, t.id, { userId: '00000000-0000-4000-8000-0000000000ff', role: 'referee' }), 422);
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF2.id, role: 'referee' });
    await rejectsWith(svc.upsertStaff(pool, REF, t.id, { userId: NOBODY.id, role: 'referee' }), 403);
  });

  test('entries must match singles/doubles of the category', async () => {
    ms = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 2, advancePerGroup: 2 });
    await rejectsWith(entrySvc.addEntries(pool, ADMIN, ms.id, [{ player1Name: 'A', player2Name: 'B' }]), 422);
    const names = ['An', 'Bình', 'Cường', 'Dũng', 'Em', 'Phúc', 'Giang', 'Hải'];
    const added = await entrySvc.addEntries(pool, ADMIN, ms.id, names.map((n, i) => ({ player1Name: n, rating: 1500 - i * 50 })));
    assert.equal(added.length, 8);
  });

  test('draw (groups from file) creates a full round robin and locks the entry list', async () => {
    // Chia bảng cố định (như cột "Bảng" trong file) để các bước sau có kết quả xác định.
    const { rows } = await pool.query('SELECT id, player1_name FROM entries WHERE category_id = $1', [ms.id]);
    const id = (n) => rows.find((r) => r.player1_name === n).id;
    const manual = [
      { name: 'A', entryIds: ['An', 'Dũng', 'Em', 'Hải'].map(id) },
      { name: 'B', entryIds: ['Bình', 'Cường', 'Phúc', 'Giang'].map(id) },
    ];
    const res = await svc.drawGroups(pool, ADMIN, ms.id, { manual });
    assert.deepEqual(res.groups, [{ name: 'A', size: 4 }, { name: 'B', size: 4 }]);
    assert.equal(res.matchCount, 12);
    await rejectsWith(entrySvc.addEntries(pool, ADMIN, ms.id, [{ player1Name: 'Muộn' }]), 409, 'ALREADY_DRAWN');
  });

  test('schedule never puts the same player on two courts at once, across categories', async () => {
    const xd = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'XD', name: 'Đôi nam nữ', isDoubles: true, groupCount: 1, advancePerGroup: 2 });
    // An và Bình cũng đánh Đơn nam (khớp theo tên chuẩn hoá, kể cả khác hoa/thường & khoảng trắng).
    await entrySvc.addEntries(pool, ADMIN, xd.id, [
      { player1Name: 'an', player2Name: 'Chi', rating: 1200 },
      { player1Name: '  Bình ', player2Name: 'Dung', rating: 1100 },
      { player1Name: 'Khoa', player2Name: 'Linh', rating: 1000 },
      { player1Name: 'Mạnh', player2Name: 'Ngọc', rating: 900 },
    ]);
    await svc.drawGroups(pool, ADMIN, xd.id);
    const out = await svc.scheduleTournament(pool, ADMIN, t.id);
    assert.equal(out.scheduled, 18);
    const all = await matchSvc.listMatches(pool, t.id);
    const slotPeople = new Map();
    for (const m of all) {
      assert.ok(m.court >= 1 && m.court <= 3);
      const people = [m.a.name, m.b.name].flatMap((n) => n.split(' / ')).map((n) => n.trim().toLowerCase());
      const k = m.scheduledAt;
      const set = slotPeople.get(k) ?? new Set();
      for (const p of people) {
        assert.ok(!set.has(p), `${p} double-booked at ${k}`);
        set.add(p);
      }
      slotPeople.set(k, set);
    }
  });

  test('referee scoring: authz, validation, optimistic locking', async () => {
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
    const [pending] = await matchSvc.listMatches(pool, t.id, { categoryId: ms.id });
    const m = await beginMatch(pool, ADMIN, REF, pending);
    await rejectsWith(matchSvc.recordScore(pool, NOBODY, m.id, { action: 'save', version: m.version, games: [[1, 0]] }), 403);
    await rejectsWith(matchSvc.recordScore(pool, REF, m.id, { action: 'save', version: m.version, games: [[25, 3]] }), 422);
    await rejectsWith(matchSvc.recordScore(pool, REF, m.id, { action: 'finish', version: m.version, games: [[21, 3]] }), 422);

    const saved = await matchSvc.recordScore(pool, REF, m.id, { action: 'save', version: m.version, games: [[11, 9]] });
    assert.equal(saved.status, 'live');
    assert.equal(saved.referee_user_id, REF.id, 'trọng tài đã nhận trận khi bấm bắt đầu');
    // Thiết bị thứ 2 còn giữ version cũ → 409 kèm bản mới.
    await rejectsWith(matchSvc.recordScore(pool, REF, m.id, { action: 'save', version: m.version, games: [[12, 9]] }), 409, 'VERSION_CONFLICT');
    // Trọng tài khác không được ghi đè trận đã có người nhận.
    await rejectsWith(matchSvc.recordScore(pool, REF2, m.id, { action: 'save', version: saved.version, games: [[12, 9]] }), 403);

    const t2 = await svc.getTournament(pool, 'smash-team-iv', null);
    assert.equal(t2.status, 'ongoing', 'bắt đầu trận chuyển giải sang đang diễn ra');
    const q = await matchSvc.refereeQueue(pool, REF);
    assert.equal(q[0].id, m.id, 'live match is first in the referee queue');
    assert.equal(q[0].status, 'live');
  });

  test('knockout cannot be generated until every group match is finished', async () => {
    await rejectsWith(svc.generateKnockout(pool, ADMIN, ms.id), 409, 'GROUPS_NOT_FINISHED');
  });

  test('finishing all group matches produces standings ordered by results', async () => {
    const all = await matchSvc.listMatches(pool, t.id, { categoryId: ms.id });
    const ratings = new Map();
    const { rows } = await pool.query('SELECT id, rating FROM entries WHERE category_id = $1', [ms.id]);
    for (const r of rows) ratings.set(r.id, r.rating);
    for (const m of [...all].sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live'))) {
      const side = ratings.get(m.a.id) > ratings.get(m.b.id) ? 'a' : 'b';
      const started = await beginMatch(pool, ADMIN, ADMIN, m);
      await matchSvc.recordScore(pool, ADMIN, m.id, { action: 'finish', version: started.version, games: twoNil(side) });
    }
    const st = await svc.groupStandings(pool, ms.id);
    assert.deepEqual(st.map((g) => g.complete), [true, true]);
    // Bảng A = An, Dũng, Em, Hải ; B = Bình, Cường, Phúc, Giang (rating giảm dần → thứ hạng)
    assert.deepEqual(st[0].standings.map((r) => r.name), ['An', 'Dũng', 'Em', 'Hải']);
    assert.deepEqual(st[1].standings.map((r) => r.name), ['Bình', 'Cường', 'Phúc', 'Giang']);
    assert.deepEqual(st[0].standings.map((r) => r.won), [3, 2, 1, 0]);
    await rejectsWith(matchSvc.recordScore(pool, ADMIN, all[0].id, { action: 'save', version: 999, games: [] }), 409, 'MATCH_CLOSED');
  });

  test('knockout: cross-group semis, winners advance, reopen guarded, final completes category', async () => {
    const k = await svc.generateKnockout(pool, ADMIN, ms.id);
    assert.deepEqual(k, { qualifiers: 4, rounds: 2, matches: 3 });
    let br = await matchSvc.getBracket(pool, ms.id);
    assert.equal(br.rounds[1].label, 'Chung kết');
    assert.deepEqual(br.rounds[0].matches.map((m) => [m.a.name, m.b.name]), [['An', 'Cường'], ['Bình', 'Dũng']]);

    const [s1, s2] = br.rounds[0].matches;
    const started = await beginMatch(pool, ADMIN, REF, s1);
    await matchSvc.recordScore(pool, REF, s1.id, { action: 'finish', version: started.version, games: twoNil('a') });
    await matchSvc.recordScore(pool, REF, s2.id, { action: 'walkover', version: s2.version, walkoverWinner: 'b' });
    br = await matchSvc.getBracket(pool, ms.id);
    const fin = br.rounds[1].matches[0];
    assert.deepEqual([fin.a.name, fin.b.name], ['An', 'Dũng']);

    // Sửa bán kết khi chung kết chưa đánh → chung kết mất slot A.
    await matchSvc.reopenMatch(pool, ADMIN, s1.id);
    br = await matchSvc.getBracket(pool, ms.id);
    assert.equal(br.rounds[1].matches[0].a, null);
    const s1b = (await matchSvc.getMatch(pool, s1.id));
    await matchSvc.recordScore(pool, ADMIN, s1.id, { action: 'finish', version: s1b.version, games: [[21, 19], [19, 21], [22, 20]] });

    let f = await beginMatch(pool, ADMIN, REF, fin);
    await matchSvc.recordScore(pool, REF, f.id, { action: 'save', version: f.version, games: [[5, 3]] });
    await rejectsWith(matchSvc.reopenMatch(pool, ADMIN, s1.id), 409, 'NEXT_STARTED');
    await rejectsWith(matchSvc.reopenMatch(pool, ADMIN, (await matchSvc.listMatches(pool, t.id, { categoryId: ms.id }))[0].id), 409, 'KNOCKOUT_STARTED');

    f = await matchSvc.getMatch(pool, fin.id);
    await matchSvc.recordScore(pool, REF, f.id, { action: 'finish', version: f.version, games: [[21, 3], [21, 3]] });
    const { rows } = await pool.query('SELECT stage FROM categories WHERE id = $1', [ms.id]);
    assert.equal(rows[0].stage, 'completed');
  });

  test('byes: 3 groups × 2 qualifiers → top two seeds go straight to round 2', async () => {
    const ws = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'WS', name: 'Đơn nữ', isDoubles: false, groupCount: 3, advancePerGroup: 2 });
    await entrySvc.addEntries(pool, ADMIN, ws.id, Array.from({ length: 9 }, (_, i) => ({ player1Name: `Nữ ${i + 1}`, rating: 1500 - i * 10 })));
    await svc.drawGroups(pool, ADMIN, ws.id);
    for (const m of await matchSvc.listMatches(pool, t.id, { categoryId: ws.id })) {
      const started = await beginMatch(pool, ADMIN, ADMIN, m);
      await matchSvc.recordScore(pool, ADMIN, m.id, { action: 'finish', version: started.version, games: twoNil('a') });
    }
    const k = await svc.generateKnockout(pool, ADMIN, ws.id);
    assert.equal(k.qualifiers, 6);
    const br = await matchSvc.getBracket(pool, ws.id);
    assert.equal(br.rounds[0].matches.filter((m) => m.status === 'bye').length, 2);
    const r2 = br.rounds[1].matches;
    assert.ok(r2.every((m) => m.a !== null), 'bye winners pre-filled into round 2');
  });

  test('score audit log is append-only, but a whole tournament can still be deleted', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM match_score_events');
    assert.ok(rows[0].n > 20);
    await assert.rejects(pool.query('UPDATE match_score_events SET action = $1', ['save']), /append-only/);
    await assert.rejects(pool.query('DELETE FROM match_score_events'), /append-only/);
    await pool.query('DELETE FROM tournaments WHERE id = $1', [t.id]);
    const left = await pool.query('SELECT count(*)::int AS n FROM matches');
    assert.equal(left.rows[0].n, 0);
  });
});

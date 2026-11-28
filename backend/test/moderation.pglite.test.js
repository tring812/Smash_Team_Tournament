'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tours = require('../src/services/tournamentService');
const categories = require('../src/services/categoryService');
const entries = require('../src/services/entryService');
const matches = require('../src/services/matchService');
const athletes = require('../src/services/athleteService');
const courts = require('../src/services/courtService');
const rallies = require('../src/services/rallyService');
const { schemas } = require('../src/schemas');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const ADMIN = { id: '00000000-0000-4000-8000-0000000000d1', full_name: 'BTC thử', role: 'admin' };
const REF = { id: '00000000-0000-4000-8000-0000000000d2', full_name: 'Trọng tài thử', role: 'user' };
const OTHER = { id: '00000000-0000-4000-8000-0000000000d3', full_name: 'BTC giải khác', role: 'user' };
const BTC = { id: '00000000-0000-4000-8000-0000000000d4', full_name: 'BTC của giải', role: 'user' };
const HOME_WINS = [[21, 4], [21, 5]];
const AWAY_WINS = [[4, 21], [5, 21]];
const errCode = (code) => (err) => err.code === code;

describe('Điều hành và đính chính lịch sử (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  let pool;
  let seq = 0;
  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    const dir = path.join(__dirname, '..', 'migrations');
    for (const file of fs.readdirSync(dir).sort()) await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const u of [ADMIN, REF, OTHER, BTC]) await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
  });
  after(async () => { await pool?.end(); });

  async function tournament() {
    const startsAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const t = await tours.createTournament(pool, ADMIN, { name: 'Giải kiểm thử', slug: `moderation-${++seq}`, startsAt, courts: 2 });
    await tours.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    await tours.upsertStaff(pool, ADMIN, t.id, { userId: BTC.id, role: 'organizer' });
    return t;
  }

  async function category(t, { code = 'MS', doubles = false, people = ['An', 'Bình', 'Chi'], advance = 1, draw = true } = {}) {
    const cat = await categories.createCategory(pool, ADMIN, t.id, { code, name: `Thi đấu ${code}`, groupCount: 1, isDoubles: doubles, advancePerGroup: advance });
    const teams = await entries.addEntries(pool, ADMIN, cat.id,
      people.map((p) => Array.isArray(p) ? { player1Name: p[0], player2Name: p[1] } : { player1Name: p }));
    if (draw) await tours.drawGroups(pool, ADMIN, cat.id);
    return { cat, teams };
  }

  async function finish(m, games = HOME_WINS) {
    const fresh = await matches.getMatch(pool, m.id);
    return matches.recordScore(pool, ADMIN, m.id, { action: 'finish', version: fresh.version, games });
  }

  test('truất quyền một nội dung rồi toàn giải theo VĐV, gồm đội đôi trước bốc thăm; không sửa trận đã chốt', async () => {
    const t = await tournament();
    const otherTour = await tournament();
    await tours.upsertStaff(pool, ADMIN, otherTour.id, { userId: OTHER.id, role: 'organizer' });
    const { cat: ms } = await category(t);
    const { cat: xd, teams: pairs } = await category(t, { code: 'XD', doubles: true, people: [['Mai', 'Bình'], ['Hoa', 'Nam'], ['Hà', 'Phong']], draw: false });
    const athlete = (await athletes.listAthletes(pool, BTC, t.id)).find((a) => a.full_name === 'Bình');
    assert.deepEqual(athlete.entries.map((x) => [x.categoryId, x.canDisqualify]), [[ms.id, true], [xd.id, true]]);
    const match = (await matches.listMatches(pool, t.id)).find((m) => [m.a.name, m.b.name].includes('Bình'));
    const side = match.a.name === 'Bình' ? 'b' : 'a';
    const other = match[side];
    await finish(match, side === 'a' ? HOME_WINS : AWAY_WINS);
    const before = await matches.getMatch(pool, match.id);
    const selected = { scope: 'category', categoryId: ms.id, reason: 'Vi phạm điều lệ giải' };
    for (const viewer of [REF, OTHER]) await assert.rejects(entries.disqualifyAthlete(pool, viewer, athlete.id, selected), (e) => e.status === 403);
    assert.ok(!schemas.disqualifyAthlete.safeParse({ scope: 'tournament', reason: ' ' }).success);
    const { entries: affected } = await entries.disqualifyAthlete(pool, BTC, athlete.id, selected);
    assert.equal(affected.length, 1);
    assert.equal(affected[0].cancelledMatches, 1);
    const after = await matches.getMatch(pool, match.id);
    assert.deepEqual([after.status, after.winner, after.games, after.version], [before.status, side, before.games, before.version]);
    const [group] = await tours.groupStandings(pool, ms.id);
    assert.equal(group.standings.find((r) => r.entryId === other.id).won, 1);
    const dq = group.standings.find((r) => r.disqualified);
    assert.equal(dq.rank, null);
    assert.equal(dq.dqReason, null);
    assert.equal((await tours.listEntries(pool, xd.id)).find((e) => e.id === pairs[0].id).disqualified_at, null);
    await assert.rejects(entries.updateEntry(pool, BTC, other.id, { player1Name: 'Người thay thế' }), errCode('ENTRY_STARTED'));

    const everything = await entries.disqualifyAthlete(pool, BTC, athlete.id, { scope: 'tournament', reason: 'Vi phạm điều lệ giải' });
    assert.deepEqual(everything.entries.map((e) => e.entryId), [pairs[0].id]);
    const event = (await tours.listEvents(pool, BTC, t.id)).find((ev) => ev.action === 'disqualify' && ev.category_code === 'XD');
    assert.equal(event.details.athleteId, athlete.id);
    assert.equal(event.details.scope, 'tournament');
    assert.equal(event.details.reason, 'Vi phạm điều lệ giải');
    await tours.drawGroups(pool, ADMIN, xd.id);
    assert.ok((await matches.listMatches(pool, t.id, { categoryId: xd.id })).every((m) => m.a.id !== pairs[0].id && m.b.id !== pairs[0].id));
    await entries.reinstateEntry(pool, BTC, affected[0].entryId);
    assert.equal((await matches.getMatch(pool, match.id)).winner, side);
  });

  test('kết quả cũ từng bị huỷ vẫn khoá thay VĐV, kể cả W.O. không có điểm', async () => {
    const t = await tournament();
    const { cat } = await category(t);
    const [m] = await matches.listMatches(pool, t.id);
    // Mô phỏng dữ liệu tạo theo quy tắc cũ đã huỷ cả kết quả W.O.
    await pool.query(
      `UPDATE matches SET status = 'cancelled', pre_cancel = jsonb_build_object('status', 'walkover') WHERE id = $1`,
      [m.id],
    );
    const team = (await tours.listEntries(pool, cat.id)).find((e) => e.id === m.a.id);
    assert.equal(team.has_played, true);
    await assert.rejects(entries.updateEntry(pool, BTC, team.id, { player1Name: 'Người mới' }), errCode('ENTRY_STARTED'));
    await assert.rejects(categories.updateCategory(pool, BTC, cat.id, { pointsToWin: 25 }), errCode('CATEGORY_LOCKED'));
    await assert.rejects(categories.deleteCategory(pool, BTC, cat.id), errCode('CATEGORY_STARTED'));
  });

  test('BTC đính chính có lý do, giữ giờ kết thúc và trạng thái sân; ghi cả kết quả trước/sau', async () => {
    const t = await tournament();
    await category(t, { people: ['An', 'Bình', 'Chi', 'Dũng'] });
    const all = await matches.listMatches(pool, t.id);
    const [m] = all;
    const next = all.find((n) => ![m.a.id, m.b.id].some((id) => id === n.a.id || id === n.b.id));
    await courts.callMatch(pool, BTC, m.id, { court: 1 });
    await rallies.addRally(pool, BTC, m.id, { type: 'start', server: 'a1', receiver: 'b1', expectedSeq: 1 });
    const original = await finish(m);
    await courts.callMatch(pool, BTC, next.id, { court: 1 });
    await tours.updateTournament(pool, ADMIN, t.id, { status: 'completed' });
    const body = { action: 'finish', version: original.version, games: AWAY_WINS, reason: 'Đối chiếu lại phiếu điểm' };
    const correct = (viewer, overrides = {}) => matches.correctResult(pool, viewer, m.id, { ...body, ...overrides });
    for (const viewer of [REF, OTHER]) await assert.rejects(correct(viewer), (e) => e.status === 403);
    await assert.rejects(correct(BTC, { reason: ' ' }), (e) => e.status === 422);
    await assert.rejects(correct(BTC, { games: [[4, 8]] }), (e) => e.status === 422);
    await assert.rejects(correct(BTC, { version: original.version - 1 }), errCode('VERSION_CONFLICT'));
    await correct(BTC);
    const result = await matches.getMatch(pool, m.id);
    assert.equal(result.status, 'finished');
    assert.equal(result.tournamentStatus, 'completed');
    assert.deepEqual(result.games, AWAY_WINS);
    assert.equal(result.winner, 'b');
    const { rows: [raw] } = await pool.query('SELECT finished_at, called_at FROM matches WHERE id = $1', [m.id]);
    assert.deepEqual(raw, { finished_at: original.finished_at, called_at: original.called_at });
    assert.equal((await courts.courtBoard(pool, BTC, t.id)).courts[0].current.id, next.id);
    const events = await tours.listEvents(pool, BTC, t.id);
    const audit = events.filter((ev) => ev.action === 'score_correct');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor, BTC.full_name);
    assert.equal(audit[0].details.reason, body.reason);
    assert.deepEqual(audit[0].details.before, { status: 'finished', games: HOME_WINS, winner: 'a' });
    assert.deepEqual(audit[0].details.after, { status: 'finished', games: AWAY_WINS, winner: 'b' });
    assert.deepEqual((await rallies.listRallies(pool, m.id)).map((r) => r.type), ['start', 'override', 'override']);
  });

  test('sửa nhánh chỉ đổi đội thắng nếu trận kế tiếp chưa được gọi; sửa tỉ số cùng đội thắng vẫn được', async () => {
    const t = await tournament();
    const { cat } = await category(t, { advance: 4, people: ['An', 'Bình', 'Chi', 'Dũng'] });
    for (const groupMatch of await matches.listMatches(pool, t.id)) await finish(groupMatch);
    await tours.generateKnockout(pool, BTC, cat.id);
    const { rounds } = await matches.getBracket(pool, cat.id);
    const [semi, second] = rounds[0].matches;
    const final = rounds[1].matches[0];
    const original = await finish(semi);
    await finish(second);
    const reason = 'Đối chiếu biên bản gốc';
    const change = { action: 'finish', version: original.version, games: AWAY_WINS, reason };
    await courts.callMatch(pool, BTC, final.id, { court: 2 });
    await assert.rejects(matches.correctResult(pool, BTC, semi.id, change), errCode('NEXT_STARTED'));
    await assert.rejects(matches.reopenMatch(pool, BTC, semi.id), errCode('NEXT_STARTED'));
    await matches.correctResult(pool, BTC, semi.id, { ...change, games: [[21, 8], [21, 9]] });
    assert.equal((await matches.getMatch(pool, final.id)).a.id, semi.a.id);
    await courts.uncallMatch(pool, BTC, final.id);
    await matches.correctResult(pool, BTC, semi.id, { action: 'walkover', version: original.version + 1, walkoverWinner: 'b', reason });
    assert.equal((await matches.getMatch(pool, semi.id)).status, 'walkover');
    assert.equal((await matches.getMatch(pool, final.id)).a.id, semi.b.id);
  });

  test('sửa kết quả vòng bảng không làm đổi danh sách hoặc vị trí của đội trong nhánh đã tạo', async () => {
    const t = await tournament();
    const { cat } = await category(t, { advance: 2 });
    const order = ['An', 'Bình', 'Chi'];
    const group = await matches.listMatches(pool, t.id);
    for (const m of group) await finish(m, order.indexOf(m.a.name) < order.indexOf(m.b.name) ? HOME_WINS : AWAY_WINS);
    await tours.generateKnockout(pool, BTC, cat.id);
    const m = group.find((m) => [m.a.name, m.b.name].every((name) => name !== 'Chi'));
    const current = await matches.getMatch(pool, m.id);
    const body = { action: 'finish', reason: 'Đính chính điểm', version: current.version };
    await assert.rejects(matches.correctResult(pool, BTC, m.id, {
      ...body, games: m.a.name === 'An' ? AWAY_WINS : HOME_WINS,
    }), errCode('QUALIFIERS_CHANGED'));
    assert.equal((await matches.getMatch(pool, m.id)).version, current.version);
    await matches.correctResult(pool, BTC, m.id, { ...body, games: m.a.name === 'An' ? [[21, 7], [21, 8]] : [[7, 21], [8, 21]] });
    assert.equal((await matches.getMatch(pool, m.id)).version, current.version + 1);
  });
});

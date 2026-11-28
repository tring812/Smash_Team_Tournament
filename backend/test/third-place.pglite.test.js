'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tournaments = require('../src/services/tournamentService');
const categories = require('../src/services/categoryService');
const entries = require('../src/services/entryService');
const matches = require('../src/services/matchService');
const courts = require('../src/services/courtService');
let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const ADMIN = { id: '00000000-0000-4000-8000-0000000000e1', role: 'admin', full_name: 'BTC thử' };
const REF = { id: '00000000-0000-4000-8000-0000000000e2', role: 'user', full_name: 'Trọng tài thử' };
const WIN_A = [[21, 4], [21, 5]];
const WIN_B = [[4, 21], [5, 21]];
const pastCode = (code) => (err) => err.code === code;
const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

describe('Tranh hạng Ba–Tư (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  let pool;
  let seq = 0;
  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    const dir = path.join(__dirname, '..', 'migrations');
    for (const file of fs.readdirSync(dir).sort()) await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const u of [ADMIN, REF]) await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
  });
  after(async () => { await pool?.end(); });

  async function fixture({ thirdPlace, qualifiers = 4 } = {}) {
    const t = await tournaments.createTournament(pool, ADMIN, { slug: `third-place-${++seq}`, name: 'Giải thử hạng Ba', startsAt: future(4), courts: 2 });
    await tournaments.upsertStaff(pool, ADMIN, t.id, { role: 'referee', userId: REF.id });
    const cat = await categories.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 1, advancePerGroup: qualifiers, thirdPlace });
    await entries.addEntries(pool, ADMIN, cat.id, ['An', 'Bình', 'Chi', 'Dũng'].map((player1Name) => ({ player1Name })));
    await tournaments.drawGroups(pool, ADMIN, cat.id);
    for (const m of await matches.listMatches(pool, t.id)) await finish(m.id);
    return { t, cat };
  }

  async function finish(id, games = WIN_A) {
    const m = await matches.getMatch(pool, id);
    return matches.recordScore(pool, ADMIN, id, { action: 'finish', version: m.version, games });
  }

  async function bracket(cat) {
    const { rounds, thirdPlace: bronze } = await matches.getBracket(pool, cat.id);
    return { semis: rounds[rounds.length - 2].matches, finals: rounds.at(-1).matches, bronze };
  }

  test('chỉ BTC bật được trước khi tạo nhánh; mặc định không tạo trận và không tự thêm đội để đủ bán kết', async () => {
    const { cat } = await fixture({ qualifiers: 3 });
    assert.equal(cat.third_place, false);
    await assert.rejects(categories.updateCategory(pool, REF, cat.id, { thirdPlace: true }), (e) => e.status === 403);
    await categories.updateCategory(pool, ADMIN, cat.id, { thirdPlace: true });
    await assert.rejects(tournaments.generateKnockout(pool, ADMIN, cat.id), pastCode('THIRD_PLACE_NEEDS_SEMIFINALS'));
    assert.deepEqual(await matches.getBracket(pool, cat.id), { rounds: [], thirdPlace: null });
    await categories.updateCategory(pool, ADMIN, cat.id, { thirdPlace: false });
    const out = await tournaments.generateKnockout(pool, ADMIN, cat.id);
    assert.equal(out.qualifiers, 3);
    assert.equal(out.thirdPlaceId, undefined);
    assert.equal((await matches.getBracket(pool, cat.id)).thirdPlace, null);
    await assert.rejects(categories.updateCategory(pool, ADMIN, cat.id, { thirdPlace: true }), pastCode('CATEGORY_LOCKED'));
  });

  test('xếp cả hai trận lấy hạng sau bán kết; dùng luật bán kết và chỉ hoàn tất sau cùng', async () => {
    const { t, cat } = await fixture({ thirdPlace: true });
    const semiRules = { stage: 'knockout', fromEnd: 2, pointsToWin: 15, maxPoints: 21, gamesToWin: 1 };
    const finalRules = { stage: 'knockout', fromEnd: 1, pointsToWin: 21, maxPoints: 30, gamesToWin: 2 };
    await categories.setRoundRules(pool, ADMIN, cat.id, [semiRules, finalRules]);
    const out = await tournaments.generateKnockout(pool, ADMIN, cat.id);
    const { semis, finals, bronze } = await bracket(cat);
    const [final] = finals;
    assert.equal(finals.length, 1);
    assert.equal(out.matches, 4);
    assert.equal(out.thirdPlaceId, bronze.id);
    assert.equal(bronze.roundLabel, 'Tranh hạng Ba–Tư');
    assert.equal(bronze.isThirdPlace, true);
    assert.equal(final.isThirdPlace, false);
    assert.deepEqual(bronze.rules, semis[0].rules);
    assert.notDeepEqual(bronze.rules, final.rules);
    const startsAt = future(5);
    const scheduled = await tournaments.scheduleTournament(pool, ADMIN, t.id, { stage: 'knockout', startAt: startsAt, slotMinutes: 20 });
    assert.equal(scheduled.scheduled, 4);
    for (const medal of [final.id, bronze.id]) {
      assert.ok(+new Date((await matches.getMatch(pool, medal)).scheduledAt) >= +new Date(startsAt) + 40 * 60_000);
    }
    await assert.rejects(courts.callMatch(pool, ADMIN, bronze.id, { court: 1 }), pastCode('MISSING_ENTRY'));
    const first = await finish(semis[0].id, [[15, 8]]);
    assert.deepEqual(new Set(first.changed_match_ids), new Set([semis[0].id, final.id, bronze.id]));
    assert.equal((await matches.getMatch(pool, bronze.id)).a.id, semis[0].b.id);
    assert.equal((await matches.getMatch(pool, bronze.id)).b, null);
    await finish(semis[1].id, [[8, 15]]);
    assert.equal((await matches.getMatch(pool, bronze.id)).b.id, semis[1].a.id);
    assert.equal((await matches.getMatch(pool, final.id)).b.id, semis[1].b.id);
    await finish(final.id);
    assert.equal((await matches.getMatch(pool, final.id)).winner, 'a');
    assert.equal((await categories.loadCategory(pool, cat.id)).stage, 'knockout');
    await assert.rejects(finish(bronze.id, WIN_A), (e) => e.status === 422);
    await finish(bronze.id, [[16, 14]]);
    assert.equal((await matches.getBracket(pool, cat.id)).thirdPlace.winner, 'a');
    assert.equal((await categories.loadCategory(pool, cat.id)).stage, 'completed');
  });

  test('đính chính bán kết đồng bộ chung kết và tranh hạng; chặn khi một trong hai trận không còn chờ', async () => {
    const { cat } = await fixture({ thirdPlace: true });
    await tournaments.generateKnockout(pool, ADMIN, cat.id);
    const { semis, finals: [final], bronze } = await bracket(cat);
    const [semi, second] = semis;
    await finish(semi.id);
    await finish(second.id);
    const correct = async (games) => matches.correctResult(pool, ADMIN, semi.id, {
      action: 'finish', games, reason: 'Đối chiếu lại phiếu điểm', version: (await matches.getMatch(pool, semi.id)).version,
    });
    for (const medal of [final, bronze]) {
      await courts.callMatch(pool, ADMIN, medal.id, { court: 1 });
      await assert.rejects(correct(WIN_B), pastCode('NEXT_STARTED'));
      await assert.rejects(matches.reopenMatch(pool, ADMIN, semi.id), pastCode('NEXT_STARTED'));
      await courts.uncallMatch(pool, ADMIN, medal.id);
    }
    await correct(WIN_B);
    assert.equal((await matches.getMatch(pool, final.id)).a.id, semi.b.id);
    assert.equal((await matches.getMatch(pool, bronze.id)).a.id, semi.a.id);
    await finish(bronze.id);
    await assert.rejects(correct(WIN_A), pastCode('NEXT_STARTED'));
    await correct([[7, 21], [8, 21]]);
    assert.equal((await categories.loadCategory(pool, cat.id)).stage, 'knockout');
    await finish(final.id);
    assert.equal((await categories.loadCategory(pool, cat.id)).stage, 'completed');
  });

  test('đội thua bán kết bị truất quyền không thể đánh trận tranh hạng; đối thủ thắng W.O.', async () => {
    const { cat } = await fixture({ thirdPlace: true });
    await tournaments.generateKnockout(pool, ADMIN, cat.id);
    const { semis: [first, second], finals: [final], bronze } = await bracket(cat);
    await entries.disqualifyEntry(pool, ADMIN, first.a.id, 'Vi phạm điều lệ');
    assert.equal((await matches.getMatch(pool, first.id)).status, 'walkover');
    assert.equal((await matches.getMatch(pool, bronze.id)).status, 'pending');
    await finish(second.id);
    const placed = await matches.getMatch(pool, bronze.id);
    assert.equal(placed.status, 'walkover');
    assert.equal(placed.a.disqualified, true);
    assert.equal(placed[placed.winner].id, second.b.id);
    await finish(final.id);
    assert.equal((await categories.loadCategory(pool, cat.id)).stage, 'completed');
  });

  test('hai đội thua bán kết cùng bị truất quyền thì huỷ tranh hạng và không trao hạng', async () => {
    const { cat } = await fixture({ thirdPlace: true });
    await tournaments.generateKnockout(pool, ADMIN, cat.id);
    const { semis, finals: [final], bronze } = await bracket(cat);
    for (const semi of semis) await entries.disqualifyEntry(pool, ADMIN, semi.a.id, 'Vi phạm điều lệ');
    const cancelled = await matches.getMatch(pool, bronze.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.winner, null);
    assert.equal((await categories.loadCategory(pool, cat.id)).stage, 'knockout');
    await finish(final.id);
    assert.equal((await categories.loadCategory(pool, cat.id)).stage, 'completed');
  });
});

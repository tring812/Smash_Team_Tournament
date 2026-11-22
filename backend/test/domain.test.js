'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { BWF_RULES, gameState, evaluateMatch } = require('../src/domain/scoring');
const { snakeDraw, roundRobin, groupName } = require('../src/domain/draw');
const { scheduleMatches, countNoRest } = require('../src/domain/schedule');
const { computeStandings } = require('../src/domain/standings');
const { seedOrder, seedsFromGroups, buildBracket, roundLabel } = require('../src/domain/bracket');

describe('scoring.gameState (BWF 21/30)', () => {
  const ok = [
    [[21, 0], 'a'], [[21, 19], 'a'], [[19, 21], 'b'], [[22, 20], 'a'], [[28, 30], 'b'],
    [[30, 29], 'a'], [[29, 30], 'b'],
  ];
  for (const [g, want] of ok) {
    test(`accepts finished game ${g.join('-')} as winner ${want}`, () => assert.equal(gameState(g, BWF_RULES), want));
  }
  const live = [[0, 0], [20, 19], [21, 20], [29, 29], [20, 20]];
  for (const g of live) {
    test(`treats ${g.join('-')} as in progress (deuce/unfinished)`, () => assert.equal(gameState(g, BWF_RULES), 'in_progress'));
  }
  const bad = [[25, 15], [31, 29], [30, 30], [23, 20], [-1, 5], [21.5, 3], [30, 27]];
  for (const g of bad) {
    test(`rejects impossible score ${g.join('-')}`, () => assert.equal(gameState(g, BWF_RULES), 'invalid'));
  }
  test('rally to 15 capped at 21 ends 21-20 at the cap', () => {
    assert.equal(gameState([21, 20], { pointsToWin: 15, maxPoints: 21, gamesToWin: 2 }), 'a');
    assert.equal(gameState([16, 14], { pointsToWin: 15, maxPoints: 21, gamesToWin: 2 }), 'a');
  });
  test('no-deuce format (max == target) ends at target regardless of margin', () => {
    assert.equal(gameState([11, 10], { pointsToWin: 11, maxPoints: 11, gamesToWin: 1 }), 'a');
  });
});

describe('scoring.evaluateMatch', () => {
  test('two straight games complete the match for the winner', () => {
    const r = evaluateMatch([[21, 15], [21, 18]], BWF_RULES);
    assert.equal(r.valid, true);
    assert.equal(r.winner, 'a');
    assert.equal(r.complete, true);
    assert.deepEqual([r.pointsA, r.pointsB], [42, 33]);
  });
  test('rubber game decides a 1-1 match', () => {
    const r = evaluateMatch([[21, 15], [18, 21], [19, 21]], BWF_RULES);
    assert.equal(r.winner, 'b');
  });
  test('an in-progress last game leaves the match incomplete', () => {
    const r = evaluateMatch([[21, 15], [10, 8]], BWF_RULES);
    assert.equal(r.valid, true);
    assert.equal(r.complete, false);
  });
  test('rejects a game played after the match was already decided', () => {
    const r = evaluateMatch([[21, 15], [21, 15], [21, 3]], BWF_RULES);
    assert.equal(r.valid, false);
  });
  test('rejects an unfinished game followed by another game', () => {
    assert.equal(evaluateMatch([[15, 10], [21, 5]], BWF_RULES).valid, false);
  });
  test('rejects malformed game tuples', () => {
    // @ts-expect-error intentional bad input
    assert.equal(evaluateMatch([[21]], BWF_RULES).valid, false);
  });
});

describe('draw', () => {
  test('group names continue past Z as AA', () => {
    assert.equal(groupName(0), 'A');
    assert.equal(groupName(25), 'Z');
    assert.equal(groupName(26), 'AA');
  });
  test('snake draw spreads the strongest entries one per group', () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({ id: `e${i + 1}`, rating: 2000 - i * 10 }));
    const g = snakeDraw(entries, 2);
    assert.deepEqual(g[0].entryIds, ['e1', 'e4', 'e5', 'e8']);
    assert.deepEqual(g[1].entryIds, ['e2', 'e3', 'e6', 'e7']);
  });
  test('manual seed outranks rating in the draw', () => {
    const g = snakeDraw([{ id: 'x', rating: 1, seed: 1 }, { id: 'y', rating: 9999 }, { id: 'z', rating: 5 }, { id: 'w', rating: 4 }], 2);
    assert.equal(g[0].entryIds[0], 'x');
  });
  test('refuses a draw that would leave a group with fewer than 2 entries', () => {
    assert.throws(() => snakeDraw([{ id: 'a', rating: 1 }, { id: 'b', rating: 1 }, { id: 'c', rating: 1 }], 2), RangeError);
  });
  for (const n of [2, 3, 4, 5, 6, 7]) {
    test(`round robin of ${n} plays every pair exactly once, never twice in a round`, () => {
      const ids = Array.from({ length: n }, (_, i) => `t${i}`);
      const p = roundRobin(ids);
      assert.equal(p.length, (n * (n - 1)) / 2);
      const pairs = new Set(p.map((x) => [x.a, x.b].sort().join('|')));
      assert.equal(pairs.size, p.length);
      const perRound = new Map();
      for (const x of p) {
        const s = perRound.get(x.round) ?? new Set();
        assert.ok(!s.has(x.a) && !s.has(x.b), 'entry plays twice in one round');
        s.add(x.a); s.add(x.b);
        perRound.set(x.round, s);
      }
    });
  }
});

describe('schedule.countNoRest', () => {
  test('đếm mỗi lần một VĐV đánh 2 khung liền nhau', () => {
    const ms = [
      { id: 'm1', participants: ['an', 'binh'] },
      { id: 'm2', participants: ['an', 'chi'] },
      { id: 'm3', participants: ['binh', 'dung'] },
      { id: 'm4', participants: ['an', 'dung'] },
    ];
    const slots = [{ id: 'm1', slot: 0 }, { id: 'm2', slot: 1 }, { id: 'm3', slot: 2 }, { id: 'm4', slot: 3 }];
    // Khung: m1=0, m2=1, m3=2, m4=3 → an: 0,1,3 (1 lượt) · binh: 0,2 (0) · chi: 1 · dung: 2,3 (1 lượt)
    assert.equal(countNoRest(ms, slots), 2);
    assert.equal(countNoRest(ms, []), 0);
  });
});

describe('schedule', () => {
  const start = new Date('2026-12-05T01:00:00Z');
  test('never books a player on two courts in the same slot (cross-category)', () => {
    const ms = [
      { id: 'm1', participants: ['an', 'binh'], priority: 1 },
      { id: 'm2', participants: ['an', 'chi'], priority: 2 }, // An cũng đánh nội dung khác
      { id: 'm3', participants: ['dung', 'em'], priority: 3 },
    ];
    const s = scheduleMatches(ms, { courts: 3, startAt: start, slotMinutes: 30 });
    const slotOf = Object.fromEntries(s.map((x) => [x.id, x.slot]));
    assert.notEqual(slotOf.m1, slotOf.m2);
    assert.equal(slotOf.m3, 0);
  });
  test('prefers a rest slot between a player\'s consecutive matches when possible', () => {
    const ms = [
      { id: 'm1', participants: ['a', 'b'], priority: 1 },
      { id: 'm2', participants: ['a', 'c'], priority: 2 },
      { id: 'm3', participants: ['d', 'e'], priority: 3 },
      { id: 'm4', participants: ['f', 'g'], priority: 4 },
    ];
    const s = scheduleMatches(ms, { courts: 1, startAt: start, slotMinutes: 30 });
    const order = s.sort((x, y) => x.slot - y.slot).map((x) => x.id);
    assert.equal(order[0], 'm1');
    assert.notEqual(order[1], 'm2');
  });
  test('computes start times from slot index', () => {
    const s = scheduleMatches([{ id: 'a', participants: ['x'], priority: 0 }, { id: 'b', participants: ['x'], priority: 1 }],
      { courts: 2, startAt: start, slotMinutes: 25 });
    assert.equal(s[1].startsAt.toISOString(), '2026-12-05T01:25:00.000Z');
  });
  test('rejects nonsensical court counts', () => {
    assert.throws(() => scheduleMatches([], { courts: 0, startAt: start, slotMinutes: 30 }), RangeError);
  });
});

describe('standings', () => {
  const m = (a, b, winner, games) => ({ a, b, winner, games });
  test('ranks primarily by matches won', () => {
    const rows = computeStandings(['A', 'B', 'C'], [
      m('A', 'B', 'a', [[21, 10], [21, 10]]), m('A', 'C', 'a', [[21, 10], [21, 10]]), m('B', 'C', 'a', [[21, 19], [21, 19]]),
    ]);
    assert.deepEqual(rows.map((r) => r.entryId), ['A', 'B', 'C']);
    assert.equal(rows[0].won, 2);
  });
  test('two-way tie is broken by head-to-head, not by point difference', () => {
    // B thua A nhưng hiệu số điểm của B tốt hơn; A thắng đối đầu nên A trên.
    const rows = computeStandings(['A', 'B', 'C', 'D'], [
      m('A', 'B', 'a', [[21, 19], [21, 19]]),
      m('C', 'A', 'a', [[21, 0], [21, 0]]),
      m('B', 'C', 'a', [[21, 0], [21, 0]]),
      m('A', 'D', 'a', [[21, 19], [21, 19]]),
      m('B', 'D', 'a', [[21, 0], [21, 0]]),
      m('D', 'C', 'a', [[21, 19], [21, 19]]),
    ], { A: 1000, B: 2000 }); // rating cao hơn của B không được thắng đối đầu
    const ids = rows.map((r) => r.entryId);
    assert.ok(ids.indexOf('A') < ids.indexOf('B'));
  });
  test('three-way circular tie is broken by game difference among the tied', () => {
    const rows = computeStandings(['A', 'B', 'C'], [
      m('A', 'B', 'a', [[21, 10], [21, 10]]),            // A +2 game
      m('B', 'C', 'a', [[21, 10], [10, 21], [21, 10]]),  // B +1
      m('C', 'A', 'a', [[21, 10], [10, 21], [21, 10]]),  // C +1
    ]);
    assert.equal(rows[0].entryId, 'A');
  });
  test('walkover counts as a win without games or points', () => {
    const rows = computeStandings(['A', 'B'], [{ a: 'A', b: 'B', winner: 'b', games: [], walkover: true }]);
    assert.equal(rows[0].entryId, 'B');
    assert.equal(rows[0].pointsFor, 0);
  });
  test('entries with no matches yet are ordered by rating', () => {
    const rows = computeStandings(['A', 'B'], [], { A: 900, B: 1500 });
    assert.equal(rows[0].entryId, 'B');
  });
});

describe('bracket', () => {
  test('standard seed order keeps seeds 1 and 2 apart until the final', () => {
    assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  });
  test('two groups: A1 meets B2 and B1 meets A2 in the first round', () => {
    const seeds = seedsFromGroups([['A1', 'A2'], ['B1', 'B2']], 2);
    const r1 = buildBracket(seeds).filter((x) => x.round === 1);
    assert.deepEqual(r1.map((x) => [x.a, x.b]), [['A1', 'B2'], ['B1', 'A2']]);
  });
  test('four groups: no first-round rematch and group-mates sit in opposite halves', () => {
    const groups = ['A', 'B', 'C', 'D'].map((g) => [`${g}1`, `${g}2`]);
    const r1 = buildBracket(seedsFromGroups(groups, 2)).filter((x) => x.round === 1);
    for (const x of r1) assert.notEqual(x.a?.[0], x.b?.[0]);
    const top = r1.slice(0, 2).flatMap((x) => [x.a, x.b]);
    for (const g of ['A', 'B', 'C', 'D']) {
      assert.notEqual(top.includes(`${g}1`), top.includes(`${g}2`), `group ${g} both in same half`);
    }
  });
  test('non power-of-two field gives byes to the top seeds', () => {
    const b = buildBracket(['s1', 's2', 's3', 's4', 's5', 's6']);
    const byes = b.filter((x) => x.bye);
    assert.equal(byes.length, 2);
    assert.deepEqual(byes.map((x) => x.a).sort(), ['s1', 's2']);
  });
  test('each match links to the correct slot of the next round; final links nowhere', () => {
    const b = buildBracket(['1', '2', '3', '4']);
    assert.deepEqual(b[0].next, { round: 2, position: 0, slot: 'a' });
    assert.deepEqual(b[1].next, { round: 2, position: 0, slot: 'b' });
    assert.equal(b[2].next, null);
  });
  test('round labels use Vietnamese names', () => {
    assert.equal(roundLabel(3, 3), 'Chung kết');
    assert.equal(roundLabel(2, 3), 'Bán kết');
    assert.equal(roundLabel(1, 4), 'Vòng 1/8');
  });
});

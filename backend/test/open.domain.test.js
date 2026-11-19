'use strict';
/** Test thuần cho giải mở rộng: bốc thăm ngẫu nhiên tách CLB, xếp lịch nhánh theo trận dẫn vào. */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { randomDraw, partitionKey, clubKey } = require('../src/domain/draw');
const { scheduleMatches } = require('../src/domain/schedule');

/** RNG có hạt giống (mulberry32) để test lặp lại được. */
function seeded(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

const mk = (n, clubOf = () => '') => Array.from({ length: n }, (_, i) => ({ id: `e${String(i).padStart(2, '0')}`, club: clubOf(i) }));

describe('randomDraw', () => {
  test('mọi đội vào đúng 1 bảng, kích thước lệch tối đa 1', () => {
    const r = randomDraw(mk(11), 3, { rng: seeded(1) });
    const all = r.groups.flatMap((g) => g.entryIds).sort();
    assert.deepEqual(all, mk(11).map((e) => e.id).sort());
    const sizes = r.groups.map((g) => g.entryIds.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    assert.deepEqual(r.groups.map((g) => g.name), ['A', 'B', 'C']);
  });

  test('bốc thăm phụ là hoán vị 1..n', () => {
    const r = randomDraw(mk(8), 2, { rng: seeded(2) });
    assert.deepEqual([...r.lots.values()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('ngẫu nhiên: các lần bốc cho nhiều kết quả khác nhau', () => {
    const keys = new Set();
    for (let s = 0; s < 30; s += 1) keys.add(partitionKey(randomDraw(mk(8), 2, { rng: seeded(100 + s) }).groups.map((g) => g.entryIds)));
    assert.ok(keys.size > 10, `chỉ có ${keys.size} cách chia khác nhau`);
  });

  test('bốc lại luôn khác lần trước khi tồn tại cách chia khác', () => {
    const entries = mk(4);
    const first = randomDraw(entries, 2, { rng: seeded(7) });
    const avoid = partitionKey(first.groups.map((g) => g.entryIds));
    for (let s = 0; s < 20; s += 1) {
      const again = randomDraw(entries, 2, { rng: seeded(s), avoid });
      assert.notEqual(partitionKey(again.groups.map((g) => g.entryIds)), avoid);
      assert.equal(again.sameAsBefore, false);
    }
  });

  test('chỉ có 1 cách chia (1 bảng) → trả về kèm sameAsBefore', () => {
    const entries = mk(3);
    const avoid = partitionKey([entries.map((e) => e.id)]);
    assert.equal(randomDraw(entries, 1, { rng: seeded(3), avoid }).sameAsBefore, true);
  });

  test('tách CLB: 4 đội cùng CLB / 4 bảng → mỗi bảng 1 đội', () => {
    for (let s = 0; s < 20; s += 1) {
      const r = randomDraw(mk(12, (i) => (i < 4 ? 'Smash Team' : i < 8 ? `CLB ${i}` : '')), 4, { rng: seeded(s) });
      for (const g of r.groups) {
        const smash = g.entryIds.filter((id) => Number(id.slice(1)) < 4).length;
        assert.equal(smash, 1);
      }
    }
  });

  test('CLB đông hơn số bảng → chia đều (chênh tối đa 1)', () => {
    const r = randomDraw(mk(9, (i) => (i < 5 ? ' smash  TEAM ' : '')), 2, { rng: seeded(9) });
    const counts = r.groups.map((g) => g.entryIds.filter((id) => Number(id.slice(1)) < 5).length).sort();
    assert.deepEqual(counts, [2, 3]);
  });

  test('clubKey chuẩn hoá hoa thường & khoảng trắng', () => {
    assert.equal(clubKey('  Smash   Team '), clubKey('smash team'));
    assert.equal(clubKey(null), '');
  });

  test('thiếu đội → RangeError', () => {
    assert.throws(() => randomDraw(mk(3), 2), RangeError);
  });
});

describe('scheduleMatches (nhánh & trận đang đánh)', () => {
  const start = new Date('2026-12-06T01:00:00Z');

  test('trận vòng sau bắt đầu sau trận dẫn vào + nghỉ 1 khung', () => {
    const qf = ['q1', 'q2', 'q3', 'q4'].map((id, i) => ({ id, participants: [`p${i * 2}`, `p${i * 2 + 1}`], priority: 10_000 + i }));
    const sf = [
      { id: 's1', participants: [], priority: 20_000, after: ['q1', 'q2'] },
      { id: 's2', participants: [], priority: 20_001, after: ['q3', 'q4'] },
    ];
    const f = { id: 'f', participants: [], priority: 30_000, after: ['s1', 's2'] };
    const out = scheduleMatches([...qf, ...sf, f], { courts: 4, startAt: start, slotMinutes: 30 });
    const slot = Object.fromEntries(out.map((s) => [s.id, s.slot]));
    assert.equal(out.length, 7);
    for (const q of ['q1', 'q2', 'q3', 'q4']) assert.equal(slot[q], 0);
    assert.equal(slot.s1, 2);
    assert.equal(slot.s2, 2);
    assert.equal(slot.f, 4);
  });

  test('sân & VĐV đang đánh bị chặn ở khung đầu', () => {
    const ms = [
      { id: 'a', participants: ['x', 'y'], priority: 1 },
      { id: 'b', participants: ['z', 'w'], priority: 2 },
    ];
    const out = scheduleMatches(ms, { courts: 2, startAt: start, slotMinutes: 30, blocked: { courts: [1], participants: ['x'] } });
    const a = out.find((s) => s.id === 'a');
    const b = out.find((s) => s.id === 'b');
    assert.equal(b.slot, 0);
    assert.equal(b.court, 2);
    assert.equal(a.slot, 1);
  });
});

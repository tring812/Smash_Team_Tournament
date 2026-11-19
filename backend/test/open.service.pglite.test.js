'use strict';
/**
 * Test service layer cho giải mở rộng trên PGlite (Postgres WASM trong bộ nhớ) — không cần cài Postgres.
 * Tự skip nếu chưa cài devDependency @electric-sql/pglite.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000a1', full_name: 'Admin', role: 'admin' };
const REF = { id: '00000000-0000-4000-8000-0000000000a2', full_name: 'Trọng tài', role: 'user' };

async function rejectsWith(p, status, code) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.code, code);
    return true;
  });
}
const win = (side) => (side === 'a' ? [[21, 10], [21, 10]] : [[10, 21], [10, 21]]);
const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

describe('giải mở rộng (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  /** @type {any} */ let t;
  /** @type {any} */ let cat;

  before(async () => {
    // eslint-disable-next-line global-require
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    for (const u of [ADMIN, REF]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
    t = await svc.createTournament(pool, ADMIN, { slug: 'open-cup', name: 'Smash Open Cup', startsAt: future(7), courts: 4 });
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    cat = await svc.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 2, advancePerGroup: 2 });
    const clubs = ['Smash Team', 'Smash Team', 'Cầu Lông Q7', 'Cầu Lông Q7', '', '', '', ''];
    await svc.addEntries(pool, ADMIN, cat.id, clubs.map((club, i) => ({ player1Name: `VĐV ${i + 1}`, club })));
  });
  after(async () => { await pool?.end(); });

  const groupsOf = async () => (await svc.groupStandings(pool, cat.id)).map((g) => g.standings.map((r) => r.entryId));

  test('bốc thăm ngẫu nhiên: 2 bảng × 4, tách CLB, có lot, ghi nhật ký', async () => {
    const r = await svc.drawGroups(pool, ADMIN, cat.id);
    assert.equal(r.redraw, false);
    assert.equal(r.matchCount, 12);
    const entries = await svc.listEntries(pool, cat.id);
    for (const club of ['Smash Team', 'Cầu Lông Q7']) {
      const gs = entries.filter((e) => e.club === club).map((e) => e.group_name);
      assert.notEqual(gs[0], gs[1], `${club} bị xếp chung bảng`);
    }
    assert.ok(entries.every((e) => e.draw_lot >= 1));
    const ev = await svc.listEvents(pool, ADMIN, t.id);
    assert.equal(ev[0].action, 'draw');
  });

  test('bốc lại → cách chia khác lần trước', async () => {
    for (let i = 0; i < 3; i += 1) {
      const before = (await groupsOf()).map((g) => [...g].sort().join()).sort().join('|');
      const r = await svc.drawGroups(pool, ADMIN, cat.id);
      assert.equal(r.redraw, true);
      const now = (await groupsOf()).map((g) => [...g].sort().join()).sort().join('|');
      assert.notEqual(now, before);
    }
  });

  test('đổi chỗ 2 đội giữa 2 bảng → sinh lại vòng tròn', async () => {
    const [ga, gb] = await groupsOf();
    await svc.swapEntries(pool, ADMIN, cat.id, ga[0], gb[0]);
    const [na, nb] = await groupsOf();
    assert.ok(na.includes(gb[0]) && nb.includes(ga[0]));
    const ms = await svc.listMatches(pool, t.id, { categoryId: cat.id });
    assert.equal(ms.length, 12);
    await rejectsWith(svc.swapEntries(pool, ADMIN, cat.id, na[0], na[1]), 422);
  });

  test('sửa VĐV trước khi thi đấu', async () => {
    const [ga] = await groupsOf();
    const e = await svc.updateEntry(pool, ADMIN, ga[0], { player1Name: 'VĐV Thay Thế', club: 'Khách mời' });
    assert.equal(e.name, 'VĐV Thay Thế');
  });

  test('xếp lịch vòng bảng: chặn giờ đã qua; nhánh bắt buộc giờ', async () => {
    await rejectsWith(svc.scheduleTournament(pool, ADMIN, t.id, { stage: 'group', startAt: '2020-01-01T08:00:00+07:00' }), 422);
    await rejectsWith(svc.scheduleTournament(pool, ADMIN, t.id, { stage: 'knockout' }), 422);
    const r = await svc.scheduleTournament(pool, ADMIN, t.id, { stage: 'group' });
    assert.equal(r.scheduled, 12);
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
  });

  test('truất quyền ở vòng bảng: huỷ mọi trận (kể cả đã đánh), BXH bỏ đội đó; huỷ truất quyền khôi phục', async () => {
    const [ga] = await groupsOf();
    const ms = (await svc.listMatches(pool, t.id, { categoryId: cat.id })).filter((m) => m.groupName === 'A');
    const victim = ga[0];
    const played = ms.find((m) => m.a.id === victim || m.b.id === victim);
    await svc.recordScore(pool, REF, played.id, { action: 'finish', version: played.version, games: win('a') });

    const r =await svc.disqualifyEntry(pool, ADMIN, victim, 'Sai danh tính VĐV');
    assert.equal(r.cancelledMatches, 3);
    const groupA = (await svc.groupStandings(pool, cat.id))[0];
    const dqRow = groupA.standings.find((s) => s.entryId === victim);
    assert.equal(dqRow.disqualified, true);
    assert.equal(groupA.standings.filter((s) => !s.disqualified).every((s) => s.played === 0), true);
    const cancelled = (await svc.listMatches(pool, t.id, { categoryId: cat.id })).filter((m) => m.status === 'cancelled');
    assert.equal(cancelled.length, 3);
    await rejectsWith(svc.recordScore(pool, REF, cancelled[0].id, { action: 'save', version: cancelled[0].version, games: [[1, 0]] }), 409, 'MATCH_CANCELLED');

    const back = await svc.reinstateEntry(pool, ADMIN, victim);
    assert.equal(back.restoredMatches, 3);
    const restored = await svc.getMatch(pool, played.id);
    assert.equal(restored.status, 'finished');
    await svc.disqualifyEntry(pool, ADMIN, victim, 'Sai danh tính VĐV');
  });

  test('hết vòng bảng → nhánh; xếp cả nhánh 1 lần; truất quyền ở nhánh → walkover', async () => {
    for (const m of await svc.listMatches(pool, t.id, { categoryId: cat.id })) {
      if (!['scheduled', 'pending'].includes(m.status)) continue;
      await svc.recordScore(pool, ADMIN, m.id, { action: 'finish', version: m.version, games: win('a') });
    }
    const ko = await svc.generateKnockout(pool, ADMIN, cat.id);
    assert.equal(ko.qualifiers, 4);
    const sch = await svc.scheduleTournament(pool, ADMIN, t.id, { stage: 'knockout', startAt: future(14), courts: 2, slotMinutes: 40 });
    assert.equal(sch.scheduled, 3); // 2 bán kết + chung kết (chưa biết đội) xếp luôn
    const br = await svc.getBracket(pool, cat.id);
    const [sf1, sf2] = br.rounds[0].matches;
    const fin = br.rounds[1].matches[0];
    assert.ok(new Date(fin.scheduledAt) - new Date(sf1.scheduledAt) >= 2 * 40 * 60_000);

    await svc.disqualifyEntry(pool, ADMIN, sf1.a.id, 'Vắng mặt');
    const s1 = await svc.getMatch(pool, sf1.id);
    assert.equal(s1.status, 'walkover');
    assert.equal(s1.winner, 'b');
    const f = await svc.getMatch(pool, fin.id);
    assert.equal(f.a.id, sf1.b.id);

    // Truất quyền bán kết 2 → đối thủ đi tiếp; chung kết đủ 2 đội, vẫn giữ lịch đã xếp.
    await svc.disqualifyEntry(pool, ADMIN, sf2.a.id, 'Vi phạm điều lệ');
    const s2 = await svc.getMatch(pool, sf2.id);
    assert.equal(s2.status, 'walkover');
    const f2 = await svc.getMatch(pool, fin.id);
    assert.equal(f2.status, 'scheduled');
    assert.ok(f2.a && f2.b);
  });
});

'use strict';
/**
 * Luật điểm theo vòng: vòng bảng 11 điểm 1 game, loại trực tiếp 15 điểm 2/3, chung kết 21 BWF.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');
const rr = require('../src/domain/roundRules');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000e1', full_name: 'Admin', role: 'admin' };
const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString();
const R = (p, m, g) => ({ pointsToWin: p, maxPoints: m, gamesToWin: g });

async function rejectsWith(p, status, code, re) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.code, code);
    if (re) assert.match(err.message, re);
    return true;
  });
}

test('effectiveRules: vòng riêng → mọi vòng loại → mặc định nội dung', () => {
  const cat = { points_to_win: 21, max_points: 30, games_to_win: 2, round_rules: { group: R(11, 15, 1), knockout: { '*': R(15, 21, 2), 1: R(21, 30, 3) } } };
  assert.deepEqual(rr.effectiveRules(cat, 'group', 3, null), R(11, 15, 1));
  assert.deepEqual(rr.effectiveRules(cat, 'knockout', 3, 3), R(21, 30, 3), 'vòng 3/3 = chung kết');
  assert.deepEqual(rr.effectiveRules(cat, 'knockout', 2, 3), R(15, 21, 2), 'bán kết dùng "*"');
  assert.deepEqual(rr.effectiveRules({ ...cat, round_rules: {} }, 'knockout', 1, 3), R(21, 30, 2), 'không luật riêng → mặc định');
  assert.throws(() => rr.buildRoundRules([{ stage: 'group', ...R(21, 15, 2) }]), RangeError);
  assert.throws(() => rr.buildRoundRules([{ stage: 'knockout', fromEnd: 1, ...R(21, 30, 2) }, { stage: 'knockout', fromEnd: 1, ...R(15, 21, 2) }]), /một luật/);
  assert.deepEqual(rr.buildRoundRules([]), {});
});

describe('Luật điểm theo vòng (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  /** @type {any} */ let t;
  /** @type {any} */ let ms;

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [ADMIN.id, ADMIN.full_name, ADMIN.role]);
    t = await svc.createTournament(pool, ADMIN, { slug: 'rr-cup', name: 'RR Cup', startsAt: future(7), courts: 4 });
    ms = await svc.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 2, advancePerGroup: 2 });
    await svc.addEntries(pool, ADMIN, ms.id, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n) => ({ player1Name: `VĐV ${n}` })));
    await svc.drawGroups(pool, ADMIN, ms.id);
    await svc.updateTournament(pool, ADMIN, t.id, { status: 'published' });
  });
  after(async () => { await pool?.end(); });

  const groupMatches = async () => (await svc.listMatches(pool, t.id)).filter((m) => m.stage === 'group');

  test('đặt luật theo vòng; trận vòng bảng dùng 11 điểm 1 game', async () => {
    await svc.setRoundRules(pool, ADMIN, ms.id, [
      { stage: 'group', ...R(11, 15, 1) },
      { stage: 'knockout', fromEnd: null, ...R(15, 21, 2) },
      { stage: 'knockout', fromEnd: 1, ...R(21, 30, 2) },
    ]);
    const [m] = await groupMatches();
    assert.deepEqual(m.rules, R(11, 15, 1));
    // 11-5 một game là đủ thắng — với luật mặc định 21 điểm 2 game thì không hợp lệ.
    await svc.recordScore(pool, ADMIN, m.id, { action: 'finish', version: m.version, games: [[11, 5]] });
    const ev = (await svc.listEvents(pool, ADMIN, t.id)).find((e) => e.action === 'rules_update');
    assert.ok(ev);
  });

  test('khoá: không đổi luật vòng bảng khi đã có trận bắt đầu; vẫn đổi được luật loại trực tiếp và luật mặc định', async () => {
    await rejectsWith(svc.setRoundRules(pool, ADMIN, ms.id, [{ stage: 'group', ...R(15, 21, 1) }]), 409, 'RULES_LOCKED', /Vòng bảng/);
    await svc.setRoundRules(pool, ADMIN, ms.id, [
      { stage: 'group', ...R(11, 15, 1) },
      { stage: 'knockout', fromEnd: null, ...R(15, 21, 1) },
      { stage: 'knockout', fromEnd: 1, ...R(21, 30, 2) },
    ]);
    // Mặc định không còn trận đã bắt đầu nào dùng → đổi được.
    await svc.updateCategory(pool, ADMIN, ms.id, { pointsToWin: 15, maxPoints: 21 });
    // Bỏ luật riêng vòng bảng = vòng bảng quay về mặc định (15) ≠ 11 đang dùng → khoá.
    await rejectsWith(svc.setRoundRules(pool, ADMIN, ms.id, []), 409, 'RULES_LOCKED');
    await rejectsWith(svc.setRoundRules(pool, ADMIN, ms.id, [{ stage: 'group', ...R(21, 15, 1) }]), 422);
  });

  test('nhánh: bán kết theo "mọi vòng loại", chung kết theo luật riêng; trận bán kết đã đánh khoá luật bán kết', async () => {
    for (const m of await groupMatches()) {
      if (m.status === 'finished') continue;
      await svc.recordScore(pool, ADMIN, m.id, { action: 'finish', version: m.version, games: [[11, 3]] });
    }
    await svc.generateKnockout(pool, ADMIN, ms.id);
    const ko = (await svc.listMatches(pool, t.id)).filter((m) => m.stage === 'knockout');
    const semi = ko.find((m) => m.roundLabel === 'Bán kết');
    const final = ko.find((m) => m.roundLabel === 'Chung kết');
    assert.deepEqual(semi.rules, R(15, 21, 1));
    assert.deepEqual(final.rules, R(21, 30, 2));
    await svc.recordScore(pool, ADMIN, semi.id, { action: 'save', version: semi.version, games: [[3, 1]] });
    await rejectsWith(svc.setRoundRules(pool, ADMIN, ms.id, [
      { stage: 'group', ...R(11, 15, 1) }, { stage: 'knockout', fromEnd: 2, ...R(21, 30, 2) }, { stage: 'knockout', fromEnd: 1, ...R(21, 30, 2) },
    ]), 409, 'RULES_LOCKED', /Bán kết/);
    // Chung kết chưa đánh → đổi được (vd 3 game).
    await svc.setRoundRules(pool, ADMIN, ms.id, [
      { stage: 'group', ...R(11, 15, 1) }, { stage: 'knockout', fromEnd: null, ...R(15, 21, 1) }, { stage: 'knockout', fromEnd: 1, ...R(21, 30, 3) },
    ]);
    assert.deepEqual((await svc.getMatch(pool, final.id)).rules, R(21, 30, 3));
  });
});

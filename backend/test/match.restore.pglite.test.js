'use strict';
/** Phục hồi trận phải nhận sân/VĐV hợp lệ và hoàn tác toàn bộ khi xung đột. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const svc = require('../src/services/tournamentService');
const courts = require('../src/services/courtService');
let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }
const ADMIN = { id: '00000000-0000-4000-8000-0000000000c1', full_name: 'BTC thử', role: 'admin' };
const OTHER = { id: '00000000-0000-4000-8000-0000000000c2', full_name: 'Người ngoài', role: 'user' };

describe('Phục hồi sân (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  let pool;
  let sequence = 0;
  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    const dir = path.join(__dirname, '..', 'migrations');
    for (const f of fs.readdirSync(dir).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const u of [ADMIN, OTHER]) await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
  });
  after(async () => { await pool?.end(); });
  async function fixture() {
    const t = await svc.createTournament(pool, ADMIN, { slug: `restore-${++sequence}`, name: 'Giải thử phục hồi', startsAt: new Date(Date.now() + 7 * 86400000).toISOString(), courts: 2 });
    const cat = await svc.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 1 });
    await svc.addEntries(pool, ADMIN, cat.id, ['An', 'Bình', 'Chi', 'Dũng'].map((player1Name) => ({ player1Name })));
    await svc.drawGroups(pool, ADMIN, cat.id);
    const matches = await svc.listMatches(pool, t.id);
    const a = matches[0];
    const b = matches.find((m) => ![a.a.id, a.b.id].includes(m.a.id) && ![a.a.id, a.b.id].includes(m.b.id));
    return { t, a, b };
  }
  async function finish(a) {
    await courts.callMatch(pool, ADMIN, a.id, { court: 1 });
    let m = await svc.getMatch(pool, a.id);
    await svc.startMatch(pool, ADMIN, a.id, { version: m.version });
    m = await svc.getMatch(pool, a.id);
    await svc.recordScore(pool, ADMIN, a.id, { action: 'finish', version: m.version, games: [[21, 0], [21, 0]] });
  }
  async function snapshot(tid) {
    return {
      matches: (await pool.query('SELECT * FROM matches WHERE tournament_id = $1 ORDER BY id', [tid])).rows,
      entries: (await pool.query('SELECT e.* FROM entries e JOIN categories c ON c.id = e.category_id WHERE c.tournament_id = $1 ORDER BY e.id', [tid])).rows,
      events: (await pool.query('SELECT * FROM tournament_events WHERE tournament_id = $1 ORDER BY id', [tid])).rows,
      scores: (await pool.query('SELECT s.* FROM match_score_events s JOIN matches m ON m.id = s.match_id WHERE m.tournament_id = $1 ORDER BY s.id', [tid])).rows,
    };
  }
  for (const action of ['reopen', 'reinstate']) {
    for (const kind of ['court', 'player']) {
      test(`${action}: chặn ${kind}, không để lại thay đổi; thử lại khi rảnh`, async () => {
        const { t, a, b } = await fixture();
        if (action === 'reopen') await finish(a);
        else {
          await courts.callMatch(pool, ADMIN, a.id, { court: 1 });
          await svc.disqualifyEntry(pool, ADMIN, a.a.id, 'Kiểm thử');
        }
        let busy = b;
        if (kind === 'player') {
          const cat = await svc.createCategory(pool, ADMIN, t.id, { code: 'XD', name: 'Đôi nam nữ', isDoubles: true, groupCount: 1 });
          await svc.addEntries(pool, ADMIN, cat.id, [{ player1Name: 'Hoa', player2Name: a.a.name }, { player1Name: 'Lan', player2Name: 'Mai' }]);
          await svc.drawGroups(pool, ADMIN, cat.id);
          busy = (await svc.listMatches(pool, t.id)).find((m) => m.category.id === cat.id);
        }
        await courts.callMatch(pool, ADMIN, busy.id, { court: kind === 'court' ? 1 : 2 });
        const restore = () => action === 'reopen' ? svc.reopenMatch(pool, ADMIN, a.id) : svc.reinstateEntry(pool, ADMIN, a.a.id);
        const before = await snapshot(t.id);
        await assert.rejects(restore(), (e) => e.status === 409 && e.code === (kind === 'court' ? 'COURT_BUSY' : 'PLAYER_BUSY'));
        assert.deepEqual(await snapshot(t.id), before);
        await courts.uncallMatch(pool, ADMIN, busy.id);
        await restore();
        const m = await svc.getMatch(pool, a.id);
        assert.equal(m.status, action === 'reopen' ? 'live' : 'pending');
        assert.equal(m.court, 1);
        assert.ok(m.courtSince);
        if (action === 'reopen') assert.deepEqual(m.games, [[21, 0], [21, 0]]);
      });
    }
  }
  test('huỷ truất quyền khôi phục trận live và giữ nguyên điểm khi sân rảnh', async () => {
    const { a } = await fixture();
    await courts.callMatch(pool, ADMIN, a.id, { court: 1 });
    let m = await svc.getMatch(pool, a.id);
    await svc.startMatch(pool, ADMIN, a.id, { version: m.version });
    m = await svc.getMatch(pool, a.id);
    await svc.recordScore(pool, ADMIN, a.id, { action: 'save', version: m.version, games: [[3, 1]] });
    await svc.disqualifyEntry(pool, ADMIN, a.a.id, 'Kiểm thử');
    await svc.reinstateEntry(pool, ADMIN, a.a.id);
    m = await svc.getMatch(pool, a.id);
    assert.equal(m.status, 'live');
    assert.deepEqual(m.games, [[3, 1]]);
    assert.equal(m.court, 1);
  });
  test('trận đã kết thúc hoặc chỉ có sân dự kiến không chiếm sân khi phục hồi', async () => {
    for (const completed of [false, true]) {
      const { a, b } = await fixture();
      if (completed) await finish(a);
      else await courts.moveMatch(pool, ADMIN, a.id, { court: 1 });
      await svc.disqualifyEntry(pool, ADMIN, a.a.id, 'Kiểm thử');
      await courts.callMatch(pool, ADMIN, b.id, { court: 1 });
      await svc.reinstateEntry(pool, ADMIN, a.a.id);
      const m = await svc.getMatch(pool, a.id);
      assert.equal(m.status, completed ? 'finished' : 'pending');
      assert.equal(m.court, 1);
    }
  });
  test('người ngoài không được mở lại hoặc huỷ truất quyền', async () => {
    const { t, a } = await fixture();
    await finish(a);
    let before = await snapshot(t.id);
    await assert.rejects(svc.reopenMatch(pool, OTHER, a.id), (e) => e.status === 403);
    assert.deepEqual(await snapshot(t.id), before);
    await svc.disqualifyEntry(pool, ADMIN, a.a.id, 'Kiểm thử');
    before = await snapshot(t.id);
    await assert.rejects(svc.reinstateEntry(pool, OTHER, a.a.id), (e) => e.status === 403);
    assert.deepEqual(await snapshot(t.id), before);
  });
});

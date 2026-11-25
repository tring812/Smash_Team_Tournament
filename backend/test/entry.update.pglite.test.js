'use strict';
/** Sửa đội: một hồ sơ VĐV chỉ thuộc một đội trong mỗi nội dung, kể cả khi đã bốc thăm. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');
const categorySvc = require('../src/services/categoryService');
const entrySvc = require('../src/services/entryService');
const matchSvc = require('../src/services/matchService');
const ADMIN = { id: '00000000-0000-4000-8000-0000000000f1', full_name: 'Quản trị viên thử nghiệm', role: 'admin' };
const REF = { id: '00000000-0000-4000-8000-0000000000f2', full_name: 'Trọng tài thử nghiệm', role: 'user' };
const OUTSIDER = { id: '00000000-0000-4000-8000-0000000000f3', full_name: 'BTC giải khác', role: 'user' };

async function rejectsDuplicate(promise) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, 409);
    assert.equal(err.code, 'ATHLETE_ALREADY_ENTERED');
    return true;
  });
}

describe('Sửa đội không đăng ký trùng hồ sơ VĐV (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  let sequence = 0;

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    const dir = path.join(__dirname, '..', 'migrations');
    for (const f of fs.readdirSync(dir).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const u of [ADMIN, REF, OUTSIDER]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
  });
  after(async () => { await pool?.end(); });

  async function fixture(isDoubles = false) {
    const t = await svc.createTournament(pool, ADMIN, {
      slug: `entry-edit-${++sequence}`, name: 'Giải kiểm thử sửa đội', startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    const cat = await categorySvc.createCategory(pool, ADMIN, t.id, {
      code: isDoubles ? 'MD' : 'MS', name: isDoubles ? 'Đôi nam' : 'Đơn nam', isDoubles, groupCount: 1,
    });
    const entries = await entrySvc.addEntries(pool, ADMIN, cat.id, isDoubles ? [
      { player1Name: 'An', player2Name: 'Bình' },
      { player1Name: 'Chi', player2Name: 'Dũng' },
    ] : [{ player1Name: 'An' }, { player1Name: 'Bình' }, { player1Name: 'Chi' }]);
    return { t, cat, entries };
  }

  async function entry(id) {
    return (await pool.query('SELECT * FROM entries WHERE id = $1', [id])).rows[0];
  }

  async function snapshot(tid) {
    return {
      athletes: (await pool.query('SELECT * FROM athletes WHERE tournament_id = $1 ORDER BY id', [tid])).rows,
      events: await svc.listEvents(pool, ADMIN, tid),
    };
  }

  for (const drawn of [false, true]) {
    test(`nội dung đơn: chặn đổi sang VĐV ở đội khác ${drawn ? 'sau' : 'trước'} khi bốc thăm`, async () => {
      const { t, cat, entries } = await fixture();
      if (drawn) await svc.drawGroups(pool, ADMIN, cat.id);
      const beforeEntry = await entry(entries[1].id);
      const before = await snapshot(t.id);
      await rejectsDuplicate(entrySvc.updateEntry(pool, ADMIN, entries[1].id, { player1Name: ' an ', club: 'CLB thử nghiệm' }));
      assert.deepEqual(await entry(entries[1].id), beforeEntry, 'giữ nguyên đội khi từ chối');
      assert.deepEqual(await snapshot(t.id), before, 'không đổi hồ sơ hoặc ghi nhật ký khi từ chối');
      if (!drawn) await svc.drawGroups(pool, ADMIN, cat.id);
      const matches = await matchSvc.listMatches(pool, t.id);
      assert.equal(matches.length, 3);
      for (const m of matches) {
        assert.notEqual(m.a.players[0].athleteId, m.b.players[0].athleteId, 'không có trận tự đấu');
      }
    });
  }

  for (const slot of [1, 2]) {
    for (const otherSlot of [1, 2]) {
      test(`nội dung đôi: chặn VĐV ${slot} trùng VĐV ${otherSlot} của đội khác`, async () => {
        const { t, entries } = await fixture(true);
        const beforeEntry = await entry(entries[1].id);
        const before = await snapshot(t.id);
        const input = { player1Name: 'Người mới thử nghiệm', player2Name: 'Dũng', club: 'CLB thử nghiệm' };
        input[`player${slot}Name`] = entries[0][`player${otherSlot}_name`];
        await rejectsDuplicate(entrySvc.updateEntry(pool, ADMIN, entries[1].id, input));
        assert.deepEqual(await entry(entries[1].id), beforeEntry);
        assert.deepEqual(await snapshot(t.id), before, 'rollback cả hồ sơ mới và thay đổi CLB khi sửa đội bị từ chối');
      });
    }
  }

  test('cho giữ nguyên đội và đổi thứ tự hai thành viên trong chính đội đó', async () => {
    const { t, entries } = await fixture(true);
    const e = entries[0];
    const same = await entrySvc.updateEntry(pool, ADMIN, e.id, { player1Name: 'An', player2Name: 'Bình', club: 'CLB mới' });
    assert.equal(same.player1_athlete_id, e.player1_athlete_id);
    assert.equal(same.player2_athlete_id, e.player2_athlete_id);
    const swapped = await entrySvc.updateEntry(pool, ADMIN, e.id, { player1Name: 'Bình', player2Name: 'An' });
    assert.equal(swapped.player1_athlete_id, e.player2_athlete_id);
    assert.equal(swapped.player2_athlete_id, e.player1_athlete_id);
    assert.ok((await svc.listEvents(pool, ADMIN, t.id)).some((ev) => ev.action === 'edit_entry'));
  });

  test('một VĐV vẫn được tham gia nhiều nội dung, kể cả khi sửa đội', async () => {
    const { t, entries } = await fixture();
    const doubles = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'MD', name: 'Đôi nam', isDoubles: true });
    const [target] = await entrySvc.addEntries(pool, ADMIN, doubles.id, [{ player1Name: 'Dũng', player2Name: 'Hà' }]);
    const edited = await entrySvc.updateEntry(pool, ADMIN, target.id, { player1Name: 'An', player2Name: 'Bình' });
    assert.equal(edited.player1_athlete_id, entries[0].player1_athlete_id);
    assert.equal(edited.player2_athlete_id, entries[1].player1_athlete_id);
    const people = (await pool.query('SELECT * FROM athletes WHERE tournament_id = $1', [t.id])).rows;
    assert.equal(people.filter((a) => a.full_name === 'An').length, 1, 'dùng chung hồ sơ giữa các nội dung');
  });

  test('hai người cùng tên khác hồ sơ không bị coi là đăng ký trùng', async () => {
    const { t } = await fixture();
    const cat = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'S2', name: 'Nội dung thử nghiệm', isDoubles: false });
    const entries = await entrySvc.addEntries(pool, ADMIN, cat.id, [
      { player1Name: 'Nguyễn Minh', player1StudentId: 'TEST001' },
      { player1Name: 'Nguyễn Minh', player1StudentId: 'TEST002' },
    ]);
    const edited = await entrySvc.updateEntry(pool, ADMIN, entries[1].id, { player1Name: 'Nguyễn Minh', club: 'CLB mới' });
    assert.equal(edited.player1_athlete_id, entries[1].player1_athlete_id);
    assert.notEqual(edited.player1_athlete_id, entries[0].player1_athlete_id);
  });

  test('hai yêu cầu sửa sang cùng một VĐV chỉ có một yêu cầu thành công', async () => {
    const { cat, entries } = await fixture();
    const results = await Promise.allSettled(entries.slice(0, 2).map((e) => entrySvc.updateEntry(pool, ADMIN, e.id, { player1Name: 'Người thay thế' })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected');
    assert.equal(failed.reason.code, 'ATHLETE_ALREADY_ENTERED');
    const rows = (await pool.query('SELECT player1_athlete_id FROM entries WHERE category_id = $1', [cat.id])).rows;
    assert.equal(new Set(rows.map((r) => r.player1_athlete_id)).size, rows.length);
  });

  test('trọng tài và BTC giải khác không được sửa đội, không tạo hồ sơ mới', async () => {
    const { t, entries } = await fixture();
    await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    const other = await fixture();
    await svc.upsertStaff(pool, ADMIN, other.t.id, { userId: OUTSIDER.id, role: 'organizer' });
    const beforeEntry = await entry(entries[0].id);
    const before = await snapshot(t.id);
    for (const viewer of [REF, OUTSIDER]) {
      await assert.rejects(entrySvc.updateEntry(pool, viewer, entries[0].id, { player1Name: 'Người thay thế' }), (err) => err.status === 403);
    }
    assert.deepEqual(await entry(entries[0].id), beforeEntry);
    assert.deepEqual(await snapshot(t.id), before);
  });
});

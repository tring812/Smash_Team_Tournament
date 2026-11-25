'use strict';
/**
 * CRUD nội dung thi đấu (BTC) trên PGlite: quy tắc khoá theo giai đoạn, xoá dây chuyền,
 * nhật ký vẫn còn sau khi xoá, quyền.
 */
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
const { beginMatch } = require('./support/match');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000b1', full_name: 'Admin', role: 'admin' };
const OUTSIDER = { id: '00000000-0000-4000-8000-0000000000b2', full_name: 'Khách', role: 'user' };

async function rejectsWith(p, status, code) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

describe('CRUD nội dung thi đấu (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  /** @type {any} */ let t;

  before(async () => {
    // eslint-disable-next-line global-require
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    for (const u of [ADMIN, OUTSIDER]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
    t = await svc.createTournament(pool, ADMIN, {
      slug: 'crud-cup', name: 'CRUD Cup', startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
  });
  after(async () => { await pool?.end(); });

  const addFour = (cid) => entrySvc.addEntries(pool, ADMIN, cid, ['An', 'Bình', 'Chi', 'Dũng'].map((n) => ({ player1Name: n })));

  test('tạo + sửa tên/mã khi chưa bốc thăm; ghi nhật ký', async () => {
    const cat = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false });
    const upd = await categorySvc.updateCategory(pool, ADMIN, cat.id, { code: 'MS1', name: 'Đơn nam A', groupCount: 1, isDoubles: true });
    assert.equal(upd.code, 'MS1');
    assert.equal(upd.is_doubles, true);
    const ev = await svc.listEvents(pool, ADMIN, t.id);
    assert.deepEqual(ev.slice(0, 2).map((e) => e.action), ['category_update', 'category_create']);
  });

  test('trùng mã → 409; trần điểm < điểm thắng → 422; người ngoài → 403', async () => {
    const a = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'WS', name: 'Đơn nữ', isDoubles: false });
    await rejectsWith(categorySvc.updateCategory(pool, ADMIN, a.id, { code: 'MS1' }), 409, 'CATEGORY_EXISTS');
    await rejectsWith(categorySvc.updateCategory(pool, ADMIN, a.id, { pointsToWin: 21, maxPoints: 15 }), 422);
    await rejectsWith(categorySvc.updateCategory(pool, OUTSIDER, a.id, { name: 'X' }), 403);
    await rejectsWith(categorySvc.deleteCategory(pool, OUTSIDER, a.id), 403);
  });

  test('đã có đội → không đổi đơn/đôi; đã bốc thăm → không đổi số bảng, vẫn đổi được tên & luật điểm', async () => {
    const cat = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'XD', name: 'Đôi nam nữ', isDoubles: false, groupCount: 1 });
    await addFour(cat.id);
    await rejectsWith(categorySvc.updateCategory(pool, ADMIN, cat.id, { isDoubles: true }), 409, 'CATEGORY_LOCKED');
    await svc.drawGroups(pool, ADMIN, cat.id);
    await rejectsWith(categorySvc.updateCategory(pool, ADMIN, cat.id, { groupCount: 2 }), 409, 'CATEGORY_LOCKED');
    const ok = await categorySvc.updateCategory(pool, ADMIN, cat.id, { name: 'Đôi hỗn hợp', pointsToWin: 15, maxPoints: 21 });
    assert.equal(ok.points_to_win, 15);
    // Gửi lại đúng giá trị cũ không bị coi là "thay đổi" → không bị khoá.
    await categorySvc.updateCategory(pool, ADMIN, cat.id, { groupCount: 1, name: 'Đôi hỗn hợp' });
  });

  test('có trận bắt đầu → khoá luật điểm & không xoá được; chưa đánh → xoá dây chuyền, nhật ký còn', async () => {
    const played = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'MD', name: 'Đôi nam', isDoubles: false, groupCount: 1 });
    await addFour(played.id);
    await svc.drawGroups(pool, ADMIN, played.id);
    const [pending] = await matchSvc.listMatches(pool, t.id, { categoryId: played.id });
    const m = await beginMatch(pool, ADMIN, ADMIN, pending);
    await matchSvc.recordScore(pool, ADMIN, m.id, { action: 'save', version: m.version, games: [[3, 1]] });
    await rejectsWith(categorySvc.updateCategory(pool, ADMIN, played.id, { gamesToWin: 1 }), 409, 'CATEGORY_LOCKED');
    await rejectsWith(categorySvc.deleteCategory(pool, ADMIN, played.id), 409, 'CATEGORY_STARTED');

    const fresh = await categorySvc.createCategory(pool, ADMIN, t.id, { code: 'WD', name: 'Đôi nữ', isDoubles: false, groupCount: 1 });
    await addFour(fresh.id);
    await svc.drawGroups(pool, ADMIN, fresh.id);
    await categorySvc.deleteCategory(pool, ADMIN, fresh.id);
    const left = await pool.query('SELECT (SELECT count(*)::int FROM entries WHERE category_id = $1) AS e, (SELECT count(*)::int FROM matches WHERE category_id = $1) AS m', [fresh.id]);
    assert.deepEqual(left.rows[0], { e: 0, m: 0 });
    const ev = await svc.listEvents(pool, ADMIN, t.id);
    const del = ev.find((e) => e.action === 'category_delete');
    assert.equal(del.details.code, 'WD');
    assert.equal(del.category_code, null); // category_id đã thành NULL nhưng dòng nhật ký vẫn còn
    assert.ok(ev.some((e) => e.action === 'draw' && e.details.groups), 'nhật ký bốc thăm của nội dung đã xoá vẫn còn');
  });

  test('bảng nhật ký vẫn append-only khi sửa/xoá trực tiếp', async () => {
    await assert.rejects(pool.query('UPDATE tournament_events SET details = \'{}\'::jsonb'), /append-only/);
    await assert.rejects(pool.query('DELETE FROM tournament_events'), /append-only/);
  });
});

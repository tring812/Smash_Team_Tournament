'use strict';
/**
 * Quyền xem giải / nội dung (PGlite): giải nháp chỉ admin và BTC của giải thấy; khán giả, BTC giải khác,
 * trọng tài của giải đều nhận 404 (không lộ sự tồn tại); giải đã xoá 404 với cả admin; nội dung không tồn tại
 * báo "Không tìm thấy nội dung thi đấu".
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');
const categorySvc = require('../src/services/categoryService');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000f1', full_name: 'Admin', role: 'admin' };
const ORG = { id: '00000000-0000-4000-8000-0000000000f2', full_name: 'BTC giải này', role: 'user' };
const OTHER_ORG = { id: '00000000-0000-4000-8000-0000000000f3', full_name: 'BTC giải khác', role: 'user' };
const REF = { id: '00000000-0000-4000-8000-0000000000f4', full_name: 'Trọng tài', role: 'user' };
const MISSING = '00000000-0000-4000-8000-00000000dead';
const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

async function rejectsWith(p, status, message) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (message) assert.equal(err.message, message);
    return true;
  });
}

describe('Quyền xem giải và nội dung (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  /** @type {{ draft: any, draftCat: any, pub: any, pubCat: any, other: any }} */ let d;

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    for (const u of [ADMIN, ORG, OTHER_ORG, REF]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
    const draft = await svc.createTournament(pool, ADMIN, { slug: 'vis-draft', name: 'Giải nháp', startsAt: future(7) });
    const pub = await svc.createTournament(pool, ADMIN, { slug: 'vis-pub', name: 'Giải công bố', startsAt: future(7) });
    const other = await svc.createTournament(pool, ADMIN, { slug: 'vis-other', name: 'Giải khác', startsAt: future(7) });
    for (const t of [draft, pub]) {
      await svc.upsertStaff(pool, ADMIN, t.id, { userId: ORG.id, role: 'organizer' });
      await svc.upsertStaff(pool, ADMIN, t.id, { userId: REF.id, role: 'referee' });
    }
    await svc.upsertStaff(pool, ADMIN, other.id, { userId: OTHER_ORG.id, role: 'organizer' });
    const cat = { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 1, advancePerGroup: 1 };
    const draftCat = await categorySvc.createCategory(pool, ADMIN, draft.id, cat);
    const pubCat = await categorySvc.createCategory(pool, ADMIN, pub.id, cat);
    await svc.updateTournament(pool, ADMIN, pub.id, { status: 'published' });
    d = { draft, draftCat, pub, pubCat, other };
  });
  after(async () => { await pool?.end(); });

  test('giải nháp: chỉ admin và BTC của giải thấy; khán giả, BTC giải khác, trọng tài nhận 404', async () => {
    await svc.assertVisible(pool, d.draft.id, ADMIN);
    await svc.assertVisible(pool, d.draft.id, ORG);
    for (const v of [null, OTHER_ORG, REF]) {
      await rejectsWith(svc.assertVisible(pool, d.draft.id, v), 404, 'Không tìm thấy giải');
    }
  });

  test('giải đã công bố: ai cũng xem được, kể cả khách', async () => {
    for (const v of [null, ADMIN, ORG, OTHER_ORG, REF]) await svc.assertVisible(pool, d.pub.id, v);
  });

  test('giải không tồn tại hoặc đã xoá: 404 với cả admin', async () => {
    await rejectsWith(svc.assertVisible(pool, MISSING, ADMIN), 404, 'Không tìm thấy giải');
    const gone = await svc.createTournament(pool, ADMIN, { slug: 'vis-gone', name: 'Giải đã xoá', startsAt: future(7) });
    const goneCat = await categorySvc.createCategory(pool, ADMIN, gone.id, { code: 'WS', name: 'Đơn nữ', isDoubles: false, groupCount: 1, advancePerGroup: 1 });
    await svc.deleteTournament(pool, ADMIN, gone.id, 'vis-gone');
    await rejectsWith(svc.assertVisible(pool, gone.id, ADMIN), 404, 'Không tìm thấy giải');
    await rejectsWith(svc.assertCategoryVisible(pool, goneCat.id, ADMIN), 404, 'Không tìm thấy giải');
  });

  test('nội dung: trả id giải khi được xem; cùng quy tắc với giải; nội dung không tồn tại báo riêng', async () => {
    assert.equal(await svc.assertCategoryVisible(pool, d.pubCat.id, null), d.pub.id);
    assert.equal(await svc.assertCategoryVisible(pool, d.draftCat.id, ORG), d.draft.id);
    assert.equal(await svc.assertCategoryVisible(pool, d.draftCat.id, ADMIN), d.draft.id);
    for (const v of [null, OTHER_ORG, REF]) {
      await rejectsWith(svc.assertCategoryVisible(pool, d.draftCat.id, v), 404, 'Không tìm thấy giải');
    }
    await rejectsWith(svc.assertCategoryVisible(pool, MISSING, ADMIN), 404, 'Không tìm thấy nội dung thi đấu');
  });

  test('getTournament: viewerRole theo người xem; giải nháp ẩn với người ngoài', async () => {
    assert.equal((await svc.getTournament(pool, 'vis-pub', null)).viewerRole, null);
    assert.equal((await svc.getTournament(pool, 'vis-pub', ADMIN)).viewerRole, 'admin');
    assert.equal((await svc.getTournament(pool, 'vis-pub', ORG)).viewerRole, 'organizer');
    assert.equal((await svc.getTournament(pool, 'vis-pub', REF)).viewerRole, 'referee');
    assert.equal((await svc.getTournament(pool, 'vis-pub', OTHER_ORG)).viewerRole, null);
    assert.equal((await svc.getTournament(pool, 'vis-draft', ORG)).viewerRole, 'organizer');
    for (const v of [null, OTHER_ORG, REF]) await rejectsWith(svc.getTournament(pool, 'vis-draft', v), 404);
    const t = await svc.getTournament(pool, 'vis-pub', ORG);
    assert.equal(t.categories.length, 1);
    assert.ok(!('deleted_at' in t) && !('staff_role' in t), 'không lộ cột nội bộ');
  });
});

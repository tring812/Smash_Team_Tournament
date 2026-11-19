'use strict';
/**
 * Danh sách giải trả kèm vai trò của người xem (PGlite): thanh điều hướng dựa vào đây để
 * chỉ hiện "Trọng tài" cho tài khoản có nhiệm vụ trọng tài và liệt kê giải mà BTC quản lý được.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000e1', full_name: 'Admin', role: 'admin' };
const ORG = { id: '00000000-0000-4000-8000-0000000000e2', full_name: 'BTC', role: 'user' };
const REF_STAFF = { id: '00000000-0000-4000-8000-0000000000e3', full_name: 'TT giải', role: 'user' };
const REF_COURT = { id: '00000000-0000-4000-8000-0000000000e4', full_name: 'TT sân', role: 'user' };
const NOBODY = { id: '00000000-0000-4000-8000-0000000000e5', full_name: 'Không vai trò', role: 'user' };
const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

describe('listTournaments: vai trò người xem (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    for (const u of [ADMIN, ORG, REF_STAFF, REF_COURT, NOBODY]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
    const pub = await svc.createTournament(pool, ADMIN, { slug: 'pub-cup', name: 'Pub Cup', startsAt: future(7) });
    const draft = await svc.createTournament(pool, ADMIN, { slug: 'draft-cup', name: 'Draft Cup', startsAt: future(9) });
    await svc.updateTournament(pool, ADMIN, pub.id, { status: 'published' });
    await svc.upsertStaff(pool, ADMIN, draft.id, { userId: ORG.id, role: 'organizer' });
    await svc.upsertStaff(pool, ADMIN, pub.id, { userId: REF_STAFF.id, role: 'referee' });
    await pool.query('INSERT INTO court_referees (tournament_id, court, user_id) VALUES ($1, 1, $2)', [pub.id, REF_COURT.id]);
  });
  after(async () => { await pool?.end(); });

  const view = async (viewer) => Object.fromEntries(
    (await svc.listTournaments(pool, viewer)).map((t) => [t.slug, { myRole: t.my_role, isReferee: t.is_referee }]),
  );

  test('khán giả: chỉ giải công khai, không vai trò', async () => {
    assert.deepEqual(await view(null), { 'pub-cup': { myRole: null, isReferee: false } });
  });

  test('admin thấy cả giải nháp nhưng không tự động là trọng tài (người tạo giải là BTC của giải đó)', async () => {
    assert.deepEqual(await view(ADMIN), {
      'pub-cup': { myRole: 'organizer', isReferee: false },
      'draft-cup': { myRole: 'organizer', isReferee: false },
    });
  });

  test('BTC thấy giải nháp mình quản lý với my_role = organizer', async () => {
    const v = await view(ORG);
    assert.deepEqual(v['draft-cup'], { myRole: 'organizer', isReferee: false });
  });

  test('trọng tài theo giải và trọng tài phụ trách sân đều là is_referee', async () => {
    assert.deepEqual((await view(REF_STAFF))['pub-cup'], { myRole: 'referee', isReferee: true });
    assert.deepEqual((await view(REF_COURT))['pub-cup'], { myRole: null, isReferee: true });
  });

  test('tài khoản không có vai trò: không phải trọng tài', async () => {
    assert.deepEqual(await view(NOBODY), { 'pub-cup': { myRole: null, isReferee: false } });
  });
});

'use strict';
/**
 * BTC tự quản lý tài khoản trọng tài của giải (PGlite): tạo, sửa, đặt lại mật khẩu, khoá, gỡ —
 * và KHÔNG đụng được tài khoản đang làm ở giải của BTC khác.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

const svc = require('../src/services/tournamentService');
const refs = require('../src/services/refereeService');
const { verifyPassword } = require('../src/auth');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000f1', full_name: 'Admin', role: 'admin' };
const ORG_A = { id: '00000000-0000-4000-8000-0000000000f2', full_name: 'BTC A', role: 'user' };
const ORG_B = { id: '00000000-0000-4000-8000-0000000000f3', full_name: 'BTC B', role: 'user' };
const NOBODY = { id: '00000000-0000-4000-8000-0000000000f4', full_name: 'Người ngoài', role: 'user' };
const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

async function rejectsWith(p, status, code) {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

describe('tài khoản trọng tài do BTC quản lý (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {any} */ let pool;
  /** @type {any} */ let ta;
  /** @type {any} */ let tb;
  /** @type {any} */ let ref1;

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    for (const u of [ADMIN, ORG_A, ORG_B, NOBODY]) {
      await pool.query('INSERT INTO users (id, full_name, role) VALUES ($1, $2, $3)', [u.id, u.full_name, u.role]);
    }
    ta = await svc.createTournament(pool, ADMIN, { slug: 'giai-a', name: 'Giải A', startsAt: future(7) });
    tb = await svc.createTournament(pool, ADMIN, { slug: 'giai-b', name: 'Giải B', startsAt: future(8) });
    await svc.upsertStaff(pool, ADMIN, ta.id, { userId: ORG_A.id, role: 'organizer' });
    await svc.upsertStaff(pool, ADMIN, tb.id, { userId: ORG_B.id, role: 'organizer' });
  });
  after(async () => { await pool?.end(); });

  test('BTC tạo tài khoản trọng tài → vào giải ngay, đăng nhập được, ghi nhật ký', async () => {
    ref1 = await refs.createReferee(pool, ORG_A, ta.id, { username: 'tt.lan', fullName: 'Trọng tài Lan', password: 'matkhau-123' });
    assert.equal(ref1.role, 'user');
    const list = await refs.listReferees(pool, ORG_A, ta.id);
    assert.deepEqual(list.map((r) => [r.username, r.can_manage, r.has_password]), [['tt.lan', true, true]]);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [ref1.id]);
    assert.ok(await verifyPassword('matkhau-123', rows[0].password_hash));
    const ev = await pool.query(`SELECT action FROM tournament_events WHERE tournament_id = $1`, [ta.id]);
    assert.ok(ev.rows.some((e) => e.action === 'referee_create'));
    // Thanh điều hướng hiện "Trọng tài" cho tài khoản này.
    const ts = await svc.listTournaments(pool, { id: ref1.id, role: 'user' });
    assert.equal(ts.find((t) => t.slug === 'giai-a')?.is_referee, true);
  });

  test('tên đăng nhập trùng → 409, không để lại tài khoản mồ côi', async () => {
    await rejectsWith(refs.createReferee(pool, ORG_A, ta.id, { username: 'tt.lan', fullName: 'Lan 2', password: 'matkhau-123' }), 409, 'USERNAME_TAKEN');
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE full_name = 'Lan 2'`);
    assert.equal(rows[0].n, 0);
  });

  test('người không phải BTC của giải không tạo / xem / sửa được', async () => {
    await rejectsWith(refs.createReferee(pool, NOBODY, ta.id, { username: 'tt.x', fullName: 'X', password: 'matkhau-123' }), 403);
    await rejectsWith(refs.listReferees(pool, ORG_B, ta.id), 403);
    await rejectsWith(refs.updateReferee(pool, ORG_B, ta.id, ref1.id, { fullName: 'Chiếm' }), 403);
  });

  test('đặt lại mật khẩu / đổi tên → mọi phiên cũ bị đăng xuất', async () => {
    const before = (await pool.query('SELECT session_version FROM users WHERE id = $1', [ref1.id])).rows[0].session_version;
    const u = await refs.updateReferee(pool, ORG_A, ta.id, ref1.id, { fullName: 'Trọng tài Lan (sân 1)', password: 'moi-12345678' });
    assert.equal(u.full_name, 'Trọng tài Lan (sân 1)');
    const after = (await pool.query('SELECT session_version, password_hash FROM users WHERE id = $1', [ref1.id])).rows[0];
    assert.equal(after.session_version, before + 1);
    assert.ok(await verifyPassword('moi-12345678', after.password_hash));
    const ev = await pool.query(`SELECT details FROM tournament_events WHERE action = 'referee_update'`);
    assert.ok(!JSON.stringify(ev.rows).includes('moi-12345678'), 'mật khẩu không được nằm trong nhật ký');
  });

  test('trọng tài còn làm ở giải của BTC khác → BTC A không sửa được, admin thì được', async () => {
    await svc.upsertStaff(pool, ADMIN, tb.id, { userId: ref1.id, role: 'referee' });
    assert.equal((await refs.listReferees(pool, ORG_A, ta.id))[0].can_manage, false);
    await rejectsWith(refs.updateReferee(pool, ORG_A, ta.id, ref1.id, { password: 'chiem-12345678' }), 403);
    const u = await refs.updateReferee(pool, ADMIN, ta.id, ref1.id, { fullName: 'Lan' });
    assert.equal(u.full_name, 'Lan');
  });

  test('gỡ khi còn làm giải khác: chỉ gỡ khỏi giải, KHÔNG khoá tài khoản', async () => {
    await pool.query('INSERT INTO court_referees (tournament_id, court, user_id) VALUES ($1, 2, $2)', [ta.id, ref1.id]);
    const r = await refs.removeReferee(pool, ORG_A, ta.id, ref1.id);
    assert.deepEqual(r, { removed: true, disabled: false });
    const cr = await pool.query('SELECT 1 FROM court_referees WHERE tournament_id = $1 AND user_id = $2', [ta.id, ref1.id]);
    assert.equal(cr.rows.length, 0, 'bỏ luôn phụ trách sân ở giải này');
    const u = (await pool.query('SELECT disabled_at FROM users WHERE id = $1', [ref1.id])).rows[0];
    assert.equal(u.disabled_at, null);
  });

  test('gỡ trọng tài chỉ làm ở giải mình → khoá tài khoản; khoá / mở khoá thủ công', async () => {
    const r2 = await refs.createReferee(pool, ORG_A, ta.id, { username: 'tt.minh', fullName: 'Minh', password: 'matkhau-123' });
    const locked = await refs.updateReferee(pool, ORG_A, ta.id, r2.id, { disabled: true });
    assert.ok(locked.disabled_at);
    const open = await refs.updateReferee(pool, ORG_A, ta.id, r2.id, { disabled: false });
    assert.equal(open.disabled_at, null);
    assert.deepEqual(await refs.removeReferee(pool, ORG_A, ta.id, r2.id), { removed: true, disabled: true });
    assert.ok((await pool.query('SELECT disabled_at FROM users WHERE id = $1', [r2.id])).rows[0].disabled_at);
    await rejectsWith(refs.updateReferee(pool, ORG_A, ta.id, r2.id, { fullName: 'x' }), 404);
  });

  test('BTC không sửa được tài khoản quản trị viên dù được thêm làm trọng tài', async () => {
    await svc.upsertStaff(pool, ADMIN, ta.id, { userId: ADMIN.id, role: 'referee' });
    await rejectsWith(refs.updateReferee(pool, ORG_A, ta.id, ADMIN.id, { password: 'chiem-12345678' }), 403);
  });

  test('admin tạo tài khoản ở trang Tài khoản kèm giải → là trọng tài của giải, phân công trận được', async () => {
    const u = await refs.createAccount(pool, ADMIN, {
      username: 'acc.khoa', fullName: 'Trọng tài Minh', password: 'matkhau-123', role: 'user', refereeTournamentIds: [ta.id, ta.id],
    });
    assert.deepEqual(u.refereeTournamentIds, [ta.id]);
    const staff = await svc.listStaff(pool, ADMIN, ta.id);
    assert.equal(staff.find((s) => s.user_id === u.id)?.role, 'referee');
    assert.ok((await refs.listReferees(pool, ORG_A, ta.id)).some((r) => r.username === 'acc.khoa'));
    const ev = await pool.query(`SELECT details FROM tournament_events WHERE tournament_id = $1 AND action = 'referee_create'`, [ta.id]);
    assert.ok(ev.rows.some((e) => e.details.userId === u.id));
    // Không có giải nào → vẫn tạo được như trước (tài khoản thường, chưa thuộc giải nào).
    const plain = await refs.createAccount(pool, ADMIN, { username: 'tt.plain', fullName: 'Plain', password: 'matkhau-123', role: 'user' });
    assert.deepEqual(plain.refereeTournamentIds, []);
  });

  test('tạo tài khoản kèm giải không tồn tại → 422, không tạo tài khoản; người không phải admin → 403', async () => {
    await rejectsWith(refs.createAccount(pool, ADMIN, {
      username: 'tt.ghost', fullName: 'Ghost', password: 'matkhau-123', role: 'user', refereeTournamentIds: ['00000000-0000-4000-8000-0000000000aa'],
    }), 422, 'TOURNAMENT_NOT_FOUND');
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE username = 'tt.ghost'`);
    assert.equal(rows[0].n, 0);
    await rejectsWith(refs.createAccount(pool, ORG_A, {
      username: 'tt.org', fullName: 'Org', password: 'matkhau-123', role: 'user', refereeTournamentIds: [ta.id],
    }), 403);
  });
});

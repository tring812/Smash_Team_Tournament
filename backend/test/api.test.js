'use strict';
/**
 * Test HTTP end-to-end trên PGlite: đăng nhập mật khẩu → cookie → CSRF → quyền → quản lý tài khoản → problem+json.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let hasPglite = true;
try { require.resolve('@electric-sql/pglite'); } catch { hasPglite = false; }

describe('HTTP API (PGlite)', { skip: hasPglite ? false : 'chưa cài @electric-sql/pglite' }, () => {
  /** @type {import('node:http').Server} */ let server;
  /** @type {any} */ let pool;
  let base = '';
  const ORIGIN = 'http://localhost:3100';
  const ADMIN_PW = 'admin-pass-123';

  const call = (p, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(`${base}${p}`, {
    method,
    headers: {
      'content-type': 'application/json', origin: ORIGIN, 'x-requested-with': 'fetch',
      ...(cookie ? { cookie } : {}), ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  before(async () => {
    pool = require('../src/db').createPool('pglite:memory');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
    }
    const { hashPassword } = require('../src/auth');
    await pool.query(`INSERT INTO users (username, full_name, role, password_hash) VALUES ('boss', 'Boss', 'admin', $1)`,
      [await hashPassword(ADMIN_PW)]);
    const { createApp } = require('../src/app');
    const config = {
      nodeEnv: 'test', port: 0, databaseUrl: 'pglite:memory', sessionSecret: 's'.repeat(40),
      publicOrigin: ORIGIN, cookieSecure: false, devLogin: false,
    };
    server = createApp({ pool, config }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  });
  after(async () => { server?.close(); await pool?.end(); });

  /** @returns {Promise<string>} cookie */
  async function login(username = 'boss', password = ADMIN_PW) {
    const r = await call('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(r.status, 200, await r.clone().text());
    const c = r.headers.get('set-cookie');
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    const j = await r.json();
    assert.equal(j.user.password_hash, undefined, 'never leaks the hash');
    return c.split(';')[0];
  }

  test('API bắt đầu: xác thực, CSRF, schema, chặn sân bận và hoàn thành giải phóng sân', async () => {
    const cookie = await login();
    const viewer = (await (await call('/api/me', { cookie })).json()).user;
    const svc = require('../src/services/tournamentService');
    const categorySvc = require('../src/services/categoryService');
    const entrySvc = require('../src/services/entryService');
    const matchSvc = require('../src/services/matchService');
    const courts = require('../src/services/courtService');
    const t = await svc.createTournament(pool, viewer, { slug: 'http-start', name: 'Giải thử HTTP', startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    const cat = await categorySvc.createCategory(pool, viewer, t.id, { code: 'MS', name: 'Đơn nam', isDoubles: false, groupCount: 1 });
    await entrySvc.addEntries(pool, viewer, cat.id, ['An', 'Bình', 'Chi', 'Dũng'].map((player1Name) => ({ player1Name })));
    await svc.drawGroups(pool, viewer, cat.id);
    const matches = await matchSvc.listMatches(pool, t.id);
    const a = matches[0];
    const b = matches.find((m) => ![a.a.id, a.b.id].includes(m.a.id) && ![a.a.id, a.b.id].includes(m.b.id));
    for (const m of [a, b]) await courts.moveMatch(pool, viewer, m.id, { court: 1 });
    const before = await matchSvc.getMatch(pool, a.id);
    const route = `/api/matches/${a.id}/start`;
    const body = { version: before.version };
    assert.equal((await call(route, { method: 'POST', body })).status, 401);
    assert.equal((await call(route, { method: 'POST', body, cookie, headers: { 'x-requested-with': '' } })).status, 403);
    assert.equal((await call(route, { method: 'POST', body: {}, cookie })).status, 422);
    const blocked = await call(`/api/matches/${a.id}/score`, { method: 'PUT', cookie, body: { action: 'save', version: before.version, games: [[1, 0]] } });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, 'MATCH_NOT_STARTED');
    const started = await call(route, { method: 'POST', body, cookie });
    assert.equal(started.status, 200);
    let m = await started.json();
    assert.equal(m.status, 'live');
    assert.deepEqual(m.rallies, []);
    assert.equal(m.version, before.version + 1);
    const startB = () => call(`/api/matches/${b.id}/start`, { method: 'POST', cookie, body: { version: b.version + 1 } });
    const busy = await startB();
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).code, 'COURT_BUSY');
    const invalid = await call(`/api/matches/${a.id}/score`, { method: 'PUT', cookie, body: { action: 'finish', version: m.version, games: [[1, 0]] } });
    assert.equal(invalid.status, 422);
    const saved = await call(`/api/matches/${a.id}/score`, { method: 'PUT', cookie, body: { action: 'save', version: m.version, games: [[21, 0], [21, 0]] } });
    assert.equal(saved.status, 200);
    m = await saved.json();
    assert.equal(m.status, 'live');
    assert.equal((await startB()).status, 409, 'đủ điểm vẫn giữ sân');
    const done = await call(`/api/matches/${a.id}/score`, { method: 'PUT', cookie, body: { action: 'finish', version: m.version, games: m.games } });
    assert.equal(done.status, 200);
    assert.equal((await done.json()).status, 'finished');
    assert.equal((await startB()).status, 200, 'xác nhận xong mới cho nhận sân');
  });

  test('wrong username and wrong password give the same 401', async () => {
    for (const body of [{ username: 'boss', password: 'nope-nope' }, { username: 'ghost', password: 'nope-nope' }]) {
      const r = await call('/api/auth/login', { method: 'POST', body });
      assert.equal(r.status, 401);
      assert.equal((await r.json()).code, 'INVALID_CREDENTIALS');
    }
    const upper = await call('/api/auth/login', { method: 'POST', body: { username: 'BOSS', password: ADMIN_PW } });
    assert.equal(upper.status, 200, 'username is case-insensitive');
  });

  test('admin creates a user; the user can log in but cannot create tournaments or manage users', async () => {
    const admin = await login();
    const created = await call('/api/admin/users', { method: 'POST', cookie: admin, body: { username: 'Ref.Lan', fullName: 'Trọng tài Lan', password: 'lan-pass-123' } });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).username, 'ref.lan');
    const dup = await call('/api/admin/users', { method: 'POST', cookie: admin, body: { username: 'ref.lan', fullName: 'X', password: 'lan-pass-123' } });
    assert.equal(dup.status, 409);
    const weak = await call('/api/admin/users', { method: 'POST', cookie: admin, body: { username: 'weak', fullName: 'W', password: 'short' } });
    assert.equal(weak.status, 422);

    const lan = await login('ref.lan', 'lan-pass-123');
    const body = { slug: 'x-y', name: 'Lan cup', startsAt: '2026-12-05T01:00:00Z' };
    assert.equal((await call('/api/tournaments', { method: 'POST', cookie: lan, body })).status, 403);
    assert.equal((await call('/api/admin/users', { cookie: lan })).status, 403);
    assert.equal((await call('/api/admin/users')).status, 401);
  });

  test('changing a password logs out other sessions but keeps the current one', async () => {
    const s1 = await login('ref.lan', 'lan-pass-123');
    const s2 = await login('ref.lan', 'lan-pass-123');
    const wrong = await call('/api/me/password', { method: 'POST', cookie: s1, body: { currentPassword: 'bad', newPassword: 'lan-pass-456' } });
    assert.equal(wrong.status, 400);
    const r = await call('/api/me/password', { method: 'POST', cookie: s1, body: { currentPassword: 'lan-pass-123', newPassword: 'lan-pass-456' } });
    assert.equal(r.status, 204);
    const s1new = r.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await call('/api/me', { cookie: s1new })).json()).user.username, 'ref.lan');
    assert.equal((await (await call('/api/me', { cookie: s2 })).json()).user, null, 'old session revoked');
    await login('ref.lan', 'lan-pass-456');
  });

  test('disabling a user revokes their session; the last admin cannot be demoted', async () => {
    const admin = await login();
    const lan = await login('ref.lan', 'lan-pass-456');
    const list = await (await call('/api/admin/users?q=lan', { cookie: admin })).json();
    const uid = list[0].id;
    assert.equal((await call(`/api/admin/users/${uid}`, { method: 'PATCH', cookie: admin, body: { disabled: true } })).status, 200);
    assert.equal((await (await call('/api/me', { cookie: lan })).json()).user, null);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'ref.lan', password: 'lan-pass-456' } })).status, 401);

    const meId = (await (await call('/api/me', { cookie: admin })).json()).user.id;
    const demote = await call(`/api/admin/users/${meId}`, { method: 'PATCH', cookie: admin, body: { role: 'user' } });
    assert.equal(demote.status, 409);
    assert.equal((await demote.json()).code, 'LAST_ADMIN');
  });

  test('mutations without the CSRF header or from another origin are refused', async () => {
    const cookie = await login();
    const body = { slug: 'csrf-test', name: 'CSRF test', startsAt: '2026-12-05T01:00:00Z' };
    const noHeader = await fetch(`${base}/api/tournaments`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
    });
    assert.equal(noHeader.status, 403);
    const evil = await call('/api/tournaments', { method: 'POST', body, cookie, headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    assert.equal((await call('/api/tournaments', { method: 'POST', body, cookie })).status, 201);
  });

  test('anonymous users can read but not write', async () => {
    assert.equal((await call('/api/tournaments')).status, 200);
    assert.equal((await call('/api/tournaments', { method: 'POST', body: {} })).status, 401);
  });

  test('validation errors return problem+json with issue paths, never a stack trace', async () => {
    const cookie = await login();
    const r = await call('/api/tournaments', { method: 'POST', cookie, body: { slug: 'Bad Slug!', name: 'x' } });
    assert.equal(r.status, 422);
    assert.match(r.headers.get('content-type'), /problem\+json/);
    const j = await r.json();
    assert.ok(j.issues.some((i) => i.path === 'slug'));
    assert.ok(!JSON.stringify(j).includes('at '));
  });

  test('legacy user (no username/password) can be given a username once, then logs in', async () => {
    const admin = await login();
    const { rows } = await pool.query(`INSERT INTO users (full_name, role) VALUES ('Cũ từ SSO', 'user') RETURNING id`);
    const uid = rows[0].id;
    const set = await call(`/api/admin/users/${uid}`, { method: 'PATCH', cookie: admin, body: { username: 'Legacy.One', password: 'legacy-pass-1' } });
    assert.equal(set.status, 200);
    assert.equal((await set.json()).username, 'legacy.one');
    await login('legacy.one', 'legacy-pass-1');
    const again = await call(`/api/admin/users/${uid}`, { method: 'PATCH', cookie: admin, body: { username: 'other.name' } });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).code, 'USERNAME_LOCKED');
  });

  test('SSE stream pushes "changed" after a write; draft tournament stream is hidden from the public', async () => {
    const admin = await login();
    const t = await (await call('/api/tournaments', { method: 'POST', cookie: admin, body: { slug: 'sse-cup', name: 'SSE Cup', startsAt: '2026-12-05T01:00:00Z' } })).json();
    assert.equal((await call(`/api/tournaments/${t.id}/stream`)).status, 404, 'draft: public cannot subscribe');
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/tournaments/${t.id}/stream`, { headers: { cookie: admin }, signal: ctl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const waitFor = async (needle) => {
      const deadline = Date.now() + 5000;
      while (!buf.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`timeout waiting for ${needle}; got ${buf}`);
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
      }
    };
    await waitFor(': connected');
    assert.equal((await call(`/api/tournaments/${t.id}`, { method: 'PATCH', cookie: admin, body: { venue: 'Nhà thi đấu UIT' } })).status, 200);
    await waitFor('event: changed');
    await waitFor('\n\n');
    assert.match(buf, /event: changed\ndata: \{"kind":"structure"\}\n\n/, 'sửa giải là thay đổi cấu trúc');
    ctl.abort();
  });

  test('draft tournament detail is 404 for the public', async () => {
    assert.equal((await call('/api/tournaments/csrf-test')).status, 404);
  });
});

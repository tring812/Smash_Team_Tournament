'use strict';
/**
 * Express app (không listen) — tách khỏi server.js để test bằng HTTP mà không mở cổng thật.
 */
const crypto = require('node:crypto');
const express = require('express');
const { ZodError } = require('zod');

const svc = require('./services/tournamentService');
const users = require('./services/userService');
const courts = require('./services/courtService');
const athletes = require('./services/athleteService');
const referees = require('./services/refereeService');
const live = require('./liveBus');
const auth = require('./auth');
const { schemas } = require('./schemas');
const { HttpError } = require('./errors');
const { createRateLimiter } = require('./rateLimit');
const { log } = require('./log');

/**
 * @param {{ pool: import('./services/tournamentService').Pool, config: import('./config').AppConfig }} deps
 */
function createApp({ pool, config }) {
  const app = express();
  app.set('trust proxy', 1); // sau 1 reverse proxy (Render/Vercel)
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      log('info', 'http_request', {
        request_id: req.id, method: req.method, path: req.route?.path ?? req.path, status: res.statusCode,
        duration_ms: Number(process.hrtime.bigint() - t0) / 1e6, user_id: req.viewer?.id ?? null,
      });
    });
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const api = express.Router();
  api.use(auth.csrfGuard(config.publicOrigin));
  api.use(auth.loadViewer(pool, config));

  const id = (v) => schemas.uuidParam.parse(v);
  const me = (req) => req.viewer;

  // Realtime: route ghi đặt res.locals.tid → sau khi trả 2xx, báo các màn hình đang xem giải đó tải lại.
  api.use((req, res, next) => {
    if (req.method !== 'GET') {
      res.on('finish', () => { if (res.statusCode < 400 && res.locals.tid) live.publish(res.locals.tid); });
    }
    next();
  });
  const touch = (res, tid) => { res.locals.tid = tid; };
  const touchCategory = async (res, cid) => touch(res, await svc.tournamentOfCategory(pool, cid));
  const touchEntry = async (res, eid) => {
    const r = await pool.query('SELECT c.tournament_id FROM entries e JOIN categories c ON c.id = e.category_id WHERE e.id = $1', [eid]);
    touch(res, r.rows[0]?.tournament_id);
  };

  // ── Auth (tài khoản riêng của web giải) ──
  // Giới hạn theo IP chống dò mật khẩu; scrypt đã làm mỗi lần thử tốn ~50ms.
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 20 });
  const setSession = (res, token) => res.setHeader('Set-Cookie', auth.sessionCookie(token, config.cookieSecure));
  api.post('/auth/login', loginLimiter, async (req, res) => {
    const creds = schemas.login.parse(req.body);
    try {
      const { user, token } = await auth.login(pool, config, creds);
      setSession(res, token);
      log('info', 'login', { request_id: req.id, user_id: user.id, role: user.role });
      res.json({ user });
    } catch (err) {
      if (err instanceof HttpError) log('warn', 'login_failed', { request_id: req.id, ip: req.ip });
      throw err;
    }
  });
  api.post('/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', auth.sessionCookie('', config.cookieSecure, 0));
    res.status(204).end();
  });
  api.get('/me', (req, res) => res.json({ user: req.viewer, devLogin: config.devLogin }));
  api.post('/me/password', auth.requireAuth, loginLimiter, async (req, res) => {
    const u = await users.changeOwnPassword(pool, me(req), schemas.changePassword.parse(req.body));
    setSession(res, auth.signSession(config, u)); // giữ phiên hiện tại, các phiên khác bị đăng xuất
    log('info', 'password_changed', { request_id: req.id, user_id: u.id });
    res.status(204).end();
  });
  if (config.devLogin) {
    // CHỈ DEV: config.js từ chối DEV_LOGIN=1 ở production.
    api.post('/auth/dev-login', loginLimiter, async (req, res) => {
      const { user, token } = await auth.devSession(pool, config, schemas.devLogin.parse(req.body ?? {}));
      setSession(res, token);
      log('warn', 'dev_login', { request_id: req.id, user_id: user.id, role: user.role });
      res.json({ user });
    });
  }

  // ── Tài khoản (chỉ quản trị viên hệ thống) ──
  api.get('/admin/users', auth.requireAdmin, async (req, res) => {
    res.json(await users.listUsers(pool, schemas.userList.parse(req.query)));
  });
  api.post('/admin/users', auth.requireAdmin, async (req, res) => {
    const u = await users.createUser(pool, schemas.createUser.parse(req.body));
    log('info', 'user_created', { request_id: req.id, user_id: u.id, by: me(req).id, role: u.role });
    res.status(201).json(u);
  });
  api.patch('/admin/users/:id', auth.requireAdmin, async (req, res) => {
    const patch = schemas.updateUser.parse(req.body);
    const u = await users.updateUser(pool, me(req), id(req.params.id), patch);
    log('info', 'user_updated', { request_id: req.id, user_id: u.id, by: me(req).id, fields: Object.keys(patch) });
    res.json(u);
  });

  // ── Giải ──
  api.get('/tournaments', async (req, res) => res.json(await svc.listTournaments(pool, me(req))));
  api.post('/tournaments', auth.requireAuth, async (req, res) => {
    res.status(201).json(await svc.createTournament(pool, me(req), schemas.createTournament.parse(req.body)));
  });
  // Giải đã xoá còn khôi phục được.
  api.get('/deleted-tournaments', auth.requireAuth, async (req, res) => {
    res.json(await svc.listDeletedTournaments(pool, me(req)));
  });
  api.delete('/tournaments/:id', auth.requireAuth, async (req, res) => {
    const out = await svc.deleteTournament(pool, me(req), id(req.params.id), schemas.deleteTournament.parse(req.body ?? {}).confirmSlug);
    touch(res, out.id);
    res.json(out);
  });
  api.post('/tournaments/:id/restore', auth.requireAuth, async (req, res) => {
    res.json(await svc.restoreTournament(pool, me(req), id(req.params.id)));
  });
  api.get('/tournaments/:slug', async (req, res) => {
    const slug = String(req.params.slug).slice(0, 80);
    res.json(await svc.getTournament(pool, slug, me(req)));
  });
  api.patch('/tournaments/:id', auth.requireAuth, async (req, res) => {
    touch(res, req.params.id);
    res.json(await svc.updateTournament(pool, me(req), id(req.params.id), schemas.updateTournament.parse(req.body)));
  });
  api.get('/tournaments/:id/staff', auth.requireAuth, async (req, res) => {
    res.json(await svc.listStaff(pool, me(req), id(req.params.id)));
  });
  api.put('/tournaments/:id/staff/:userId', auth.requireAuth, async (req, res) => {
    const { role } = schemas.staff.parse(req.body);
    res.json(await svc.upsertStaff(pool, me(req), id(req.params.id), { userId: id(req.params.userId), role }));
  });
  api.delete('/tournaments/:id/staff/:userId', auth.requireAuth, async (req, res) => {
    await svc.removeStaff(pool, me(req), id(req.params.id), id(req.params.userId));
    res.status(204).end();
  });
  // ── Tài khoản trọng tài của giải (BTC tự quản lý, xem refereeService) ──
  api.get('/tournaments/:id/referees', auth.requireAuth, async (req, res) => {
    res.json(await referees.listReferees(pool, me(req), id(req.params.id)));
  });
  api.post('/tournaments/:id/referees', auth.requireAuth, async (req, res) => {
    const u = await referees.createReferee(pool, me(req), id(req.params.id), schemas.createReferee.parse(req.body));
    log('info', 'referee_created', { request_id: req.id, user_id: u.id, by: me(req).id, tournament_id: req.params.id });
    res.status(201).json(u);
  });
  api.patch('/tournaments/:id/referees/:userId', auth.requireAuth, async (req, res) => {
    const patch = schemas.updateReferee.parse(req.body);
    const u = await referees.updateReferee(pool, me(req), id(req.params.id), id(req.params.userId), patch);
    log('info', 'referee_updated', { request_id: req.id, user_id: u.id, by: me(req).id, fields: Object.keys(patch) });
    res.json(u);
  });
  api.delete('/tournaments/:id/referees/:userId', auth.requireAuth, async (req, res) => {
    res.json(await referees.removeReferee(pool, me(req), id(req.params.id), id(req.params.userId)));
  });
  api.post('/tournaments/:id/categories', auth.requireAuth, async (req, res) => {
    res.status(201).json(await svc.createCategory(pool, me(req), id(req.params.id), schemas.createCategory.parse(req.body)));
  });
  api.post('/tournaments/:id/schedule', auth.requireAuth, async (req, res) => {
    touch(res, req.params.id);
    res.json(await svc.scheduleTournament(pool, me(req), id(req.params.id), schemas.schedule.parse(req.body ?? {})));
  });
  api.get('/tournaments/:id/events', auth.requireAuth, async (req, res) => {
    res.json(await svc.listEvents(pool, me(req), id(req.params.id)));
  });
  // Server-Sent Events: "giải vừa đổi" → client gọi lại API. Quyền xem như danh sách trận.
  api.get('/tournaments/:id/stream', async (req, res) => {
    const tid = id(req.params.id);
    await svc.assertVisible(pool, tid, me(req));
    if (!live.subscribe(req, res, tid)) throw new HttpError(503, 'TOO_MANY_STREAMS', 'Quá nhiều kết nối trực tiếp, đang dùng chế độ tự làm mới');
  });
  // Hồ sơ VĐV (MSSV/SĐT — chỉ BTC).
  api.get('/tournaments/:id/athletes', auth.requireAuth, async (req, res) => {
    res.json(await athletes.listAthletes(pool, me(req), id(req.params.id)));
  });
  api.patch('/athletes/:id', auth.requireAuth, async (req, res) => {
    const out = await athletes.updateAthlete(pool, me(req), id(req.params.id), schemas.updateAthlete.parse(req.body));
    const r = await pool.query('SELECT tournament_id FROM athletes WHERE id = $1', [out.id]);
    touch(res, r.rows[0]?.tournament_id);
    res.json(out);
  });
  api.get('/tournaments/:id/matches', async (req, res) => {
    const tid = id(req.params.id);
    await svc.assertVisible(pool, tid, me(req));
    res.json(await svc.listMatches(pool, tid, schemas.matchFilter.parse(req.query)));
  });

  // ── Nội dung ──
  const visibleCategory = async (req) => {
    const cid = id(req.params.id);
    await svc.assertVisible(pool, await svc.tournamentOfCategory(pool, cid), me(req));
    return cid;
  };
  api.patch('/categories/:id', auth.requireAuth, async (req, res) => {
    res.json(await svc.updateCategory(pool, me(req), id(req.params.id), schemas.updateCategory.parse(req.body)));
  });
  api.put('/categories/:id/round-rules', auth.requireAuth, async (req, res) => {
    const { rules } = schemas.roundRules.parse(req.body);
    await touchCategory(res, id(req.params.id));
    res.json(await svc.setRoundRules(pool, me(req), id(req.params.id), rules));
  });
  api.delete('/categories/:id', auth.requireAuth, async (req, res) => {
    await svc.deleteCategory(pool, me(req), id(req.params.id));
    res.status(204).end();
  });
  api.get('/categories/:id/entries', async (req, res) => res.json(await svc.listEntries(pool, await visibleCategory(req))));
  api.get('/categories/:id/standings', async (req, res) => res.json(await svc.groupStandings(pool, await visibleCategory(req))));
  api.get('/categories/:id/bracket', async (req, res) => res.json(await svc.getBracket(pool, await visibleCategory(req))));
  api.post('/categories/:id/entries', auth.requireAuth, async (req, res) => {
    const { entries } = schemas.addEntries.parse(req.body);
    await touchCategory(res, id(req.params.id));
    res.status(201).json(await svc.addEntries(pool, me(req), id(req.params.id), entries));
  });
  api.patch('/entries/:id', auth.requireAuth, async (req, res) => {
    await touchEntry(res, id(req.params.id));
    res.json(await svc.updateEntry(pool, me(req), id(req.params.id), schemas.updateEntry.parse(req.body)));
  });
  api.post('/entries/:id/disqualify', auth.requireAuth, async (req, res) => {
    await touchEntry(res, id(req.params.id));
    res.json(await svc.disqualifyEntry(pool, me(req), id(req.params.id), schemas.disqualify.parse(req.body).reason));
  });
  api.post('/entries/:id/reinstate', auth.requireAuth, async (req, res) => {
    await touchEntry(res, id(req.params.id));
    res.json(await svc.reinstateEntry(pool, me(req), id(req.params.id)));
  });
  api.post('/categories/:id/swap', auth.requireAuth, async (req, res) => {
    const { entryA, entryB } = schemas.swap.parse(req.body);
    await touchCategory(res, id(req.params.id));
    res.json(await svc.swapEntries(pool, me(req), id(req.params.id), entryA, entryB));
  });
  api.delete('/entries/:id', auth.requireAuth, async (req, res) => {
    await svc.removeEntry(pool, me(req), id(req.params.id));
    res.status(204).end();
  });
  api.post('/categories/:id/draw', auth.requireAuth, async (req, res) => {
    const { groups } = schemas.draw.parse(req.body ?? {});
    await touchCategory(res, id(req.params.id));
    res.json(await svc.drawGroups(pool, me(req), id(req.params.id), groups ? { manual: groups } : {}));
  });
  api.post('/categories/:id/knockout', auth.requireAuth, async (req, res) => {
    await touchCategory(res, id(req.params.id));
    res.json(await svc.generateKnockout(pool, me(req), id(req.params.id)));
  });

  // ── Trận & trọng tài ──
  api.get('/matches/:id', async (req, res) => {
    const m = await svc.getMatch(pool, id(req.params.id));
    await svc.assertVisible(pool, m.tournamentId, me(req));
    res.json(m);
  });
  api.put('/matches/:id/score', auth.requireAuth, async (req, res) => {
    const body = schemas.score.parse(req.body);
    const mid = id(req.params.id);
    await svc.recordScore(pool, me(req), mid, body);
    log('info', 'score_recorded', { request_id: req.id, match_id: mid, action: body.action, user_id: me(req).id });
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.post('/matches/:id/reopen', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await svc.reopenMatch(pool, me(req), mid);
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.put('/matches/:id/referee', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await svc.assignReferee(pool, me(req), mid, schemas.referee.parse(req.body).refereeUserId);
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  // ── Điều phối sân ──
  api.get('/tournaments/:id/courts', auth.requireAuth, async (req, res) => {
    res.json(await courts.courtBoard(pool, me(req), id(req.params.id)));
  });
  api.put('/tournaments/:id/courts/:court/referee', auth.requireAuth, async (req, res) => {
    const court = schemas.courtParam.parse(req.params.court);
    touch(res, req.params.id);
    res.json(await courts.setCourtReferee(pool, me(req), id(req.params.id), court, schemas.referee.parse(req.body).refereeUserId));
  });
  api.post('/matches/:id/call', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await courts.callMatch(pool, me(req), mid, schemas.callMatch.parse(req.body));
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.post('/matches/:id/uncall', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await courts.uncallMatch(pool, me(req), mid);
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.patch('/matches/:id', auth.requireAuth, async (req, res) => {
    const mid = id(req.params.id);
    await courts.moveMatch(pool, me(req), mid, schemas.moveMatch.parse(req.body));
    const m = await svc.getMatch(pool, mid);
    touch(res, m.tournamentId);
    res.json(m);
  });
  api.get('/referee/queue', auth.requireAuth, async (req, res) => res.json(await svc.refereeQueue(pool, me(req))));
  api.get('/users', auth.requireAuth, async (req, res) => {
    res.json(await svc.searchUsers(pool, me(req), schemas.userSearch.parse(req.query).q));
  });

  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'API không tồn tại')));

  // Lỗi → RFC 7807 problem+json. Không lộ stack/SQL ra client; log chi tiết ở server.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(422).type('application/problem+json').json({
        type: 'about:blank', title: 'Dữ liệu không hợp lệ', status: 422, code: 'VALIDATION_FAILED',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).type('application/problem+json').json({
        type: 'about:blank', title: err.message, status: err.status, code: err.code, ...(err.details ?? {}),
      });
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return res.status(400).type('application/problem+json').json({ type: 'about:blank', title: 'Body không hợp lệ', status: 400, code: 'BAD_BODY' });
    }
    log('error', 'unhandled_error', { request_id: req.id, error: err?.message, code: err?.code, stack: err?.stack });
    return res.status(500).type('application/problem+json').json({
      type: 'about:blank', title: 'Lỗi hệ thống', status: 500, code: 'INTERNAL', request_id: req.id,
    });
  });
  return app;
}

module.exports = { createApp };

'use strict';
/**
 * Route auth: Đăng nhập / đăng xuất / đổi mật khẩu, và quản lý tài khoản (chỉ quản trị viên hệ thống).
 * Gắn thẳng vào router `/api` của app.js (cùng thứ tự, cùng middleware) — chỉ tách file, không đổi hành vi.
 */
const users = require('../services/userService');
const referees = require('../services/refereeService');
const auth = require('../auth');
const { schemas } = require('../schemas');
const { HttpError } = require('../errors');
const { createRateLimiter } = require('../rateLimit');
const { log } = require('../log');

/**
 * @param {import('express').Router} api @param {import('./context').RouteContext} ctx
 */
module.exports = function registerAuthRoutes(api, { pool, config, id, me }) {
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
    const u = await referees.createAccount(pool, me(req), schemas.createUser.parse(req.body));
    log('info', 'user_created', { request_id: req.id, user_id: u.id, by: me(req).id, role: u.role, referee_of: u.refereeTournamentIds.length });
    res.status(201).json(u);
  });
  api.patch('/admin/users/:id', auth.requireAdmin, async (req, res) => {
    const patch = schemas.updateUser.parse(req.body);
    const u = await users.updateUser(pool, me(req), id(req.params.id), patch);
    log('info', 'user_updated', { request_id: req.id, user_id: u.id, by: me(req).id, fields: Object.keys(patch) });
    res.json(u);
  });
};

'use strict';
/**
 * Đăng nhập ĐỘC LẬP: tài khoản riêng của web giải (tên đăng nhập + mật khẩu), không phụ thuộc hệ thống nào khác.
 *
 *  - Mật khẩu băm bằng scrypt (node:crypto, salt ngẫu nhiên 16 byte/tài khoản), so sánh thời gian hằng.
 *  - Sai tên đăng nhập vẫn băm 1 lần với hash giả → thời gian phản hồi không lộ tài khoản có tồn tại hay không.
 *  - Phiên = JWT HS256 trong cookie httpOnly; mang `sv` (session_version). Đổi mật khẩu / khoá tài khoản
 *    → tăng session_version → mọi phiên cũ hết hiệu lực ngay ở request kế tiếp.
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const jwt = require('jsonwebtoken');
const { HttpError } = require('./errors');

const scrypt = /** @type {(pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>} */ (promisify(crypto.scrypt));

const SESSION_COOKIE = 'st_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLen: 32 };

/** Cột user an toàn để trả ra ngoài (không bao giờ có password_hash). */
const USER_COLUMNS = 'id, username, full_name, role, disabled_at, last_login_at, created_at';

/**
 * Băm mật khẩu. Định dạng tự mô tả để đổi tham số sau này: scrypt$N$r$p$salt$hash (base64).
 * @param {string} password
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * @param {string} password @param {string|null|undefined} stored
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, stored) {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (expected.length < 16) return false;
  const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return crypto.timingSafeEqual(actual, expected);
}

/** Hash giả (tính 1 lần) để nhánh "không có tài khoản" tốn cùng thời gian như nhánh sai mật khẩu. */
let dummyHash = null;
async function getDummyHash() {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

/** @param {{ sessionSecret: string }} cfg @param {{ id: string, session_version: number }} user */
function signSession(cfg, user) {
  return jwt.sign({ sub: user.id, sv: user.session_version }, cfg.sessionSecret, {
    algorithm: 'HS256', expiresIn: SESSION_TTL_SECONDS, audience: 'tournament-session',
  });
}

/**
 * Đăng nhập. Thông báo lỗi chung cho mọi trường hợp (sai tên / sai mật khẩu / bị khoá / chưa đặt mật khẩu).
 * @param {import('./services/tournamentService').Pool} pool @param {{ sessionSecret: string }} cfg
 * @param {{ username: string, password: string }} creds
 */
async function login(pool, cfg, { username, password }) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS}, password_hash, session_version FROM users WHERE username = $1`, [username.toLowerCase()],
  );
  const u = rows[0];
  const ok = await verifyPassword(password, u?.password_hash ?? (await getDummyHash()));
  if (!u || !ok || !u.password_hash || u.disabled_at) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu');
  }
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  const { password_hash: _h, session_version: _sv, ...user } = u;
  return { user, token: signSession(cfg, u) };
}

/**
 * CHỈ DEV (config.devLogin): đăng nhập 1 chạm, không cần mật khẩu. Tài khoản `dev-<role>`.
 * @param {import('./services/tournamentService').Pool} pool @param {{ sessionSecret: string }} cfg
 * @param {{ name: string, role: 'admin'|'user' }} who
 */
async function devSession(pool, cfg, who) {
  const username = `dev-${who.role}`;
  const { rows } = await pool.query(
    `INSERT INTO users (username, full_name, role, last_login_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (username) DO UPDATE SET last_login_at = now(), disabled_at = NULL
     RETURNING ${USER_COLUMNS}, session_version`,
    [username, who.name, who.role],
  );
  const { session_version: _sv, ...user } = rows[0];
  return { user, token: signSession(cfg, rows[0]) };
}

/** @param {string|undefined} header @returns {Record<string,string>} */
function parseCookies(header) {
  /** @type {Record<string,string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // cookie hỏng → bỏ qua
    }
  }
  return out;
}

/**
 * Header Set-Cookie cho phiên. SameSite=Lax + httpOnly + Secure (prod).
 * @param {string} token @param {boolean} secure @param {number} [maxAge]
 */
function sessionCookie(token, secure, maxAge = SESSION_TTL_SECONDS) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/**
 * Middleware: gắn req.viewer nếu cookie phiên hợp lệ. Vai trò, trạng thái khoá và session_version
 * đọc lại từ DB mỗi request → thu hồi quyền có hiệu lực ngay.
 * @param {import('./services/tournamentService').Pool} pool @param {{ sessionSecret: string }} cfg
 */
function loadViewer(pool, cfg) {
  return async (req, _res, next) => {
    req.viewer = null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    try {
      const p = /** @type {{ sub: string, sv: number }} */ (jwt.verify(token, cfg.sessionSecret, {
        algorithms: ['HS256'], audience: 'tournament-session',
      }));
      const { rows } = await pool.query(
        `SELECT id, username, full_name, role FROM users
          WHERE id = $1 AND session_version = $2 AND disabled_at IS NULL`, [p.sub, p.sv],
      );
      req.viewer = rows[0] ?? null;
    } catch {
      req.viewer = null; // token hết hạn/sai → coi như khách
    }
    return next();
  };
}

/** @type {import('express').RequestHandler} */
function requireAuth(req, _res, next) {
  if (!req.viewer) return next(new HttpError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập'));
  return next();
}

/** @type {import('express').RequestHandler} */
function requireAdmin(req, _res, next) {
  if (!req.viewer) return next(new HttpError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập'));
  if (req.viewer.role !== 'admin') return next(new HttpError(403, 'FORBIDDEN', 'Chỉ quản trị viên hệ thống'));
  return next();
}

/**
 * CSRF: request thay đổi dữ liệu phải có header tuỳ biến (form/thẻ img không gửi được)
 * và, nếu trình duyệt gửi Origin, Origin phải đúng site của app.
 * @param {string} publicOrigin
 */
function csrfGuard(publicOrigin) {
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (req.headers['x-requested-with'] !== 'fetch' || (origin && origin !== publicOrigin)) {
      return next(new HttpError(403, 'CSRF', 'Yêu cầu không hợp lệ'));
    }
    return next();
  };
}

module.exports = {
  SESSION_COOKIE, USER_COLUMNS, hashPassword, verifyPassword, login, devSession, signSession,
  parseCookies, sessionCookie, loadViewer, requireAuth, requireAdmin, csrfGuard,
};

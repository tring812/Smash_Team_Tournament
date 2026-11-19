'use strict';
/**
 * Quản lý tài khoản (web giải độc lập).
 *  - role 'admin' : quản trị hệ thống — tạo giải, quản lý tài khoản, toàn quyền mọi giải.
 *  - role 'user'  : tài khoản thường — được admin/BTC gán làm BTC hoặc trọng tài của từng giải.
 * Không xoá cứng tài khoản (còn gắn với nhật ký, phân công) — chỉ KHOÁ.
 */
const { HttpError } = require('../errors');
const { USER_COLUMNS, hashPassword, verifyPassword } = require('../auth');

/** @typedef {import('./tournamentService').Pool} Pool */

const conflict = (code, msg) => new HttpError(409, code, msg);

/** Đếm admin còn hoạt động (không tính `exceptId`). */
async function activeAdminsExcept(db, exceptId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL AND password_hash IS NOT NULL AND id <> $1`,
    [exceptId],
  );
  return rows[0].n;
}

/** @param {Pool} db @param {{ q?: string }} [filter] */
async function listUsers(db, filter = {}) {
  const q = filter.q?.trim();
  const params = [];
  let where = '';
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where = 'WHERE full_name ILIKE $1 OR username ILIKE $1';
  }
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}, (password_hash IS NOT NULL) AS has_password FROM users ${where}
      ORDER BY disabled_at IS NOT NULL, role, full_name LIMIT 500`, params,
  );
  return rows;
}

/**
 * @param {Pool} db
 * @param {{ username: string, fullName: string, password: string, role: 'admin'|'user' }} input
 */
async function createUser(db, input) {
  const hash = await hashPassword(input.password);
  try {
    const { rows } = await db.query(
      `INSERT INTO users (username, full_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
      [input.username.toLowerCase(), input.fullName, input.role, hash],
    );
    return rows[0];
  } catch (err) {
    if (/** @type {any} */ (err).code === '23505') throw conflict('USERNAME_TAKEN', 'Tên đăng nhập đã có người dùng');
    throw err;
  }
}

/**
 * Admin sửa tài khoản. Đặt mật khẩu mới hoặc khoá → tăng session_version (đăng xuất mọi phiên).
 * Chặn tự khoá / tự hạ quyền nếu đó là admin hoạt động cuối cùng.
 * @param {Pool} db @param {{ id: string }} actor @param {string} userId
 * @param {{ username?: string, fullName?: string, role?: 'admin'|'user', password?: string, disabled?: boolean }} patch
 */
async function updateUser(db, actor, userId, patch) {
  const { rows: cur } = await db.query('SELECT id, username, role, disabled_at FROM users WHERE id = $1', [userId]);
  if (!cur[0]) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản');
  const losesAdmin = cur[0].role === 'admin' && (patch.role === 'user' || patch.disabled === true);
  if (losesAdmin && (await activeAdminsExcept(db, userId)) === 0) {
    throw conflict('LAST_ADMIN', 'Phải còn ít nhất 1 quản trị viên đang hoạt động');
  }
  if (userId === actor.id && patch.disabled) throw conflict('SELF_DISABLE', 'Không thể tự khoá tài khoản của mình');

  const sets = [];
  const params = [];
  const add = (sql, v) => { params.push(v); sets.push(sql.replace('?', `$${params.length}`)); };
  if (patch.username !== undefined && patch.username !== cur[0].username) {
    // Tên đăng nhập cố định sau khi đã có (người dùng không bị đổi tên đăng nhập mà không biết).
    if (cur[0].username) throw conflict('USERNAME_LOCKED', 'Tên đăng nhập đã đặt thì không đổi được');
    add('username = ?', patch.username);
  }
  if (patch.fullName !== undefined) add('full_name = ?', patch.fullName);
  if (patch.role !== undefined) add('role = ?', patch.role);
  if (patch.password !== undefined) add('password_hash = ?', await hashPassword(patch.password));
  if (patch.disabled !== undefined) sets.push(patch.disabled ? 'disabled_at = COALESCE(disabled_at, now())' : 'disabled_at = NULL');
  if (patch.password !== undefined || patch.disabled === true || patch.role !== undefined) sets.push('session_version = session_version + 1');
  if (!sets.length) throw new HttpError(400, 'NOTHING_TO_UPDATE', 'Không có gì để cập nhật');
  params.push(userId);
  try {
    const { rows } = await db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${USER_COLUMNS}`, params,
    );
    return rows[0];
  } catch (err) {
    if (/** @type {any} */ (err).code === '23505') throw conflict('USERNAME_TAKEN', 'Tên đăng nhập đã có người dùng');
    throw err;
  }
}

/**
 * Người dùng tự đổi mật khẩu (phải nhập đúng mật khẩu hiện tại). Trả về user + session_version mới
 * để cấp lại cookie cho phiên đang dùng (các phiên khác bị đăng xuất).
 * @param {Pool} db @param {{ id: string }} viewer @param {{ currentPassword: string, newPassword: string }} input
 */
async function changeOwnPassword(db, viewer, input) {
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [viewer.id]);
  if (!rows[0]?.password_hash || !(await verifyPassword(input.currentPassword, rows[0].password_hash))) {
    throw new HttpError(400, 'WRONG_PASSWORD', 'Mật khẩu hiện tại không đúng');
  }
  const { rows: out } = await db.query(
    `UPDATE users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1
     RETURNING ${USER_COLUMNS}, session_version`,
    [viewer.id, await hashPassword(input.newPassword)],
  );
  return out[0];
}

module.exports = { listUsers, createUser, updateUser, changeOwnPassword };

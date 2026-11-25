'use strict';
/**
 * Tài khoản TRỌNG TÀI do BTC quản lý ngay trong trang quản trị giải (không cần nhờ quản trị viên hệ thống).
 *
 * Phạm vi quyền (BTC không được đụng tài khoản của người khác):
 *  - Admin hệ thống: mọi trọng tài của giải.
 *  - BTC của giải: chỉ sửa / khoá / đặt lại mật khẩu cho tài khoản thường (role 'user') KHÔNG là BTC ở đâu và
 *    MỌI giải người đó đang tham gia đều do BTC này quản lý → BTC giải A không chiếm được tài khoản trọng tài
 *    đang làm cho giải B của người khác.
 * Không xoá cứng tài khoản (còn gắn với nhật ký điểm, phân công): "Xoá" = gỡ khỏi giải, và khoá tài khoản nếu
 * người đó không còn làm ở giải nào khác.
 */
const { HttpError } = require('../errors');
const users = require('./userService');
const { withTx, requireOrganizer, logEvent } = require('./tournamentService');

/** @typedef {import('./tournamentService').Pool} Pool */
/** @typedef {{ id: string, role: string, full_name?: string }} Viewer */

const forbidden = (msg) => new HttpError(403, 'FORBIDDEN', msg);

/**
 * Trọng tài của giải + có được sửa tài khoản hay không (`can_manage`).
 * @param {Pool} db @param {Viewer} viewer @param {string} tid
 */
async function listReferees(db, viewer, tid) {
  await requireOrganizer(db, tid, viewer);
  const isAdmin = viewer.role === 'admin';
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.full_name, u.disabled_at, u.last_login_at, (u.password_hash IS NOT NULL) AS has_password,
            u.role AS account_role,
            (SELECT count(*)::int FROM tournament_staff o WHERE o.user_id = u.id AND o.tournament_id <> $1) AS other_tournaments,
            (SELECT count(*)::int FROM matches m WHERE m.tournament_id = $1 AND m.referee_user_id = u.id) AS matches_assigned,
            (SELECT array_agg(cr.court ORDER BY cr.court) FROM court_referees cr WHERE cr.tournament_id = $1 AND cr.user_id = u.id) AS courts,
            -- BTC sửa được khi người này không là BTC ở đâu và mọi giải của họ đều do BTC này quản lý.
            ($2::boolean OR (u.role = 'user' AND NOT EXISTS (
               SELECT 1 FROM tournament_staff o WHERE o.user_id = u.id
                 AND (o.role = 'organizer' OR NOT EXISTS (
                   SELECT 1 FROM tournament_staff me WHERE me.tournament_id = o.tournament_id AND me.user_id = $3 AND me.role = 'organizer'))
            ))) AS can_manage
       FROM tournament_staff s JOIN users u ON u.id = s.user_id
      WHERE s.tournament_id = $1 AND s.role = 'referee'
      ORDER BY u.disabled_at IS NOT NULL, u.full_name`,
    [tid, isAdmin, viewer.id],
  );
  return rows.map((r) => ({ ...r, courts: r.courts ?? [] }));
}

/** Người xem có được sửa tài khoản trọng tài `userId` của giải `tid` không; ném lỗi nếu không. */
async function assertManageable(c, viewer, tid, userId) {
  const { rows } = await c.query(
    `SELECT u.id, u.role, u.full_name, s.role AS staff_role FROM users u
       LEFT JOIN tournament_staff s ON s.user_id = u.id AND s.tournament_id = $1
      WHERE u.id = $2`, [tid, userId],
  );
  const u = rows[0];
  if (!u || u.staff_role !== 'referee') throw new HttpError(404, 'NOT_FOUND', 'Không có trọng tài này trong giải');
  if (viewer.role === 'admin') return u;
  if (u.role !== 'user') throw forbidden('Đây là tài khoản quản trị viên — chỉ quản trị viên hệ thống sửa được');
  const { rows: foreign } = await c.query(
    `SELECT 1 FROM tournament_staff o WHERE o.user_id = $1
        AND (o.role = 'organizer' OR NOT EXISTS (
          SELECT 1 FROM tournament_staff me WHERE me.tournament_id = o.tournament_id AND me.user_id = $2 AND me.role = 'organizer'))
      LIMIT 1`, [userId, viewer.id],
  );
  if (foreign[0]) throw forbidden('Tài khoản này còn làm ở giải khác mà bạn không quản lý — nhờ quản trị viên hệ thống sửa');
  return u;
}

/**
 * Tạo tài khoản trọng tài mới và thêm ngay vào giải (một giao dịch: lỗi thì không để lại tài khoản mồ côi).
 * @param {Pool} pool @param {Viewer} viewer @param {string} tid
 * @param {{ username: string, fullName: string, password: string }} input
 */
async function createReferee(pool, viewer, tid, input) {
  return withTx(pool, async (c) => {
    await requireOrganizer(c, tid, viewer);
    const u = await users.createUser(c, { ...input, role: 'user' });
    await c.query(`INSERT INTO tournament_staff (tournament_id, user_id, role) VALUES ($1, $2, 'referee')`, [tid, u.id]);
    await logEvent(c, tid, null, viewer.id, 'referee_create', { userId: u.id, username: u.username, name: u.full_name });
    return u;
  });
}

/**
 * Quản trị viên tạo tài khoản ở trang Tài khoản, tuỳ chọn thêm ngay làm TRỌNG TÀI của một số giải.
 * Một giao dịch: giải không tồn tại / đã xoá → huỷ cả việc tạo tài khoản (không để tài khoản nửa vời).
 * Chỉ admin (route đã chặn bằng requireAdmin; kiểm lại ở đây vì service có thể được gọi từ nơi khác).
 * @param {Pool} pool @param {Viewer} viewer
 * @param {{ username: string, fullName: string, password: string, role: 'admin'|'user', refereeTournamentIds?: string[] }} input
 */
async function createAccount(pool, viewer, input) {
  if (viewer.role !== 'admin') throw forbidden('Chỉ quản trị viên hệ thống tạo được tài khoản');
  const { refereeTournamentIds = [], ...user } = input;
  const tids = [...new Set(refereeTournamentIds)];
  return withTx(pool, async (c) => {
    const u = await users.createUser(c, user);
    if (tids.length) {
      const { rows } = await c.query('SELECT id FROM tournaments WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [tids]);
      if (rows.length !== tids.length) throw new HttpError(422, 'TOURNAMENT_NOT_FOUND', 'Có giải không tồn tại hoặc đã bị xoá');
      for (const tid of tids) {
        await c.query(`INSERT INTO tournament_staff (tournament_id, user_id, role) VALUES ($1, $2, 'referee')`, [tid, u.id]);
        await logEvent(c, tid, null, viewer.id, 'referee_create', { userId: u.id, username: u.username, name: u.full_name });
      }
    }
    return { ...u, refereeTournamentIds: tids };
  });
}

/**
 * Sửa tên / đặt lại mật khẩu / khoá – mở khoá. Đổi mật khẩu hoặc khoá → đăng xuất mọi phiên của người đó.
 * @param {Pool} pool @param {Viewer} viewer @param {string} tid @param {string} userId
 * @param {{ fullName?: string, password?: string, disabled?: boolean }} patch
 */
async function updateReferee(pool, viewer, tid, userId, patch) {
  return withTx(pool, async (c) => {
    await requireOrganizer(c, tid, viewer);
    await assertManageable(c, viewer, tid, userId);
    const u = await users.updateUser(c, viewer, userId, patch);
    const fields = Object.keys(patch).filter((k) => patch[k] !== undefined);
    // Không ghi mật khẩu vào nhật ký — chỉ ghi là đã đặt lại.
    await logEvent(c, tid, null, viewer.id, 'referee_update', {
      userId, name: u.full_name, fields, ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
    });
    return u;
  });
}

/**
 * "Xoá" trọng tài: gỡ khỏi giải (bỏ phụ trách sân của họ ở giải này) và khoá tài khoản nếu không còn làm ở giải
 * nào khác và người xem có quyền với tài khoản. Trận đã chấm giữ nguyên tên trọng tài (nhật ký điểm).
 * @param {Pool} pool @param {Viewer} viewer @param {string} tid @param {string} userId
 * @returns {Promise<{ removed: true, disabled: boolean }>}
 */
async function removeReferee(pool, viewer, tid, userId) {
  return withTx(pool, async (c) => {
    await requireOrganizer(c, tid, viewer);
    let manageable = true;
    try { await assertManageable(c, viewer, tid, userId); } catch (err) {
      if (/** @type {any} */ (err).status !== 403) throw err;
      manageable = false; // vẫn gỡ khỏi giải được, chỉ không khoá tài khoản của người khác
    }
    const { rows: u } = await c.query('SELECT full_name FROM users WHERE id = $1', [userId]);
    await c.query('DELETE FROM court_referees WHERE tournament_id = $1 AND user_id = $2', [tid, userId]);
    await c.query(`DELETE FROM tournament_staff WHERE tournament_id = $1 AND user_id = $2 AND role = 'referee'`, [tid, userId]);
    const { rows: rest } = await c.query('SELECT 1 FROM tournament_staff WHERE user_id = $1 LIMIT 1', [userId]);
    const disable = manageable && !rest[0];
    if (disable) await users.updateUser(c, viewer, userId, { disabled: true });
    await logEvent(c, tid, null, viewer.id, 'referee_remove', { userId, name: u[0]?.full_name, disabled: disable });
    return { removed: true, disabled: disable };
  });
}

module.exports = { listReferees, createReferee, createAccount, updateReferee, removeReferee };

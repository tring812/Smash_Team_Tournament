'use strict';
/**
 * Hồ sơ VĐV theo giải — định danh một NGƯỜI để chống trùng lịch / gọi sân chính xác.
 *
 * Thứ tự nhận diện khi thêm đội (resolveAthlete):
 *  1. MSSV (thẻ sinh viên) — mạnh nhất. 2. Số điện thoại.
 *     MSSV và SĐT trỏ tới 2 người khác nhau → từ chối (gõ nhầm của một trong hai).
 *  3. Không có MSSV/SĐT → khớp theo tên chuẩn hoá: đúng 1 hồ sơ cùng tên → dùng lại; 0 → tạo mới;
 *     ≥ 2 → nếu đúng 1 người cùng CLB thì là người đó, không thì từ chối và yêu cầu MSSV/SĐT (không đoán).
 *  Có MSSV/SĐT mà chưa khớp ai: nếu có đúng 1 hồ sơ cùng tên CHƯA có MSSV/SĐT (dữ liệu cũ) → gắn vào hồ sơ đó.
 *  `newAthlete: true` (BTC xác nhận "người khác, chỉ trùng tên") → bỏ bước khớp theo tên, luôn tạo hồ sơ mới
 *  (vẫn khớp MSSV/SĐT nếu có — định danh mạnh luôn thắng).
 *  Email chỉ để liên lạc: sai định dạng thì bỏ qua (không từ chối cả dòng).
 *
 * MSSV/SĐT/email là dữ liệu cá nhân: chỉ hàm cho BTC trả ra; nhật ký chỉ ghi TÊN TRƯỜNG đã sửa, không ghi giá trị.
 */
const { notFound, conflict, unprocessable } = require('../errors');
const { withTx, requireOrganizer, logEvent } = require('./tournamentService');
const { DISQUALIFIABLE_ENTRY_SQL } = require('./shared');

/** @typedef {import('./tournamentService').Pool} Pool */
/** @typedef {import('./tournamentService').Queryable} Queryable */
/** @typedef {import('./tournamentService').Viewer} Viewer */
/**
 * @typedef {{ name: string, studentId?: string|null, phone?: string|null, email?: string|null, club?: string,
 *             newAthlete?: boolean }} PersonInput
 */

/** Khớp với SQL backfill trong 006_athletes.sql. */
const nameKeyOf = (name) => String(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** "0901 234 567" / "+84 901-234-567" → "0901234567"; không hợp lệ → null. */
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+84')) d = `0${d.slice(3)}`;
  else if (d.startsWith('84') && d.length >= 11) d = `0${d.slice(2)}`;
  else if (!d.startsWith('0') && d.length === 9) d = `0${d}`; // Excel bỏ số 0 đầu khi ô là kiểu số
  return /^0\d{9,10}$/.test(d) ? d : null;
}

/** MSSV: bỏ khoảng trắng/gạch, viết hoa; 4–20 ký tự chữ/số. */
function normalizeStudentId(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[\s.\-_]/g, '').toUpperCase();
  return /^[A-Z0-9]{4,20}$/.test(s) ? s : null;
}

const describe = (a) => `${a.full_name}${a.student_id ? ` (MSSV ${a.student_id})` : ''}`;

/**
 * Tìm hoặc tạo hồ sơ VĐV. Ném lỗi 409/422 nếu dữ liệu định danh mâu thuẫn hoặc tên mơ hồ.
 * @param {Queryable} c @param {string} tid @param {PersonInput} p
 * @returns {Promise<{ id: string, full_name: string, created: boolean }>}
 */
async function resolveAthlete(c, tid, p) {
  const name = String(p.name).normalize('NFC').trim().replace(/\s+/g, ' ');
  const key = nameKeyOf(name);
  const sid = p.studentId ? normalizeStudentId(p.studentId) : null;
  const phone = p.phone ? normalizePhone(p.phone) : null;
  if (p.studentId && !sid) throw unprocessable(`MSSV "${p.studentId}" của ${name} không hợp lệ (4–20 chữ/số)`);
  if (p.phone && !phone) throw unprocessable(`SĐT "${p.phone}" của ${name} không hợp lệ`);
  const rawEmail = p.email ? String(p.email).trim().toLowerCase() : '';
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : null;
  const club = (p.club ?? '').trim().slice(0, 120);

  const find = async (col, v) => (v
    ? (await c.query(`SELECT * FROM athletes WHERE tournament_id = $1 AND ${col} = $2`, [tid, v])).rows[0] ?? null
    : null);
  const bySid = await find('student_id', sid);
  const byPhone = await find('phone', phone);
  if (bySid && byPhone && bySid.id !== byPhone.id) {
    throw conflict('ATHLETE_MISMATCH', `MSSV ${sid} là của ${bySid.full_name} nhưng SĐT ${phone} là của ${byPhone.full_name} — kiểm tra lại`);
  }
  let found = bySid ?? byPhone;
  if (found && !bySid && sid && found.student_id && found.student_id !== sid) {
    throw conflict('ATHLETE_MISMATCH', `SĐT ${phone} đã đăng ký cho ${describe(found)} — MSSV ${sid} không khớp`);
  }

  if (!found && !p.newAthlete) {
    const { rows: same } = await c.query('SELECT * FROM athletes WHERE tournament_id = $1 AND name_key = $2', [tid, key]);
    if (!sid && !phone) {
      // Nhiều người cùng tên: CLB trùng đúng 1 người → chính là người đó (vd 2 Nguyễn Thành Đạt khác trường).
      const byClub = same.length > 1 && club ? same.filter((x) => x.club && x.club.trim().toLowerCase() === club.toLowerCase()) : [];
      if (byClub.length === 1) same.splice(0, same.length, byClub[0]);
      if (same.length > 1) {
        throw unprocessable(`Có ${same.length} VĐV tên "${name}" — nhập MSSV hoặc SĐT để phân biệt`);
      }
      found = same[0] ?? null;
    } else {
      // Hồ sơ cũ chỉ có tên (chưa MSSV/SĐT) → gắn định danh vào đúng hồ sơ đó.
      const bare = same.filter((a) => !a.student_id && !a.phone);
      if (bare.length === 1) found = bare[0];
    }
  }

  if (found) {
    // Bổ sung thông tin còn thiếu; không ghi đè MSSV/SĐT đã có.
    const { rows } = await c.query(
      `UPDATE athletes SET student_id = COALESCE(student_id, $2), phone = COALESCE(phone, $3),
              email = COALESCE(email, $4), club = CASE WHEN club = '' THEN $5 ELSE club END
        WHERE id = $1 RETURNING id, full_name`,
      [found.id, sid, phone, email, club],
    );
    return { ...rows[0], created: false };
  }
  const { rows } = await c.query(
    `INSERT INTO athletes (tournament_id, full_name, name_key, student_id, phone, email, club)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, full_name`,
    [tid, name, key, sid, phone, email, club],
  );
  return { ...rows[0], created: true };
}

/**
 * Danh sách VĐV của giải kèm các nội dung đang đăng ký (CHỈ BTC — có MSSV/SĐT/email).
 * @param {Queryable} db @param {Viewer} viewer @param {string} tid
 */
async function listAthletes(db, viewer, tid) {
  await requireOrganizer(db, tid, viewer);
  const { rows } = await db.query(
    `SELECT a.id, a.full_name, a.student_id, a.phone, a.email, a.club, a.created_at,
            COALESCE(json_agg(json_build_object('entryId', e.id, 'categoryId', c.id, 'categoryCode', c.code, 'entryName',
                       CASE WHEN e.player2_name IS NULL THEN e.player1_name ELSE e.player1_name || ' / ' || e.player2_name END,
                        'disqualified', e.disqualified_at IS NOT NULL,
                        'canDisqualify', ${DISQUALIFIABLE_ENTRY_SQL}) ORDER BY c.code)
                     FILTER (WHERE e.id IS NOT NULL), '[]') AS entries
       FROM athletes a
       LEFT JOIN entries e ON a.id IN (e.player1_athlete_id, e.player2_athlete_id)
       LEFT JOIN categories c ON c.id = e.category_id
      WHERE a.tournament_id = $1
      GROUP BY a.id ORDER BY a.name_key, a.created_at`,
    [tid],
  );
  return rows;
}

/**
 * Sửa hồ sơ VĐV; đổi tên thì cập nhật tên hiển thị ở mọi đội có VĐV này.
 * @param {Pool} pool @param {Viewer} viewer @param {string} athleteId
 * @param {{ fullName?: string, studentId?: string|null, phone?: string|null, email?: string|null, club?: string }} patch
 */
async function updateAthlete(pool, viewer, athleteId, patch) {
  return withTx(pool, async (c) => {
    const a = (await c.query('SELECT * FROM athletes WHERE id = $1 FOR UPDATE', [athleteId])).rows[0];
    if (!a) throw notFound('Không tìm thấy VĐV');
    await requireOrganizer(c, a.tournament_id, viewer);
    const next = { ...a };
    if (patch.fullName !== undefined) {
      next.full_name = patch.fullName.normalize('NFC').trim().replace(/\s+/g, ' ');
      next.name_key = nameKeyOf(next.full_name);
    }
    if (patch.studentId !== undefined) {
      next.student_id = patch.studentId ? normalizeStudentId(patch.studentId) : null;
      if (patch.studentId && !next.student_id) throw unprocessable('MSSV không hợp lệ (4–20 chữ/số)');
    }
    if (patch.phone !== undefined) {
      next.phone = patch.phone ? normalizePhone(patch.phone) : null;
      if (patch.phone && !next.phone) throw unprocessable('SĐT không hợp lệ');
    }
    if (patch.email !== undefined) next.email = patch.email ? patch.email.trim().toLowerCase() : null;
    if (patch.club !== undefined) next.club = patch.club.trim();
    try {
      await c.query(
        `UPDATE athletes SET full_name = $2, name_key = $3, student_id = $4, phone = $5, email = $6, club = $7 WHERE id = $1`,
        [a.id, next.full_name, next.name_key, next.student_id, next.phone, next.email, next.club],
      );
    } catch (err) {
      if (/** @type {any} */ (err).code === '23505') {
        throw conflict('ATHLETE_DUPLICATE', /phone/.test(/** @type {any} */ (err).constraint ?? /** @type {any} */ (err).message)
          ? 'SĐT này đã thuộc VĐV khác trong giải' : 'MSSV này đã thuộc VĐV khác trong giải');
      }
      throw err;
    }
    if (next.full_name !== a.full_name) {
      await c.query('UPDATE entries SET player1_name = $2 WHERE player1_athlete_id = $1', [a.id, next.full_name]);
      await c.query('UPDATE entries SET player2_name = $2 WHERE player2_athlete_id = $1', [a.id, next.full_name]);
    }
    const fields = Object.keys(patch).filter((k) => patch[k] !== undefined);
    await logEvent(c, a.tournament_id, null, viewer.id, 'athlete_update', { name: next.full_name, before: a.full_name, fields });
    return { id: a.id, full_name: next.full_name, student_id: next.student_id, phone: next.phone, email: next.email, club: next.club };
  });
}

module.exports = { nameKeyOf, normalizePhone, normalizeStudentId, resolveAthlete, listAthletes, updateAthlete };

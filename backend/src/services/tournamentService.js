'use strict';
/**
 * Nghiệp vụ giải đấu. Chỉ phụ thuộc interface `{ query(text, params) }` và `pool.connect()`
 * nên test được với Postgres thật mà không cần HTTP.
 *
 * Giải MỞ RỘNG (VĐV ngoài CLB): bốc thăm ngẫu nhiên, không dùng ELO/hạt giống.
 *
 * Quy ước quyền:
 *  - quản trị viên hệ thống (role = 'admin') → toàn quyền mọi giải
 *  - organizer của giải                → quản lý giải đó
 *  - referee của giải                  → chỉ nhập điểm (trận được phân công, hoặc trận chưa phân công)
 *  - còn lại                           → chỉ xem giải đã publish
 */

const crypto = require('node:crypto');
const { randomDraw, partitionKey, roundRobin, shuffle } = require('../domain/draw');
const { scheduleMatches, countNoRest } = require('../domain/schedule');
const { computeStandings } = require('../domain/standings');
const { seedsFromGroups, buildBracket, roundLabel } = require('../domain/bracket');
const { evaluateMatch } = require('../domain/scoring');
const { effectiveRules, buildRoundRules, sameRules, scopeKey, fromEndLabel } = require('../domain/roundRules');
const { notFound, forbidden, conflict, unprocessable } = require('../errors');
const rallies = require('./rallyStore');

/** @typedef {{ id: string, full_name: string, role: string }} Viewer */
/** @typedef {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number|null }> }} Queryable */
/** @typedef {{ connect: () => Promise<Queryable & { release: () => void }> } & Queryable} Pool */

const FINAL_STATUSES = new Set(['finished', 'walkover', 'bye']);

/**
 * Chạy `fn` trong một transaction; rollback nếu ném lỗi.
 * @template T
 * @param {Pool} pool
 * @param {(c: Queryable) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Vai trò hiệu lực của viewer trong một giải.
 * @param {Queryable} db @param {string} tournamentId @param {Viewer|null} viewer
 * @returns {Promise<'admin'|'organizer'|'referee'|null>}
 */
async function roleIn(db, tournamentId, viewer) {
  if (!viewer) return null;
  const { rows } = await db.query(
    `SELECT t.deleted_at, s.role FROM tournaments t
       LEFT JOIN tournament_staff s ON s.tournament_id = t.id AND s.user_id = $2
      WHERE t.id = $1`,
    [tournamentId, viewer.id],
  );
  // Giải đã xoá (mềm): không ai thao tác được nữa — chỉ khôi phục (restoreTournament).
  if (rows[0]?.deleted_at) return null;
  if (viewer.role === 'admin') return 'admin';
  return rows[0]?.role ?? null;
}

/** @param {Queryable} db @param {string} tid @param {Viewer|null} viewer */
async function requireOrganizer(db, tid, viewer) {
  const role = await roleIn(db, tid, viewer);
  if (role !== 'admin' && role !== 'organizer') throw forbidden();
  return role;
}

/** @param {Queryable} db @param {string} categoryId */
async function loadCategory(db, categoryId, lock = false) {
  const { rows } = await db.query(
    `SELECT * FROM categories WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [categoryId],
  );
  if (!rows[0]) throw notFound('Không tìm thấy nội dung thi đấu');
  return rows[0];
}

/** Chuẩn hoá tên để làm khoá chống trùng lịch khi người chơi chưa liên kết tài khoản. */
function nameKey(name) {
  return `n:${String(name).normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Ghi nhật ký thao tác BTC (append-only).
 * @param {Queryable} c @param {string} tid @param {string|null} categoryId @param {string} actorId
 * @param {string} action @param {Record<string, unknown>} details
 */
async function logEvent(c, tid, categoryId, actorId, action, details) {
  await c.query(
    `INSERT INTO tournament_events (tournament_id, category_id, actor_user_id, action, details) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tid, categoryId, actorId, action, JSON.stringify(details)],
  );
}

/** Trận vòng bảng đã "bắt đầu" (có điểm hoặc đã có kết quả) — dùng cho các kiểm tra khoá. */
const STARTED_SQL = `(status IN ('live', 'finished', 'walkover') OR games <> '[]'::jsonb)`;

/**
 * Khoá NGƯỜI CHƠI cho chống trùng lịch / gọi sân: hồ sơ VĐV (MSSV/SĐT) nếu có, rồi tài khoản, cuối cùng tên chuẩn hoá.
 * @param {string|null|undefined} aid athlete id @param {string|null|undefined} uid @param {string|null|undefined} name
 */
const participantKey = (aid, uid, name) => (aid ? `a:${aid}` : uid ? `u:${uid}` : name ? nameKey(name) : null);

/**
 * Xoá hồ sơ VĐV không còn ở đội nào (sau khi xoá đội / nội dung) — không giữ MSSV/SĐT không còn dùng.
 * @param {Queryable} c @param {string} tid
 */
async function pruneAthletes(c, tid) {
  await c.query(
    `DELETE FROM athletes a WHERE a.tournament_id = $1
       AND NOT EXISTS (SELECT 1 FROM entries e WHERE a.id IN (e.player1_athlete_id, e.player2_athlete_id))`, [tid],
  );
}

/** Tên hiển thị của một đội. */
function entryLabel(e) {
  if (!e) return null;
  return e.player2_name ? `${e.player1_name} / ${e.player2_name}` : e.player1_name;
}

// ───────────────────────────── Quản lý giải ─────────────────────────────

/**
 * Tạo giải mới (chỉ quản trị viên hệ thống). Người tạo tự thành organizer.
 * @param {Pool} pool @param {Viewer} viewer
 * @param {{ slug: string, name: string, venue?: string, startsAt: string, courts?: number, slotMinutes?: number }} input
 */
async function createTournament(pool, viewer, input) {
  if (viewer?.role !== 'admin') throw forbidden('Chỉ quản trị viên được tạo giải');
  return withTx(pool, async (c) => {
    try {
      const { rows } = await c.query(
        `INSERT INTO tournaments (slug, name, venue, starts_at, courts, slot_minutes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [input.slug, input.name, input.venue ?? '', input.startsAt, input.courts ?? 4, input.slotMinutes ?? 30, viewer.id],
      );
      await c.query(
        `INSERT INTO tournament_staff (tournament_id, user_id, role) VALUES ($1, $2, 'organizer')`,
        [rows[0].id, viewer.id],
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') throw conflict('SLUG_TAKEN', 'Đường dẫn (slug) đã được dùng');
      throw err;
    }
  });
}

/**
 * Sửa thông tin giải (organizer): tên, đường dẫn (slug), địa điểm, giờ bắt đầu, số sân, phút/trận, trạng thái.
 * Không tự xếp lại lịch — giao diện hỏi BTC có xếp lại các trận chưa đánh không.
 * @param {Queryable} db @param {Viewer} viewer @param {string} tid
 * @param {{ name?: string, slug?: string, venue?: string, startsAt?: string, courts?: number, slotMinutes?: number, status?: string }} patch
 */
async function updateTournament(db, viewer, tid, patch) {
  await requireOrganizer(db, tid, viewer);
  try {
    const { rows } = await db.query(
      `UPDATE tournaments SET
         name = COALESCE($2, name), venue = COALESCE($3, venue), starts_at = COALESCE($4, starts_at),
         courts = COALESCE($5, courts), slot_minutes = COALESCE($6, slot_minutes), status = COALESCE($7, status),
         slug = COALESCE($8, slug)
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [tid, patch.name ?? null, patch.venue ?? null, patch.startsAt ?? null, patch.courts ?? null,
        patch.slotMinutes ?? null, patch.status ?? null, patch.slug ?? null],
    );
    if (!rows[0]) throw notFound('Không tìm thấy giải');
    return rows[0];
  } catch (err) {
    if (/** @type {any} */ (err).code === '23505') throw conflict('SLUG_TAKEN', 'Đường dẫn (slug) đã được dùng');
    throw err;
  }
}

/** Số ngày được khôi phục giải đã xoá. */
const RESTORE_DAYS = 7;

/**
 * Chỉ quản trị viên hoặc người tạo giải được xoá / khôi phục.
 * @param {{ created_by: string }} t @param {Viewer|null} viewer
 */
const canDelete = (t, viewer) => Boolean(viewer) && (viewer?.role === 'admin' || t.created_by === viewer?.id);

/**
 * XOÁ giải (mềm): giải biến khỏi mọi danh sách / đường dẫn; khôi phục được trong 7 ngày, sau đó xoá hẳn.
 * Phải gõ lại đúng slug để xác nhận. Không xoá giải "Đang diễn ra".
 * @param {Pool} pool @param {Viewer} viewer @param {string} tid @param {string} confirmSlug
 */
async function deleteTournament(pool, viewer, tid, confirmSlug) {
  return withTx(pool, async (c) => {
    const t = (await c.query('SELECT * FROM tournaments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [tid])).rows[0];
    if (!t) throw notFound('Không tìm thấy giải');
    if (!canDelete(t, viewer)) throw forbidden('Chỉ quản trị viên hoặc người tạo giải được xoá giải');
    if (t.status === 'ongoing') throw conflict('TOURNAMENT_ONGOING', 'Giải đang diễn ra — chuyển trạng thái khác rồi mới xoá được');
    if (confirmSlug !== t.slug) throw unprocessable(`Gõ đúng đường dẫn "${t.slug}" để xác nhận xoá`);
    await c.query('UPDATE tournaments SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [tid, viewer.id]);
    return { id: t.id, slug: t.slug, restoreDays: RESTORE_DAYS };
  });
}

/**
 * Khôi phục giải đã xoá (trong 7 ngày).
 * @param {Pool} pool @param {Viewer} viewer @param {string} tid
 */
async function restoreTournament(pool, viewer, tid) {
  return withTx(pool, async (c) => {
    const t = (await c.query('SELECT * FROM tournaments WHERE id = $1 AND deleted_at IS NOT NULL FOR UPDATE', [tid])).rows[0];
    if (!t) throw notFound('Không tìm thấy giải đã xoá');
    if (!canDelete(t, viewer)) throw forbidden('Chỉ quản trị viên hoặc người tạo giải được khôi phục');
    if (Date.now() - new Date(t.deleted_at).getTime() > RESTORE_DAYS * 86_400_000) {
      throw conflict('RESTORE_EXPIRED', `Đã quá ${RESTORE_DAYS} ngày, không khôi phục được`);
    }
    const { rows } = await c.query('UPDATE tournaments SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 RETURNING *', [tid]);
    return rows[0];
  });
}

/**
 * Giải đã xoá còn khôi phục được: quản trị viên thấy tất cả, người khác thấy giải mình tạo.
 * @param {Queryable} db @param {Viewer} viewer
 */
async function listDeletedTournaments(db, viewer) {
  const { rows } = await db.query(
    `SELECT t.id, t.slug, t.name, t.starts_at, t.deleted_at, t.deleted_at + make_interval(days => $3) AS purge_at,
            u.full_name AS deleted_by
       FROM tournaments t LEFT JOIN users u ON u.id = t.deleted_by
      WHERE t.deleted_at IS NOT NULL AND t.deleted_at > now() - make_interval(days => $3)
        AND ($1::boolean OR t.created_by = $2)
      ORDER BY t.deleted_at DESC`,
    [viewer.role === 'admin', viewer.id, RESTORE_DAYS],
  );
  return rows;
}

/**
 * Xoá HẲN các giải đã xoá mềm quá 7 ngày (dây chuyền qua mọi bảng con). Gọi định kỳ từ server.
 * @param {Queryable} db @param {Date} [now]
 * @returns {Promise<number>} số giải đã xoá hẳn
 */
async function purgeDeletedTournaments(db, now = new Date()) {
  const { rowCount } = await db.query(
    'DELETE FROM tournaments WHERE deleted_at IS NOT NULL AND deleted_at < $1::timestamptz - make_interval(days => $2)',
    [now.toISOString(), RESTORE_DAYS],
  );
  return rowCount ?? 0;
}

/**
 * Thêm/đổi vai trò BTC hoặc trọng tài. Người được thêm phải có tài khoản (admin tạo ở Quản lý tài khoản).
 * @param {Queryable} db @param {Viewer} viewer @param {string} tid
 * @param {{ userId: string, role: 'organizer'|'referee' }} input
 */
async function upsertStaff(db, viewer, tid, input) {
  await requireOrganizer(db, tid, viewer);
  const u = await db.query('SELECT id FROM users WHERE id = $1 AND disabled_at IS NULL', [input.userId]);
  if (!u.rows[0]) throw unprocessable('Tài khoản không tồn tại hoặc đã bị khoá');
  await db.query(
    `INSERT INTO tournament_staff (tournament_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (tournament_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [tid, input.userId, input.role],
  );
  return { tournamentId: tid, userId: input.userId, role: input.role };
}

/** @param {Queryable} db @param {Viewer} viewer @param {string} tid @param {string} userId */
async function removeStaff(db, viewer, tid, userId) {
  await requireOrganizer(db, tid, viewer);
  await db.query('DELETE FROM tournament_staff WHERE tournament_id = $1 AND user_id = $2', [tid, userId]);
}

/**
 * Tạo nội dung thi đấu (ghi nhật ký).
 * @param {Pool} pool @param {Viewer} viewer @param {string} tid
 * @param {{ code: string, name: string, isDoubles: boolean, groupCount?: number, advancePerGroup?: number,
 *           pointsToWin?: number, maxPoints?: number, gamesToWin?: number }} input
 */
async function createCategory(pool, viewer, tid, input) {
  return withTx(pool, async (c) => {
    await requireOrganizer(c, tid, viewer);
    try {
      const { rows } = await c.query(
        `INSERT INTO categories (tournament_id, code, name, is_doubles, group_count, advance_per_group,
                                 points_to_win, max_points, games_to_win)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [tid, input.code, input.name, input.isDoubles, input.groupCount ?? 2, input.advancePerGroup ?? 2,
          input.pointsToWin ?? 21, input.maxPoints ?? 30, input.gamesToWin ?? 2],
      );
      await logEvent(c, tid, rows[0].id, viewer.id, 'category_create', { code: rows[0].code, name: rows[0].name });
      return rows[0];
    } catch (err) {
      throw mapCategoryError(err);
    }
  });
}

/**
 * Đổi luật điểm (mặc định hoặc theo vòng) chỉ được khi KHÔNG trận đã bắt đầu nào bị đổi luật hiệu lực —
 * tránh trận đang đánh / đã có kết quả bị chấm lại theo luật khác.
 * @param {Queryable} c @param {any} before hàng categories hiện tại @param {any} after hàng categories sau khi sửa
 * @param {string} code mã lỗi 409
 */
async function assertRulesChangeAllowed(c, before, after, code) {
  const { rows } = await c.query(
    `SELECT m.stage, m.round, (SELECT max(k.round) FROM matches k WHERE k.category_id = m.category_id AND k.stage = 'knockout') AS ko_rounds
       FROM matches m WHERE m.category_id = $1 AND m.status NOT IN ('bye', 'cancelled') AND ${STARTED_SQL.replace(/status|games/g, (w) => `m.${w}`)}`,
    [before.id],
  );
  for (const m of rows) {
    if (!sameRules(effectiveRules(before, m.stage, m.round, m.ko_rounds), effectiveRules(after, m.stage, m.round, m.ko_rounds))) {
      const k = scopeKey(m.stage, m.round, m.ko_rounds);
      const label = k === 'group' ? 'Vòng bảng' : fromEndLabel(Number(k.slice(3)));
      throw conflict(code, `${label} đã có trận bắt đầu — không đổi được luật điểm của vòng này`);
    }
  }
}

/**
 * Đặt luật điểm riêng theo vòng (thay toàn bộ luật riêng cũ; danh sách rỗng = dùng luật mặc định cho mọi vòng).
 * @param {Pool} pool @param {Viewer} viewer @param {string} categoryId
 * @param {Array<{ stage: 'group'|'knockout', fromEnd?: number|null, pointsToWin: number, maxPoints: number, gamesToWin: number }>} list
 */
async function setRoundRules(pool, viewer, categoryId, list) {
  return withTx(pool, async (c) => {
    const cat = await loadCategory(c, categoryId, true);
    await requireOrganizer(c, cat.tournament_id, viewer);
    let roundRules;
    try {
      roundRules = buildRoundRules(list.map((x) => (x.stage === 'group' ? { ...x, stage: 'group' } : { ...x, stage: 'knockout', fromEnd: x.fromEnd ?? null })));
    } catch (err) {
      if (err instanceof RangeError) throw unprocessable(err.message);
      throw err;
    }
    await assertRulesChangeAllowed(c, cat, { ...cat, round_rules: roundRules }, 'RULES_LOCKED');
    const { rows } = await c.query('UPDATE categories SET round_rules = $2::jsonb WHERE id = $1 RETURNING *', [categoryId, JSON.stringify(roundRules)]);
    await logEvent(c, cat.tournament_id, categoryId, viewer.id, 'rules_update', { code: cat.code, before: cat.round_rules, after: roundRules });
    return rows[0];
  });
}

/** Lỗi ràng buộc DB của bảng categories → lỗi nghiệp vụ dễ hiểu. */
function mapCategoryError(err) {
  if (err?.code === '23505') return conflict('CATEGORY_EXISTS', 'Mã nội dung đã tồn tại trong giải');
  if (err?.code === '23514') return unprocessable('Cấu hình nội dung không hợp lệ (trần điểm phải ≥ điểm thắng game)');
  return err;
}

/** Nội dung đã có trận bắt đầu (có điểm / đang đánh / đã có kết quả) chưa — không tính trận miễn đấu, trận đã huỷ. */
async function categoryStarted(c, categoryId) {
  const { rows } = await c.query(
    `SELECT 1 FROM matches WHERE category_id = $1 AND status NOT IN ('bye', 'cancelled') AND ${STARTED_SQL} LIMIT 1`,
    [categoryId],
  );
  return Boolean(rows[0]);
}

/**
 * Sửa nội dung thi đấu. Quy tắc khoá theo giai đoạn (tránh làm sai các trận đã tạo):
 *  - mã, tên: sửa bất cứ lúc nào;
 *  - đơn/đôi: chỉ khi chưa bốc thăm VÀ chưa có đội;
 *  - số bảng, số đội đi tiếp: chỉ khi chưa bốc thăm;
 *  - luật điểm, số game thắng: chỉ khi chưa trận nào bắt đầu.
 * @param {Pool} pool @param {Viewer} viewer @param {string} categoryId
 * @param {{ code?: string, name?: string, isDoubles?: boolean, groupCount?: number, advancePerGroup?: number,
 *           pointsToWin?: number, maxPoints?: number, gamesToWin?: number }} patch
 */
async function updateCategory(pool, viewer, categoryId, patch) {
  return withTx(pool, async (c) => {
    const cat = await loadCategory(c, categoryId, true);
    await requireOrganizer(c, cat.tournament_id, viewer);
    const changed = (k, col) => patch[k] !== undefined && patch[k] !== cat[col];
    if (changed('isDoubles', 'is_doubles')) {
      const { rows } = await c.query('SELECT count(*)::int AS n FROM entries WHERE category_id = $1', [categoryId]);
      if (cat.stage !== 'setup' || rows[0].n > 0) throw conflict('CATEGORY_LOCKED', 'Chỉ đổi đơn/đôi khi nội dung chưa có đội nào');
    }
    if ((changed('groupCount', 'group_count') || changed('advancePerGroup', 'advance_per_group')) && cat.stage !== 'setup') {
      throw conflict('CATEGORY_LOCKED', 'Đã bốc thăm — không đổi được số bảng / số đội đi tiếp');
    }
    if (changed('pointsToWin', 'points_to_win') || changed('maxPoints', 'max_points') || changed('gamesToWin', 'games_to_win')) {
      // Luật mặc định chỉ khoá với trận ĐANG dùng nó (vòng có luật riêng không bị ảnh hưởng).
      await assertRulesChangeAllowed(c, cat, {
        ...cat,
        points_to_win: patch.pointsToWin ?? cat.points_to_win,
        max_points: patch.maxPoints ?? cat.max_points,
        games_to_win: patch.gamesToWin ?? cat.games_to_win,
      }, 'CATEGORY_LOCKED');
    }
    let row;
    try {
      ({ rows: [row] } = await c.query(
        `UPDATE categories SET code = COALESCE($2, code), name = COALESCE($3, name), is_doubles = COALESCE($4, is_doubles),
                group_count = COALESCE($5, group_count), advance_per_group = COALESCE($6, advance_per_group),
                points_to_win = COALESCE($7, points_to_win), max_points = COALESCE($8, max_points),
                games_to_win = COALESCE($9, games_to_win)
          WHERE id = $1 RETURNING *`,
        [categoryId, patch.code ?? null, patch.name ?? null, patch.isDoubles ?? null, patch.groupCount ?? null,
          patch.advancePerGroup ?? null, patch.pointsToWin ?? null, patch.maxPoints ?? null, patch.gamesToWin ?? null],
      ));
    } catch (err) {
      throw mapCategoryError(err);
    }
    const before = { code: cat.code, name: cat.name };
    await logEvent(c, cat.tournament_id, categoryId, viewer.id, 'category_update', {
      before, after: { code: row.code, name: row.name },
      fields: Object.keys(patch).filter((k) => patch[k] !== undefined),
    });
    return row;
  });
}

/**
 * Xoá nội dung (kèm đội, bảng, trận) — chỉ khi chưa trận nào bắt đầu. Nhật ký thao tác được giữ lại.
 * @param {Pool} pool @param {Viewer} viewer @param {string} categoryId
 */
async function deleteCategory(pool, viewer, categoryId) {
  return withTx(pool, async (c) => {
    const cat = await loadCategory(c, categoryId, true);
    await requireOrganizer(c, cat.tournament_id, viewer);
    if (await categoryStarted(c, categoryId)) {
      throw conflict('CATEGORY_STARTED', 'Nội dung đã có trận được nhập điểm — không thể xoá');
    }
    const { rows } = await c.query('SELECT count(*)::int AS n FROM entries WHERE category_id = $1', [categoryId]);
    await logEvent(c, cat.tournament_id, categoryId, viewer.id, 'category_delete', { code: cat.code, name: cat.name, entries: rows[0].n });
    await c.query('DELETE FROM categories WHERE id = $1', [categoryId]);
    await pruneAthletes(c, cat.tournament_id);
    return { deleted: categoryId, code: cat.code };
  });
}

/**
 * Thêm hàng loạt đội/VĐV (chỉ khi chưa bốc thăm). Mỗi VĐV được gắn với một HỒ SƠ (MSSV → SĐT → tên),
 * nên một người đánh nhiều nội dung là cùng một người khi chống trùng lịch. Cả lô trong 1 transaction:
 * một dòng lỗi → không dòng nào được thêm.
 * @param {Pool} pool @param {Viewer} viewer @param {string} categoryId
 * @param {Array<{ player1Name: string, player2Name?: string|null, player1UserId?: string|null,
 *                 player2UserId?: string|null, club?: string, rating?: number|null, seed?: number|null,
 *                 player1StudentId?: string|null, player1Phone?: string|null, player1Email?: string|null,
 *                 player2StudentId?: string|null, player2Phone?: string|null, player2Email?: string|null,
 *                 player1NewAthlete?: boolean, player2NewAthlete?: boolean }>} list
 */
async function addEntries(pool, viewer, categoryId, list) {
  // eslint-disable-next-line global-require -- athleteService require tournamentService (vòng) → nạp muộn
  const { resolveAthlete } = require('./athleteService');
  return withTx(pool, async (c) => {
    const cat = await loadCategory(c, categoryId, true);
    await requireOrganizer(c, cat.tournament_id, viewer);
    if (cat.stage !== 'setup') throw conflict('ALREADY_DRAWN', 'Đã bốc thăm, không thể thêm đội');
    const { rows: existing } = await c.query(
      'SELECT player1_athlete_id, player2_athlete_id FROM entries WHERE category_id = $1', [categoryId],
    );
    /** @type {Set<string>} hồ sơ đã có trong nội dung này */
    const inCategory = new Set(existing.flatMap((r) => [r.player1_athlete_id, r.player2_athlete_id]).filter(Boolean));
    const out = [];
    for (const [i, e] of list.entries()) {
      const line = `Dòng ${i + 1}`;
      if (cat.is_doubles !== Boolean(e.player2Name)) {
        throw unprocessable(`${line}: nội dung ${cat.is_doubles ? 'đôi cần 2' : 'đơn chỉ cần 1'} VĐV`);
      }
      const resolve = async (n, sid, phone, email, newAthlete) => {
        try {
          return await resolveAthlete(c, cat.tournament_id, { name: n, studentId: sid, phone, email, club: e.club, newAthlete });
        } catch (err) {
          if (err instanceof Error && 'status' in err) err.message = `${line}: ${err.message}`;
          throw err;
        }
      };
      const a1 = await resolve(e.player1Name, e.player1StudentId, e.player1Phone, e.player1Email, e.player1NewAthlete);
      const a2 = e.player2Name ? await resolve(e.player2Name, e.player2StudentId, e.player2Phone, e.player2Email, e.player2NewAthlete) : null;
      if (a2 && a2.id === a1.id) throw unprocessable(`${line}: hai VĐV của đội là cùng một người (${a1.full_name})`);
      for (const a of [a1, a2].filter(Boolean)) {
        if (inCategory.has(a.id)) throw conflict('ATHLETE_ALREADY_ENTERED', `${line}: ${a.full_name} đã đăng ký nội dung ${cat.code}`);
        inCategory.add(a.id);
      }
      const { rows } = await c.query(
        `INSERT INTO entries (category_id, player1_name, player2_name, player1_user_id, player2_user_id, club, rating, seed,
                              player1_athlete_id, player2_athlete_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [categoryId, a1.full_name, a2?.full_name ?? null, e.player1UserId ?? null, e.player2UserId ?? null,
          e.club ?? '', e.rating ?? 950, e.seed ?? null, a1.id, a2?.id ?? null],
      );
      out.push(rows[0]);
    }
    return out;
  });
}

/** @param {Pool} pool @param {Viewer} viewer @param {string} entryId */
async function removeEntry(pool, viewer, entryId) {
  return withTx(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT e.id, c.id AS category_id, c.tournament_id, c.stage
         FROM entries e JOIN categories c ON c.id = e.category_id WHERE e.id = $1 FOR UPDATE OF c`,
      [entryId],
    );
    if (!rows[0]) throw notFound('Không tìm thấy đội');
    await requireOrganizer(c, rows[0].tournament_id, viewer);
    if (rows[0].stage !== 'setup') throw conflict('ALREADY_DRAWN', 'Đã bốc thăm, không thể xoá đội');
    await c.query('DELETE FROM entries WHERE id = $1', [entryId]);
    await pruneAthletes(c, rows[0].tournament_id);
  });
}

// ───────────────────────────── Bốc thăm & lịch ─────────────────────────────

/**
 * Chèn các trận vòng tròn cho một bảng.
 * @param {Queryable} c @param {any} cat @param {string} groupId @param {string[]} entryIds
 */
async function insertRoundRobin(c, cat, groupId, entryIds) {
  const pairs = roundRobin(entryIds);
  for (const [pos, p] of pairs.entries()) {
    await c.query(
      `INSERT INTO matches (tournament_id, category_id, stage, group_id, round, position, entry_a_id, entry_b_id)
       VALUES ($1, $2, 'group', $3, $4, $5, $6, $7)`,
      [cat.tournament_id, cat.id, groupId, p.round, pos, p.a, p.b],
    );
  }
  return pairs.length;
}

/**
 * Huỷ (status 'cancelled') các trận vòng bảng chưa huỷ có đội bị truất quyền; lưu trạng thái cũ để khôi phục.
 * @param {Queryable} c @param {string} categoryId @param {string|null} [entryId] null = mọi đội đang bị truất quyền
 * @returns {Promise<number>}
 */
async function cancelDisqualifiedGroupMatches(c, categoryId, entryId = null) {
  const { rowCount } = await c.query(
    `UPDATE matches m SET
        pre_cancel = jsonb_build_object('status', m.status, 'winner', m.winner_entry_id, 'court', m.court,
                                        'scheduled_at', m.scheduled_at, 'finished_at', m.finished_at),
        status = 'cancelled', winner_entry_id = NULL, finished_at = NULL, court = NULL, scheduled_at = NULL,
        version = version + 1, updated_at = now()
      WHERE m.category_id = $1 AND m.stage = 'group' AND m.status <> 'cancelled'
        AND EXISTS (SELECT 1 FROM entries e WHERE e.id IN (m.entry_a_id, m.entry_b_id) AND e.disqualified_at IS NOT NULL
                      AND ($2::uuid IS NULL OR e.id = $2::uuid))`,
    [categoryId, entryId],
  );
  return rowCount ?? 0;
}

/**
 * Kiểm tra & chuẩn hoá bảng có sẵn. Tên bảng: bỏ tiền tố "Bảng", viết hoa, 1–4 ký tự.
 * Bốc thăm phụ (draw_lot, phá hoà cuối cùng) vẫn ngẫu nhiên.
 * @param {{ id: string }[]} entries đội đang thi đấu @param {{ name: string, entryIds: string[] }[]} manual
 * @param {(n: number) => number} [rng]
 */
function manualGroups(entries, manual, rng) {
  const active = new Set(entries.map((e) => e.id));
  const seen = new Set();
  const names = new Set();
  const groups = manual.map((g) => {
    const name = String(g.name).replace(/^\s*bảng\s*/i, '').trim().toUpperCase();
    if (!/^[\p{L}0-9]{1,4}$/u.test(name)) throw unprocessable(`Tên bảng "${g.name}" không hợp lệ (1–4 chữ/số, vd A, B, 1)`);
    if (names.has(name)) throw unprocessable(`Bảng ${name} bị lặp`);
    names.add(name);
    if (g.entryIds.length < 2) throw unprocessable(`Bảng ${name} cần ít nhất 2 đội`);
    for (const id of g.entryIds) {
      if (!active.has(id)) throw unprocessable(`Bảng ${name}: có đội không thuộc nội dung hoặc đã bị truất quyền`);
      if (seen.has(id)) throw unprocessable(`Bảng ${name}: một đội nằm ở 2 bảng`);
      seen.add(id);
    }
    return { name, entryIds: [...g.entryIds] };
  });
  if (seen.size !== active.size) throw unprocessable(`Còn ${active.size - seen.size} đội chưa được xếp vào bảng nào`);
  if (groups.length > 32) throw unprocessable('Tối đa 32 bảng');
  // CSPRNG như bốc thăm ngẫu nhiên; rng chỉ truyền khi test.
  const lots = new Map(shuffle(entries.map((e) => e.id), rng ?? ((n) => crypto.randomInt(n))).map((id, i) => [id, i + 1]));
  return { groups, lots, sameAsBefore: false };
}

/**
 * Bốc thăm NGẪU NHIÊN chia bảng (giải mở rộng: không dùng ELO/hạt giống, tách đội cùng CLB) và sinh trận vòng tròn.
 * Gọi lại khi đã bốc = BỐC LẠI: chỉ được khi chưa trận vòng bảng nào bắt đầu; kết quả mới luôn khác lần trước
 * (nếu tồn tại cách chia khác).
 * @param {Pool} pool @param {Viewer} viewer @param {string} categoryId
 * `opts.manual`: BẢNG CÓ SẴN (lễ bốc thăm trực tiếp / BTC tự chia) — [{ name, entryIds }], phải phủ đúng mọi
 * đội đang thi đấu của nội dung, mỗi đội 1 lần, mỗi bảng ≥ 2 đội; số bảng của nội dung đổi theo.
 * @param {{ rng?: (n: number) => number, manual?: { name: string, entryIds: string[] }[] }} [opts]  rng chỉ để test
 */
async function drawGroups(pool, viewer, categoryId, opts = {}) {
  return withTx(pool, async (c) => {
    const cat = await loadCategory(c, categoryId, true);
    await requireOrganizer(c, cat.tournament_id, viewer);
    if (cat.stage !== 'setup' && cat.stage !== 'groups') {
      throw conflict('KNOCKOUT_STARTED', 'Đã tạo nhánh loại trực tiếp, không thể bốc thăm lại');
    }
    const redraw = cat.stage === 'groups';
    let avoid = null;
    if (redraw) {
      const started = await c.query(
        `SELECT 1 FROM matches WHERE category_id = $1 AND stage = 'group' AND ${STARTED_SQL} LIMIT 1`, [categoryId],
      );
      if (started.rows[0]) throw conflict('GROUPS_STARTED', 'Đã có trận vòng bảng được nhập điểm, không thể bốc thăm lại');
      const { rows: prev } = await c.query(
        `SELECT gm.group_id, gm.entry_id FROM group_members gm JOIN groups g ON g.id = gm.group_id
          JOIN entries e ON e.id = gm.entry_id WHERE g.category_id = $1 AND e.disqualified_at IS NULL`, [categoryId],
      );
      /** @type {Map<string, string[]>} */
      const byGroup = new Map();
      for (const r of prev) byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r.entry_id]);
      avoid = partitionKey([...byGroup.values()]);
      await c.query(`DELETE FROM matches WHERE category_id = $1 AND stage = 'group'`, [categoryId]);
      await c.query('DELETE FROM groups WHERE category_id = $1', [categoryId]);
    }
    const { rows: entries } = await c.query(
      'SELECT id, club FROM entries WHERE category_id = $1 AND disqualified_at IS NULL', [categoryId],
    );
    let result;
    if (opts.manual) {
      result = manualGroups(entries, opts.manual, opts.rng);
      await c.query('UPDATE categories SET group_count = $2 WHERE id = $1', [categoryId, result.groups.length]);
    } else {
      try {
        result = randomDraw(entries, cat.group_count, { avoid, rng: opts.rng });
      } catch (err) {
        if (err instanceof RangeError) throw unprocessable(err.message);
        throw err;
      }
    }
    for (const [id, lot] of result.lots) {
      await c.query('UPDATE entries SET draw_lot = $2 WHERE id = $1', [id, lot]);
    }
    let matchCount = 0;
    for (const [idx, g] of result.groups.entries()) {
      const { rows } = await c.query(
        'INSERT INTO groups (category_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
        [categoryId, g.name, idx],
      );
      for (const eid of g.entryIds) {
        await c.query('INSERT INTO group_members (group_id, entry_id) VALUES ($1, $2)', [rows[0].id, eid]);
      }
      matchCount += await insertRoundRobin(c, cat, rows[0].id, g.entryIds);
    }
    await c.query(`UPDATE categories SET stage = 'groups' WHERE id = $1`, [categoryId]);
    await logEvent(c, cat.tournament_id, categoryId, viewer.id, redraw ? 'redraw' : 'draw', {
      groups: result.groups.map((g) => ({ name: g.name, entryIds: g.entryIds })), sameAsBefore: result.sameAsBefore,
      ...(opts.manual ? { manual: true } : {}),
    });
    return {
      redraw,
      sameAsBefore: result.sameAsBefore,
      groups: result.groups.map((g) => ({ name: g.name, size: g.entryIds.length })),
      matchCount,
    };
  });
}

/**
 * Xếp sân & giờ cho các trận chưa đánh của MỘT giai đoạn trong toàn giải (chống trùng VĐV giữa các nội dung).
 *  - 'group': bỏ trống startAt = giờ khai mạc.
 *  - 'knockout': BẮT BUỘC startAt (vòng loại trực tiếp có thể khác ngày); xếp cả nhánh một lần, kể cả trận
 *    chưa biết đội — trận vòng sau bắt đầu sau khi các trận dẫn vào xong + nghỉ 1 khung.
 * Không cho giờ bắt đầu trong quá khứ; sân/VĐV đang có trận 'live' bị chặn ở khung đầu tiên.
 * courts/slotMinutes: ghi đè cho lần xếp này (vd ngày đánh nhánh thuê ít sân hơn), không đổi cấu hình giải.
 *
 * @param {Pool} pool @param {Viewer} viewer @param {string} tid
 * @param {{ stage?: 'group'|'knockout', startAt?: string, courts?: number, slotMinutes?: number, now?: Date }} [opts]
 */
async function scheduleTournament(pool, viewer, tid, opts = {}) {
  return withTx(pool, async (c) => {
    await requireOrganizer(c, tid, viewer);
    const t = (await c.query('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [tid])).rows[0];
    if (!t) throw notFound('Không tìm thấy giải');
    const stage = opts.stage ?? 'group';
    if (stage === 'knockout' && !opts.startAt) throw unprocessable('Vòng loại trực tiếp: hãy chọn ngày giờ bắt đầu');
    const now = opts.now ?? new Date();
    const startAt = new Date(opts.startAt ?? t.starts_at);
    if (startAt.getTime() < now.getTime() - 60_000) {
      throw unprocessable(opts.startAt ? 'Giờ bắt đầu đã qua' : 'Giờ khai mạc đã qua — hãy chọn giờ bắt đầu');
    }
    const courts = opts.courts ?? t.courts;
    const slotMinutes = opts.slotMinutes ?? t.slot_minutes;

    const PLAYERS = `ea.player1_athlete_id AS a1a, ea.player1_user_id AS a1u, ea.player1_name AS a1n,
                     ea.player2_athlete_id AS a2a, ea.player2_user_id AS a2u, ea.player2_name AS a2n,
                     eb.player1_athlete_id AS b1a, eb.player1_user_id AS b1u, eb.player1_name AS b1n,
                     eb.player2_athlete_id AS b2a, eb.player2_user_id AS b2u, eb.player2_name AS b2n`;
    const people = (r) => [participantKey(r.a1a, r.a1u, r.a1n), participantKey(r.a2a, r.a2u, r.a2n),
      participantKey(r.b1a, r.b1u, r.b1n), participantKey(r.b2a, r.b2u, r.b2n)].filter(Boolean);

    const { rows } = await c.query(
      `SELECT m.id, m.round, m.position, g.sort_order AS group_order, ${PLAYERS}
         FROM matches m
         LEFT JOIN entries ea ON ea.id = m.entry_a_id
         LEFT JOIN entries eb ON eb.id = m.entry_b_id
         LEFT JOIN groups g ON g.id = m.group_id
        WHERE m.tournament_id = $1 AND m.stage = $2 AND m.status IN ('pending', 'scheduled') AND m.games = '[]'::jsonb
          AND m.called_at IS NULL
          AND ($2 = 'knockout' OR (m.entry_a_id IS NOT NULL AND m.entry_b_id IS NOT NULL))
        FOR UPDATE OF m`,
      [tid, stage],
    );
    if (!rows.length) throw unprocessable(stage === 'group' ? 'Không còn trận vòng bảng nào cần xếp' : 'Chưa có trận loại trực tiếp nào cần xếp');

    /** @type {Map<string, string[]>} */
    const feeders = new Map();
    if (stage === 'knockout') {
      const { rows: ko } = await c.query(
        `SELECT id, next_match_id FROM matches WHERE tournament_id = $1 AND stage = 'knockout' AND next_match_id IS NOT NULL`, [tid],
      );
      for (const k of ko) feeders.set(k.next_match_id, [...(feeders.get(k.next_match_id) ?? []), k.id]);
    }

    // Trận đang đánh: nếu lịch mới bắt đầu trước khi trận đó kịp xong (1 khung), chặn sân & VĐV của nó ở khung đầu.
    const blocked = { courts: /** @type {number[]} */ ([]), participants: /** @type {string[]} */ ([]) };
    if (startAt.getTime() < now.getTime() + slotMinutes * 60_000) {
      const { rows: live } = await c.query(
        `SELECT m.court, ${PLAYERS} FROM matches m
           LEFT JOIN entries ea ON ea.id = m.entry_a_id LEFT JOIN entries eb ON eb.id = m.entry_b_id
          WHERE m.tournament_id = $1 AND (m.status = 'live' OR (m.called_at IS NOT NULL AND m.status IN ('pending', 'scheduled')))`, [tid],
      );
      for (const r of live) {
        if (r.court) blocked.courts.push(r.court);
        blocked.participants.push(...people(r));
      }
    }

    const input = rows.map((r) => ({
      id: r.id,
      participants: people(r),
      after: feeders.get(r.id) ?? [],
      // Vòng bảng: xen kẽ các nội dung/bảng theo lượt. Nhánh: theo vòng rồi vị trí (các nội dung đan xen).
      priority: stage === 'group' ? r.round * 10_000 + (r.group_order ?? 0) * 100 + r.position : r.round * 10_000 + r.position,
    }));
    let slots;
    try {
      slots = scheduleMatches(input, { courts, startAt, slotMinutes, blocked });
    } catch (err) {
      if (err instanceof RangeError) throw unprocessable(err.message);
      throw err;
    }
    for (const s of slots) {
      await c.query(
        `UPDATE matches SET court = $2, scheduled_at = $3, status = 'scheduled', version = version + 1, updated_at = now()
         WHERE id = $1`,
        [s.id, s.court, s.startsAt.toISOString()],
      );
    }
    const last = slots.reduce((mx, s) => Math.max(mx, s.slot), -1);
    const result = {
      stage,
      scheduled: slots.length,
      courts,
      slotMinutes,
      startsAt: startAt.toISOString(),
      endsAt: new Date(startAt.getTime() + (last + 1) * slotMinutes * 60_000).toISOString(),
      // Lượt VĐV phải đánh 2 khung giờ liền nhau (không được nghỉ) trong lịch vừa xếp.
      noRest: countNoRest(input, slots),
    };
    await logEvent(c, tid, null, viewer.id, 'schedule', result);
    return result;
  });
}

// ───────────────────────────── BXH & loại trực tiếp ─────────────────────────────

/**
 * BXH từng bảng của một nội dung.
 * @param {Queryable} db @param {string} categoryId
 */
async function groupStandings(db, categoryId) {
  const { rows: groups } = await db.query(
    'SELECT id, name FROM groups WHERE category_id = $1 ORDER BY sort_order', [categoryId],
  );
  const { rows: members } = await db.query(
    `SELECT gm.group_id, e.* FROM group_members gm JOIN entries e ON e.id = gm.entry_id
      JOIN groups g ON g.id = gm.group_id WHERE g.category_id = $1`, [categoryId],
  );
  const { rows: matches } = await db.query(
    `SELECT group_id, entry_a_id, entry_b_id, winner_entry_id, games, status FROM matches
      WHERE category_id = $1 AND stage = 'group'`, [categoryId],
  );
  return groups.map((g) => {
    const mem = members.filter((m) => m.group_id === g.id);
    const active = mem.filter((e) => !e.disqualified_at);
    // Trận bị huỷ do truất quyền không tính (theo BWF: xoá mọi kết quả của đội bị truất quyền).
    const ms = matches.filter((m) => m.group_id === g.id && m.status !== 'cancelled');
    const finished = ms.filter((m) => m.status === 'finished' || m.status === 'walkover').map((m) => ({
      a: m.entry_a_id,
      b: m.entry_b_id,
      winner: /** @type {'a'|'b'} */ (m.winner_entry_id === m.entry_a_id ? 'a' : 'b'),
      games: m.games,
      walkover: m.status === 'walkover',
    }));
    // Phá hoà cuối cùng: bốc thăm phụ (lot nhỏ xếp trên) — giải mở rộng không dùng ELO.
    const tiebreak = Object.fromEntries(active.map((e) => [e.id, -(e.draw_lot ?? 1e6)]));
    const byId = new Map(mem.map((e) => [e.id, e]));
    const rows = computeStandings(active.map((e) => e.id), finished, tiebreak).map((r) => ({
      ...r, name: entryLabel(byId.get(r.entryId)), club: byId.get(r.entryId)?.club ?? '', disqualified: false, dqReason: null,
      players: entryPlayers(byId.get(r.entryId)),
    }));
    const dq = mem.filter((e) => e.disqualified_at).map((e) => ({
      entryId: e.id, rank: null, played: 0, won: 0, lost: 0, gamesFor: 0, gamesAgainst: 0, pointsFor: 0, pointsAgainst: 0,
      name: entryLabel(e), club: e.club ?? '', disqualified: true, dqReason: e.dq_reason, players: entryPlayers(e),
    }));
    return { groupId: g.id, name: g.name, complete: finished.length === ms.length, standings: [...rows, ...dq] };
  });
}

/**
 * Sinh nhánh loại trực tiếp khi vòng bảng đã xong hết.
 * @param {Pool} pool @param {Viewer} viewer @param {string} categoryId
 */
async function generateKnockout(pool, viewer, categoryId) {
  return withTx(pool, async (c) => {
    const cat = await loadCategory(c, categoryId, true);
    await requireOrganizer(c, cat.tournament_id, viewer);
    if (cat.stage !== 'groups') throw conflict('WRONG_STAGE', 'Chỉ tạo nhánh khi đang ở vòng bảng');
    const standings = await groupStandings(c, categoryId);
    const pending = standings.filter((g) => !g.complete).map((g) => g.name);
    if (pending.length) throw conflict('GROUPS_NOT_FINISHED', `Bảng ${pending.join(', ')} chưa đánh xong`);
    const seeds = seedsFromGroups(
      standings.map((g) => g.standings.filter((r) => !r.disqualified).map((r) => r.entryId)), cat.advance_per_group,
    );
    if (seeds.length < 2) throw conflict('NOT_ENOUGH_QUALIFIERS', 'Cần ít nhất 2 đội vào vòng loại trực tiếp');
    const bracket = buildBracket(seeds);
    const totalRounds = Math.max(...bracket.map((b) => b.round));

    // Chèn từ chung kết ngược về vòng 1 để có sẵn id trận kế tiếp.
    /** @type {Map<string, string>} */
    const idOf = new Map();
    const ordered = [...bracket].sort((x, y) => y.round - x.round || x.position - y.position);
    for (const b of ordered) {
      const nextId = b.next ? idOf.get(`${b.next.round}:${b.next.position}`) : null;
      const isBye = b.bye;
      const winner = isBye ? (b.a ?? b.b) : null;
      const { rows } = await c.query(
        `INSERT INTO matches (tournament_id, category_id, stage, round, position, entry_a_id, entry_b_id,
                              status, winner_entry_id, next_match_id, next_slot, finished_at)
         VALUES ($1, $2, 'knockout', $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [cat.tournament_id, categoryId, b.round, b.position, b.a, b.b, isBye ? 'bye' : 'pending', winner,
          nextId ?? null, b.next ? b.next.slot : null, isBye ? new Date().toISOString() : null],
      );
      idOf.set(`${b.round}:${b.position}`, rows[0].id);
    }
    // Đưa đội được miễn đấu (bye) vào vòng sau.
    for (const b of bracket.filter((x) => x.bye && x.next)) {
      const nextId = idOf.get(`${b.next.round}:${b.next.position}`);
      await c.query(
        `UPDATE matches SET ${b.next.slot === 'a' ? 'entry_a_id' : 'entry_b_id'} = $2, version = version + 1 WHERE id = $1`,
        [nextId, b.a ?? b.b],
      );
    }
    await c.query(`UPDATE categories SET stage = 'knockout' WHERE id = $1`, [categoryId]);
    return { qualifiers: seeds.length, rounds: totalRounds, matches: bracket.length };
  });
}

// ───────────────────────────── Nhập điểm (trọng tài) ─────────────────────────────

/**
 * Xử thắng bỏ cuộc (walkover) cho bên kia rồi đưa đội thắng đi tiếp.
 * @param {Queryable} c @param {any} m @param {string} winnerId @param {string} actorId
 */
async function walkoverTo(c, m, winnerId, actorId) {
  await c.query(
    `UPDATE matches SET status = 'walkover', winner_entry_id = $2, finished_at = now(), version = version + 1, updated_at = now()
      WHERE id = $1`, [m.id, winnerId],
  );
  await c.query(
    `INSERT INTO match_score_events (match_id, actor_user_id, action, games) VALUES ($1, $2, 'walkover', $3::jsonb)`,
    [m.id, actorId, JSON.stringify(m.games ?? [])],
  );
  await advanceWinner(c, m, winnerId, actorId);
}

/**
 * Đưa đội thắng vào trận kế tiếp của nhánh. Nếu đối thủ ở trận đó đã bị truất quyền → tự xử walkover.
 * @param {Queryable} c @param {any} m  trận vừa kết thúc @param {string} winnerId @param {string} actorId
 */
async function advanceWinner(c, m, winnerId, actorId) {
  if (m.stage !== 'knockout') return;
  if (!m.next_match_id) {
    await c.query(`UPDATE categories SET stage = 'completed' WHERE id = $1`, [m.category_id]);
    return;
  }
  const col = m.next_slot === 'a' ? 'entry_a_id' : 'entry_b_id';
  const { rows } = await c.query(
    `UPDATE matches SET ${col} = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
    [m.next_match_id, winnerId],
  );
  const next = rows[0];
  if (!next?.entry_a_id || !next?.entry_b_id || FINAL_STATUSES.has(next.status)) return;
  const { rows: dq } = await c.query(
    'SELECT id FROM entries WHERE id IN ($1, $2) AND disqualified_at IS NOT NULL', [next.entry_a_id, next.entry_b_id],
  );
  if (dq.length === 1) {
    await walkoverTo(c, next, dq[0].id === next.entry_a_id ? next.entry_b_id : next.entry_a_id, actorId);
  }
}

/**
 * Khoá trận để NHẬP ĐIỂM (lưu tỉ số / biên bản) + kiểm tra quyền và trạng thái chung:
 * trọng tài được phân công (trận hoặc sân) hoặc BTC; giải chưa kết thúc; trận đủ 2 đội, chưa huỷ, chưa xong.
 * @param {Queryable} c @param {string} matchId @param {Viewer} viewer
 * @param {{ requireStarted?: boolean }} [opts]
 */
async function lockScorable(c, matchId, viewer, opts = {}) {
  const { rows } = await c.query(
    `SELECT m.*, cat.points_to_win, cat.max_points, cat.games_to_win, cat.round_rules, cat.is_doubles, t.status AS tournament_status,
            (SELECT max(k.round) FROM matches k WHERE k.category_id = m.category_id AND k.stage = 'knockout') AS ko_rounds
       FROM matches m JOIN categories cat ON cat.id = m.category_id JOIN tournaments t ON t.id = m.tournament_id
      WHERE m.id = $1 FOR UPDATE OF m`,
    [matchId],
  );
  const m = rows[0];
  if (!m) throw notFound('Không tìm thấy trận');
  const role = await roleIn(c, m.tournament_id, viewer);
  if (!role) throw forbidden();
  if (role === 'referee') {
    // Trọng tài hiệu lực: gán riêng cho trận, nếu không thì trọng tài phụ trách sân của trận.
    let assigned = m.referee_user_id;
    if (!assigned && m.court) {
      const cr = await c.query('SELECT user_id FROM court_referees WHERE tournament_id = $1 AND court = $2', [m.tournament_id, m.court]);
      assigned = cr.rows[0]?.user_id ?? null;
    }
    if (assigned && assigned !== viewer.id) throw forbidden('Trận này đã phân công cho trọng tài khác');
  }
  if (m.tournament_status === 'completed') throw conflict('TOURNAMENT_CLOSED', 'Giải đã kết thúc');
  if (m.tournament_status === 'draft' && role === 'referee') throw forbidden('Giải chưa công bố');
  if (!m.entry_a_id || !m.entry_b_id) throw conflict('MISSING_ENTRY', 'Trận chưa đủ 2 đội');
  if (m.status === 'cancelled') throw conflict('MATCH_CANCELLED', 'Trận đã bị huỷ do có đội bị truất quyền');
  if (FINAL_STATUSES.has(m.status)) throw conflict('MATCH_CLOSED', 'Trận đã kết thúc');
  if (opts.requireStarted !== false && m.status !== 'live') {
    throw conflict('MATCH_NOT_STARTED', 'Bấm Bắt đầu trận trước khi nhập điểm');
  }
  return { m, role, rules: effectiveRules(m, m.stage, m.round, m.ko_rounds) };
}

/**
 * Nhận sân và bắt đầu trận; cùng khoá theo giải với gọi / chuyển sân để không nhận trùng.
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId @param {{ version: number }} input
 */
async function startMatch(pool, viewer, matchId, input) {
  return withTx(pool, async (c) => {
    const { m, role } = await lockScorable(c, matchId, viewer, { requireStarted: false });
    if (input.version !== m.version) {
      throw conflict('VERSION_CONFLICT', 'Trận vừa được cập nhật — tải lại trước khi bắt đầu');
    }
    if (m.status === 'live') throw conflict('MATCH_ALREADY_STARTED', 'Trận đã bắt đầu');
    const t = (await c.query('SELECT status FROM tournaments WHERE id = $1 FOR UPDATE', [m.tournament_id])).rows[0];
    if (t.status === 'completed') throw conflict('TOURNAMENT_CLOSED', 'Giải đã kết thúc');
    if (t.status === 'draft' && role === 'referee') throw forbidden('Giải chưa công bố');
    if (!m.court) throw conflict('COURT_REQUIRED', 'Trận chưa có sân — liên hệ BTC để gán sân');
    // Nạp muộn vì courtService dùng các tiện ích giao dịch và quyền từ tệp này.
    const courts = require('./courtService');
    const occupancy = await courts.lockMatch(c, matchId);
    courts.checkCourt(m.court, occupancy.t_courts);
    await courts.assertCourtFree(c, m.tournament_id, m.court, m.id);
    await courts.assertPlayersFree(c, occupancy);
    const { rows } = await c.query(
      `UPDATE matches SET status = 'live', called_at = COALESCE(called_at, now()),
              referee_user_id = COALESCE(referee_user_id, $2), version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [m.id, role === 'referee' ? viewer.id : null],
    );
    await c.query('INSERT INTO match_score_events (match_id, actor_user_id, action, games) VALUES ($1, $2, $3, $4::jsonb)',
      [m.id, viewer.id, 'start', JSON.stringify(m.games)]);
    await logEvent(c, m.tournament_id, m.category_id, viewer.id, 'start_match', { matchId, court: m.court });
    if (t.status === 'published') await c.query("UPDATE tournaments SET status = 'ongoing' WHERE id = $1", [m.tournament_id]);
    return rows[0];
  });
}

/**
 * Trọng tài/BTC lưu tỉ số, kết thúc trận hoặc xử thắng do bỏ cuộc.
 * Dùng optimistic locking: client gửi `version` đã đọc; lệch → 409 kèm trạng thái mới nhất.
 * Trận có biên bản (match_rallies) mà tỉ số gửi lên khác biên bản → ghi mốc "BTC sửa tay" (override) vào biên bản.
 *
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId
 * @param {{ action: 'save'|'finish'|'walkover', version: number, games?: [number, number][], walkoverWinner?: 'a'|'b' }} input
 */
async function recordScore(pool, viewer, matchId, input) {
  return withTx(pool, async (c) => {
    const { m, role, rules } = await lockScorable(c, matchId, viewer, { requireStarted: input.action !== 'walkover' });
    if (input.version !== m.version) {
      throw conflict('VERSION_CONFLICT', 'Tỉ số vừa được cập nhật ở thiết bị khác — đã tải lại bản mới nhất',
        { current: { games: m.games, version: m.version, status: m.status } });
    }

    const games = input.games ?? m.games;
    /** @type {string} */ let status;
    /** @type {string|null} */ let winnerId = null;

    if (input.action === 'walkover') {
      if (input.walkoverWinner !== 'a' && input.walkoverWinner !== 'b') throw unprocessable('Chọn bên thắng do bỏ cuộc');
      winnerId = input.walkoverWinner === 'a' ? m.entry_a_id : m.entry_b_id;
      status = 'walkover';
    } else {
      const ev = evaluateMatch(games, rules);
      if (!ev.valid) throw unprocessable(ev.error ?? 'Tỉ số không hợp lệ');
      if (input.action === 'finish') {
        if (!ev.complete) throw unprocessable('Trận chưa đủ số game thắng để kết thúc');
        winnerId = ev.winner === 'a' ? m.entry_a_id : m.entry_b_id;
        status = 'finished';
      } else {
        status = 'live';
      }
    }

    if (input.action !== 'walkover' && JSON.stringify(games) !== JSON.stringify(m.games)) {
      await rallies.recordOverride(c, matchId, games, viewer.id);
    }
    const { rows: upd } = await c.query(
      `UPDATE matches SET games = $2::jsonb, status = $3, winner_entry_id = $4,
              referee_user_id = COALESCE(referee_user_id, $5),
              finished_at = CASE WHEN $4::uuid IS NULL THEN NULL ELSE now() END,
              version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [matchId, JSON.stringify(games), status, winnerId, role === 'referee' ? viewer.id : null],
    );
    await c.query(
      'INSERT INTO match_score_events (match_id, actor_user_id, action, games) VALUES ($1, $2, $3, $4::jsonb)',
      [matchId, viewer.id, input.action, JSON.stringify(games)],
    );
    if (m.tournament_status === 'published') {
      await c.query(`UPDATE tournaments SET status = 'ongoing' WHERE id = $1`, [m.tournament_id]);
    }
    if (winnerId) {
      await logEvent(c, m.tournament_id, m.category_id, viewer.id, 'score_confirm',
        { matchId, games: input.action === 'walkover' ? null : games, walkover: input.action === 'walkover', winner: winnerId === m.entry_a_id ? 'a' : 'b' });
      await advanceWinner(c, m, winnerId, viewer.id);
    }
    return upd[0];
  });
}

/**
 * BTC mở lại trận đã kết thúc để sửa tỉ số — chỉ khi trận kế tiếp chưa bắt đầu.
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId
 */
async function reopenMatch(pool, viewer, matchId) {
  return withTx(pool, async (c) => {
    const courts = require('./courtService');
    const m = (await c.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [matchId])).rows[0];
    if (!m) throw notFound('Không tìm thấy trận');
    await requireOrganizer(c, m.tournament_id, viewer);
    if (m.status !== 'finished' && m.status !== 'walkover') throw conflict('NOT_FINISHED', 'Trận chưa kết thúc');
    // Phục hồi cũng là nhận sân/VĐV: dùng cùng khoá với gọi sân và bắt đầu trận.
    await c.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [m.tournament_id]);
    if (m.stage === 'group') {
      const cat = await loadCategory(c, m.category_id, true);
      if (cat.stage !== 'groups') throw conflict('KNOCKOUT_STARTED', 'Đã tạo nhánh loại trực tiếp, không thể sửa vòng bảng');
    }
    if (m.next_match_id) {
      const n = (await c.query('SELECT status, games FROM matches WHERE id = $1 FOR UPDATE', [m.next_match_id])).rows[0];
      if (!['pending', 'scheduled'].includes(n.status) || n.games.length > 0) {
        throw conflict('NEXT_STARTED', 'Trận vòng sau đã bắt đầu, không thể mở lại');
      }
      const col = m.next_slot === 'a' ? 'entry_a_id' : 'entry_b_id';
      await c.query(`UPDATE matches SET ${col} = NULL, version = version + 1 WHERE id = $1`, [m.next_match_id]);
    } else if (m.stage === 'knockout') {
      await c.query(`UPDATE categories SET stage = 'knockout' WHERE id = $1`, [m.category_id]);
    }
    if (m.court !== null) await courts.assertCourtFree(c, m.tournament_id, m.court, m.id);
    await courts.assertPlayersFree(c, await courts.lockMatch(c, m.id));
    const { rows } = await c.query(
      `UPDATE matches SET status = 'live', winner_entry_id = NULL, finished_at = NULL, version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`, [matchId],
    );
    await c.query(
      `INSERT INTO match_score_events (match_id, actor_user_id, action, games) VALUES ($1, $2, 'reopen', $3::jsonb)`,
      [matchId, viewer.id, JSON.stringify(m.games)],
    );
    return rows[0];
  });
}

/**
 * Phân công trọng tài cho trận (null = bỏ phân công).
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId @param {string|null} refereeUserId
 */
async function assignReferee(pool, viewer, matchId, refereeUserId) {
  return withTx(pool, async (c) => {
    const m = (await c.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [matchId])).rows[0];
    if (!m) throw notFound('Không tìm thấy trận');
    await requireOrganizer(c, m.tournament_id, viewer);
    if (refereeUserId) {
      const r = await c.query(
        `SELECT 1 FROM tournament_staff WHERE tournament_id = $1 AND user_id = $2`, [m.tournament_id, refereeUserId],
      );
      if (!r.rows[0]) throw unprocessable('Người này chưa là trọng tài/BTC của giải');
    }
    const { rows } = await c.query(
      `UPDATE matches SET referee_user_id = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
      [matchId, refereeUserId],
    );
    await c.query(
      `INSERT INTO match_score_events (match_id, actor_user_id, action, games) VALUES ($1, $2, 'assign_referee', $3::jsonb)`,
      [matchId, viewer.id, JSON.stringify(m.games)],
    );
    return rows[0];
  });
}

// ───────────────────────────── Điều hành: truất quyền, đổi bảng, sửa đội ─────────────────────────────

/** @param {Queryable} c @param {string} entryId */
async function loadEntryForUpdate(c, entryId) {
  const { rows } = await c.query(
    `SELECT e.*, c.tournament_id, c.stage, c.is_doubles, c.id AS cat_id
       FROM entries e JOIN categories c ON c.id = e.category_id WHERE e.id = $1 FOR UPDATE OF e, c`,
    [entryId],
  );
  if (!rows[0]) throw notFound('Không tìm thấy đội');
  return rows[0];
}

/**
 * Truất quyền thi đấu.
 *  - Vòng bảng: huỷ MỌI trận vòng bảng của đội (kể cả đã đánh) — BXH tính như đội chưa từng tham gia (BWF).
 *  - Loại trực tiếp: trận đang chờ của đội → xử walkover cho đối thủ; nếu chưa biết đối thủ, tự xử khi đối thủ tới.
 * @param {Pool} pool @param {Viewer} viewer @param {string} entryId @param {string} reason
 */
async function disqualifyEntry(pool, viewer, entryId, reason) {
  return withTx(pool, async (c) => {
    const e = await loadEntryForUpdate(c, entryId);
    await requireOrganizer(c, e.tournament_id, viewer);
    if (e.disqualified_at) throw conflict('ALREADY_DISQUALIFIED', 'Đội này đã bị truất quyền');
    if (e.stage === 'setup') throw conflict('NOT_DRAWN', 'Chưa bốc thăm — hãy xoá đội khỏi danh sách thay vì truất quyền');
    if (e.stage === 'completed') throw conflict('CATEGORY_COMPLETED', 'Nội dung đã kết thúc');
    await c.query('UPDATE entries SET disqualified_at = now(), dq_reason = $2 WHERE id = $1', [entryId, reason]);
    let cancelled = 0;
    let walkover = null;
    if (e.stage === 'groups') {
      cancelled = await cancelDisqualifiedGroupMatches(c, e.cat_id, entryId);
    } else {
      const { rows } = await c.query(
        `SELECT * FROM matches WHERE category_id = $1 AND stage = 'knockout' AND status IN ('pending', 'scheduled', 'live')
            AND $2 IN (entry_a_id, entry_b_id) FOR UPDATE`, [e.cat_id, entryId],
      );
      const m = rows[0];
      if (m && m.entry_a_id && m.entry_b_id) {
        const other = m.entry_a_id === entryId ? m.entry_b_id : m.entry_a_id;
        await walkoverTo(c, m, other, viewer.id);
        walkover = m.id;
      }
    }
    await logEvent(c, e.tournament_id, e.cat_id, viewer.id, 'disqualify', {
      entryId, name: entryLabel(e), reason, cancelledMatches: cancelled, walkoverMatchId: walkover,
    });
    return { entryId, cancelledMatches: cancelled, walkoverMatchId: walkover };
  });
}

/**
 * Huỷ truất quyền — chỉ khi chưa tạo nhánh. Khôi phục các trận vòng bảng đã huỷ (trừ trận gặp đội khác cũng bị truất quyền).
 * @param {Pool} pool @param {Viewer} viewer @param {string} entryId
 */
async function reinstateEntry(pool, viewer, entryId) {
  return withTx(pool, async (c) => {
    const courts = require('./courtService');
    const e = await loadEntryForUpdate(c, entryId);
    await requireOrganizer(c, e.tournament_id, viewer);
    if (!e.disqualified_at) throw conflict('NOT_DISQUALIFIED', 'Đội này không bị truất quyền');
    if (e.stage !== 'groups') throw conflict('KNOCKOUT_STARTED', 'Chỉ huỷ truất quyền được khi chưa tạo nhánh loại trực tiếp');
    await c.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [e.tournament_id]);
    await c.query('UPDATE entries SET disqualified_at = NULL, dq_reason = NULL WHERE id = $1', [entryId]);
    const { rows, rowCount } = await c.query(
      `UPDATE matches m SET
          status = m.pre_cancel->>'status',
          winner_entry_id = (m.pre_cancel->>'winner')::uuid,
          court = (m.pre_cancel->>'court')::int,
          scheduled_at = (m.pre_cancel->>'scheduled_at')::timestamptz,
          finished_at = (m.pre_cancel->>'finished_at')::timestamptz,
          pre_cancel = NULL, version = version + 1, updated_at = now()
        WHERE m.category_id = $1 AND m.stage = 'group' AND m.status = 'cancelled' AND m.pre_cancel IS NOT NULL
          AND $2 IN (m.entry_a_id, m.entry_b_id)
          AND NOT EXISTS (SELECT 1 FROM entries o WHERE o.id IN (m.entry_a_id, m.entry_b_id) AND o.disqualified_at IS NOT NULL)
        RETURNING m.id, m.status, m.called_at`,
      [e.cat_id, entryId],
    );
    // Kiểm tra sau phục hồi để thấy cả xung đột giữa các trận trong cùng đợt;
    // lỗi sẽ hoàn tác toàn bộ giao dịch, gồm cả trạng thái truất quyền.
    for (const restored of rows) {
      if (restored.status !== 'live' && !(restored.called_at && ['pending', 'scheduled'].includes(restored.status))) continue;
      const m = await courts.lockMatch(c, restored.id);
      if (m.court !== null) await courts.assertCourtFree(c, m.tournament_id, m.court, m.id);
      await courts.assertPlayersFree(c, m);
    }
    await logEvent(c, e.tournament_id, e.cat_id, viewer.id, 'reinstate', { entryId, name: entryLabel(e), restoredMatches: rowCount ?? 0 });
    return { entryId, restoredMatches: rowCount ?? 0 };
  });
}

/**
 * Đổi chỗ 2 đội ở 2 bảng khác nhau rồi sinh lại lịch vòng tròn của 2 bảng đó.
 * Chỉ khi cả 2 bảng chưa có trận nào bắt đầu.
 * @param {Pool} pool @param {Viewer} viewer @param {string} categoryId @param {string} entryA @param {string} entryB
 */
async function swapEntries(pool, viewer, categoryId, entryA, entryB) {
  return withTx(pool, async (c) => {
    const cat = await loadCategory(c, categoryId, true);
    await requireOrganizer(c, cat.tournament_id, viewer);
    if (cat.stage !== 'groups') throw conflict('WRONG_STAGE', 'Chỉ đổi bảng được ở giai đoạn vòng bảng');
    if (entryA === entryB) throw unprocessable('Chọn 2 đội khác nhau');
    const { rows } = await c.query(
      `SELECT gm.entry_id, gm.group_id, g.name AS group_name, e.disqualified_at, e.player1_name, e.player2_name
         FROM group_members gm JOIN groups g ON g.id = gm.group_id JOIN entries e ON e.id = gm.entry_id
        WHERE g.category_id = $1 AND gm.entry_id IN ($2, $3)`,
      [categoryId, entryA, entryB],
    );
    if (rows.length !== 2) throw notFound('Không tìm thấy đội trong nội dung này');
    const [x, y] = rows;
    if (x.group_id === y.group_id) throw unprocessable('Hai đội đang cùng bảng');
    if (x.disqualified_at || y.disqualified_at) throw unprocessable('Không đổi bảng đội đã bị truất quyền');
    const started = await c.query(
      `SELECT 1 FROM matches WHERE group_id IN ($1, $2) AND ${STARTED_SQL} LIMIT 1`, [x.group_id, y.group_id],
    );
    if (started.rows[0]) throw conflict('GROUPS_STARTED', `Bảng ${x.group_name} hoặc ${y.group_name} đã có trận bắt đầu`);

    await c.query(
      `UPDATE group_members SET group_id = CASE WHEN entry_id = $1 THEN $4::uuid ELSE $3::uuid END WHERE entry_id IN ($1, $2)`,
      [x.entry_id, y.entry_id, x.group_id, y.group_id],
    );
    await c.query('DELETE FROM matches WHERE group_id IN ($1, $2)', [x.group_id, y.group_id]);
    for (const gid of [x.group_id, y.group_id]) {
      const { rows: mem } = await c.query(
        `SELECT e.id FROM group_members gm JOIN entries e ON e.id = gm.entry_id WHERE gm.group_id = $1
          ORDER BY e.draw_lot NULLS LAST, e.id`, [gid],
      );
      await insertRoundRobin(c, cat, gid, mem.map((m) => m.id));
    }
    await cancelDisqualifiedGroupMatches(c, categoryId);
    await logEvent(c, cat.tournament_id, categoryId, viewer.id, 'swap', {
      a: { entryId: x.entry_id, name: entryLabel(x), from: x.group_name, to: y.group_name },
      b: { entryId: y.entry_id, name: entryLabel(y), from: y.group_name, to: x.group_name },
    });
    return { swapped: [x.entry_id, y.entry_id], groups: [x.group_name, y.group_name] };
  });
}

/**
 * Sửa đội: thay VĐV / đồng đội / CLB. Sau khi bốc thăm chỉ được sửa khi đội chưa đánh trận nào.
 * Mỗi hồ sơ VĐV chỉ thuộc một đội trong cùng nội dung; vẫn được tham gia nhiều nội dung.
 * @param {Pool} pool @param {Viewer} viewer @param {string} entryId
 * @param {{ player1Name: string, player2Name?: string|null, club?: string }} input
 */
async function updateEntry(pool, viewer, entryId, input) {
  return withTx(pool, async (c) => {
    const e = await loadEntryForUpdate(c, entryId);
    await requireOrganizer(c, e.tournament_id, viewer);
    if (e.is_doubles !== Boolean(input.player2Name)) {
      throw unprocessable(`Nội dung ${e.is_doubles ? 'đôi cần 2' : 'đơn chỉ cần 1'} VĐV`);
    }
    if (e.stage !== 'setup') {
      const started = await c.query(
        `SELECT 1 FROM matches WHERE $1 IN (entry_a_id, entry_b_id) AND status <> 'cancelled' AND ${STARTED_SQL} LIMIT 1`, [entryId],
      );
      if (started.rows[0]) throw conflict('ENTRY_STARTED', 'Đội đã thi đấu, không thể thay VĐV');
    }
    // Đổi người → gắn lại hồ sơ (theo tên; muốn chắc chắn thì sửa MSSV/SĐT ở trang Vận động viên).
    // eslint-disable-next-line global-require -- nạp muộn, tránh require vòng
    const { resolveAthlete, nameKeyOf } = require('./athleteService');
    const relink = async (newName, oldName, oldId) => (oldId && newName && nameKeyOf(newName) === nameKeyOf(oldName ?? '')
      ? oldId : newName ? (await resolveAthlete(c, e.tournament_id, { name: newName, club: input.club ?? e.club })).id : null);
    const a1 = await relink(input.player1Name, e.player1_name, e.player1_athlete_id);
    const a2 = await relink(input.player2Name ?? null, e.player2_name, e.player2_athlete_id);
    if (a1 && a1 === a2) throw unprocessable('Hai VĐV của đội là cùng một người');
    // Nội dung đã được khoá ở loadEntryForUpdate; loại trừ chính đội đang sửa để cho phép đảo thành viên.
    const { rows: duplicates } = await c.query(
      `SELECT a.full_name FROM entries other
         JOIN athletes a ON a.id IN (other.player1_athlete_id, other.player2_athlete_id)
        WHERE other.category_id = $1 AND other.id <> $2 AND a.id = ANY($3::uuid[])
        LIMIT 1`,
      [e.cat_id, entryId, [a1, a2].filter(Boolean)],
    );
    if (duplicates[0]) throw conflict('ATHLETE_ALREADY_ENTERED', `${duplicates[0].full_name} đã đăng ký trong đội khác của nội dung này`);
    const { rows } = await c.query(
      `UPDATE entries SET player1_name = $2, player2_name = $3, club = $4, player1_athlete_id = $5, player2_athlete_id = $6
        WHERE id = $1 RETURNING *`,
      [entryId, input.player1Name, input.player2Name ?? null, input.club ?? e.club, a1, a2],
    );
    await logEvent(c, e.tournament_id, e.cat_id, viewer.id, 'edit_entry', {
      entryId, before: { name: entryLabel(e), club: e.club }, after: { name: entryLabel(rows[0]), club: rows[0].club },
    });
    return { ...rows[0], name: entryLabel(rows[0]) };
  });
}

/**
 * Nhật ký thao tác BTC (mới nhất trước).
 * @param {Queryable} db @param {Viewer} viewer @param {string} tid
 */
async function listEvents(db, viewer, tid) {
  await requireOrganizer(db, tid, viewer);
  const { rows } = await db.query(
    `SELECT ev.id::text AS id, ev.action, ev.details, ev.created_at, u.full_name AS actor, c.code AS category_code
       FROM tournament_events ev JOIN users u ON u.id = ev.actor_user_id LEFT JOIN categories c ON c.id = ev.category_id
      WHERE ev.tournament_id = $1 ORDER BY ev.id DESC LIMIT 100`, [tid],
  );
  return rows;
}

// ───────────────────────────── Đọc (công khai) ─────────────────────────────

const MATCH_SELECT = `
  SELECT m.id, m.tournament_id, m.category_id, cat.code AS category_code, cat.name AS category_name,
         m.stage, g.name AS group_name, m.round, m.position, m.status, m.games, m.court, m.scheduled_at, m.called_at,
         m.version, m.updated_at, m.referee_user_id, ru.full_name AS referee_name,
         m.entry_a_id, m.entry_b_id, m.winner_entry_id,
         ea.player1_name AS a_p1, ea.player2_name AS a_p2, ea.club AS a_club, ea.disqualified_at IS NOT NULL AS a_dq,
         eb.player1_name AS b_p1, eb.player2_name AS b_p2, eb.club AS b_club, eb.disqualified_at IS NOT NULL AS b_dq,
         ea.player1_athlete_id AS a_p1_aid, ea.player2_athlete_id AS a_p2_aid,
         eb.player1_athlete_id AS b_p1_aid, eb.player2_athlete_id AS b_p2_aid,
         cat.points_to_win, cat.max_points, cat.games_to_win, cat.round_rules, mt.status AS tournament_status,
         (SELECT max(k.round) FROM matches k WHERE k.category_id = m.category_id AND k.stage = 'knockout') AS ko_rounds
    FROM matches m
    JOIN categories cat ON cat.id = m.category_id
    JOIN tournaments mt ON mt.id = m.tournament_id
    LEFT JOIN groups g ON g.id = m.group_id
    LEFT JOIN entries ea ON ea.id = m.entry_a_id
    LEFT JOIN entries eb ON eb.id = m.entry_b_id
    LEFT JOIN users ru ON ru.id = m.referee_user_id`;

/**
 * Từng VĐV của một đội: { athleteId, name }. athleteId (hồ sơ VĐV theo giải) KHÔNG phải dữ liệu cá nhân — chỉ để
 * client phân biệt hai người trùng tên (ô tìm VĐV gom theo người). MSSV/SĐT không bao giờ trả ở đây.
 */
function playersOfEntry(p1, p1Aid, p2, p2Aid) {
  return [p1 ? { athleteId: p1Aid ?? null, name: p1 } : null, p2 ? { athleteId: p2Aid ?? null, name: p2 } : null].filter(Boolean);
}

/** @param {any} e entries row */
const entryPlayers = (e) => (e ? playersOfEntry(e.player1_name, e.player1_athlete_id, e.player2_name, e.player2_athlete_id) : []);

/** Định dạng trận cho client. */
function presentMatch(r) {
  const label = (p1, p2) => (p1 ? (p2 ? `${p1} / ${p2}` : p1) : null);
  return {
    id: r.id,
    tournamentId: r.tournament_id,
    // Giải đã kết thúc ('completed') → Bàn điểm khoá nhập điểm.
    tournamentStatus: r.tournament_status,
    category: { id: r.category_id, code: r.category_code, name: r.category_name },
    stage: r.stage,
    groupName: r.group_name,
    round: r.round,
    roundLabel: r.stage === 'knockout' ? roundLabel(r.round, r.ko_rounds) : `Lượt ${r.round}`,
    position: r.position,
    status: r.status,
    games: r.games,
    court: r.court,
    scheduledAt: r.scheduled_at,
    // Đã gọi vào sân nhưng chưa có điểm (status vẫn pending/scheduled).
    calledAt: ['pending', 'scheduled'].includes(r.status) ? r.called_at ?? null : null,
    // Lúc trận được gọi vào sân (giữ cả khi đang đánh) → BTC biết sân đã chiếm bao lâu.
    courtSince: r.called_at ?? null,
    version: r.version,
    updatedAt: r.updated_at,
    referee: r.referee_user_id ? { id: r.referee_user_id, name: r.referee_name } : null,
    a: r.entry_a_id ? {
      id: r.entry_a_id, name: label(r.a_p1, r.a_p2), club: r.a_club, disqualified: Boolean(r.a_dq),
      players: playersOfEntry(r.a_p1, r.a_p1_aid, r.a_p2, r.a_p2_aid),
    } : null,
    b: r.entry_b_id ? {
      id: r.entry_b_id, name: label(r.b_p1, r.b_p2), club: r.b_club, disqualified: Boolean(r.b_dq),
      players: playersOfEntry(r.b_p1, r.b_p1_aid, r.b_p2, r.b_p2_aid),
    } : null,
    winner: r.winner_entry_id ? (r.winner_entry_id === r.entry_a_id ? 'a' : 'b') : null,
    rules: effectiveRules(r, r.stage, r.round, r.ko_rounds),
  };
}

/**
 * Giải theo slug; giải draft chỉ BTC/admin xem được.
 * @param {Queryable} db @param {string} slug @param {Viewer|null} viewer
 */
async function getTournament(db, slug, viewer) {
  const t = (await db.query('SELECT * FROM tournaments WHERE slug = $1 AND deleted_at IS NULL', [slug])).rows[0];
  if (!t) throw notFound('Không tìm thấy giải');
  const role = await roleIn(db, t.id, viewer);
  if (t.status === 'draft' && role !== 'admin' && role !== 'organizer') throw notFound('Không tìm thấy giải');
  const { rows: categories } = await db.query(
    `SELECT c.*, (SELECT count(*)::int FROM entries e WHERE e.category_id = c.id) AS entry_count
       FROM categories c WHERE tournament_id = $1 ORDER BY code`, [t.id],
  );
  const { deleted_at: _deletedAt, deleted_by: _deletedBy, ...info } = t;
  return { ...info, viewerRole: role, canDelete: canDelete(t, viewer), categories };
}

/** @param {Queryable} db @param {Viewer|null} viewer */
async function listTournaments(db, viewer) {
  const isAdmin = viewer?.role === 'admin';
  // my_role: vai trò của người xem trong giải (BTC / trọng tài), null với khán giả.
  // is_referee: có nhiệm vụ trọng tài (vai trò referee, phụ trách một sân, hoặc được gán riêng một trận)
  //   → thanh điều hướng chỉ hiện mục "Trọng tài" cho những tài khoản này.
  const { rows } = await db.query(
    `SELECT t.id, t.slug, t.name, t.venue, t.starts_at, t.status,
            s.role AS my_role,
            ($2::uuid IS NOT NULL AND (
               s.role = 'referee'
               OR EXISTS (SELECT 1 FROM court_referees cr WHERE cr.tournament_id = t.id AND cr.user_id = $2::uuid)
               OR EXISTS (SELECT 1 FROM matches m WHERE m.tournament_id = t.id AND m.referee_user_id = $2::uuid)
            )) AS is_referee
       FROM tournaments t
       LEFT JOIN tournament_staff s ON s.tournament_id = t.id AND s.user_id = $2::uuid
      WHERE t.deleted_at IS NULL AND (t.status <> 'draft' OR $1::boolean OR s.user_id IS NOT NULL)
      ORDER BY t.starts_at DESC LIMIT 100`,
    [isAdmin, viewer?.id ?? null],
  );
  return rows.map((r) => ({ ...r, my_role: r.my_role ?? null, is_referee: Boolean(r.is_referee) }));
}

/**
 * Danh sách trận của giải (lịch thi đấu), lọc theo sân/trạng thái/nội dung.
 * @param {Queryable} db @param {string} tid
 * @param {{ court?: number, status?: string, categoryId?: string }} [f]
 */
async function listMatches(db, tid, f = {}) {
  const { rows } = await db.query(
    `${MATCH_SELECT}
      WHERE m.tournament_id = $1
        AND ($2::int IS NULL OR m.court = $2) AND ($3::text IS NULL OR m.status = $3)
        AND ($4::uuid IS NULL OR m.category_id = $4)
      ORDER BY m.scheduled_at NULLS LAST, m.court NULLS LAST, cat.code, m.stage, m.round, m.position
      LIMIT 1000`,
    [tid, f.court ?? null, f.status ?? null, f.categoryId ?? null],
  );
  return rows.map(presentMatch);
}

/** @param {Queryable} db @param {string} matchId */
async function getMatch(db, matchId) {
  const { rows } = await db.query(`${MATCH_SELECT} WHERE m.id = $1`, [matchId]);
  if (!rows[0]) throw notFound('Không tìm thấy trận');
  return presentMatch(rows[0]);
}

/**
 * Nhánh loại trực tiếp theo vòng.
 * @param {Queryable} db @param {string} categoryId
 */
async function getBracket(db, categoryId) {
  const { rows } = await db.query(
    `${MATCH_SELECT} WHERE m.category_id = $1 AND m.stage = 'knockout' ORDER BY m.round, m.position`, [categoryId],
  );
  const matches = rows.map(presentMatch);
  const total = matches.reduce((mx, m) => Math.max(mx, m.round), 0);
  const rounds = [];
  for (let r = 1; r <= total; r += 1) {
    rounds.push({ round: r, label: roundLabel(r, total), matches: matches.filter((m) => m.round === r) });
  }
  return { rounds };
}

/**
 * Trận mà trọng tài có thể nhập điểm: được phân công, hoặc chưa phân công trong giải mình làm trọng tài.
 * @param {Queryable} db @param {Viewer} viewer
 */
async function refereeQueue(db, viewer) {
  const { rows } = await db.query(
    `${MATCH_SELECT}
      JOIN tournaments t ON t.id = m.tournament_id
      LEFT JOIN court_referees cr ON cr.tournament_id = m.tournament_id AND cr.court = m.court
     WHERE t.status IN ('published', 'ongoing') AND t.deleted_at IS NULL
       AND m.status IN ('scheduled', 'live', 'pending')
       AND m.entry_a_id IS NOT NULL AND m.entry_b_id IS NOT NULL
       AND (COALESCE(m.referee_user_id, cr.user_id) = $1 OR (COALESCE(m.referee_user_id, cr.user_id) IS NULL AND (
             $2::boolean OR EXISTS (SELECT 1 FROM tournament_staff s WHERE s.tournament_id = m.tournament_id AND s.user_id = $1))))
     -- Trận ở sân mình phụ trách và đang đánh / đã gọi lên đầu.
     ORDER BY (m.status = 'live' OR m.called_at IS NOT NULL) DESC, (cr.user_id = $1) DESC NULLS LAST,
              m.scheduled_at NULLS LAST, m.court
     LIMIT 200`,
    [viewer.id, viewer.role === 'admin'],
  );
  return rows.map(presentMatch);
}

/**
 * Ném 404 nếu giải là draft và viewer không phải BTC/admin (không lộ sự tồn tại).
 * @param {Queryable} db @param {string} tid @param {Viewer|null} viewer
 */
async function assertVisible(db, tid, viewer) {
  const t = (await db.query('SELECT status FROM tournaments WHERE id = $1 AND deleted_at IS NULL', [tid])).rows[0];
  if (!t) throw notFound('Không tìm thấy giải');
  if (t.status !== 'draft') return;
  const role = await roleIn(db, tid, viewer);
  if (role !== 'admin' && role !== 'organizer') throw notFound('Không tìm thấy giải');
}

/** @param {Queryable} db @param {string} categoryId @returns {Promise<string>} tournament id */
async function tournamentOfCategory(db, categoryId) {
  return (await loadCategory(db, categoryId)).tournament_id;
}

/** @param {Queryable} db @param {string} categoryId */
async function listEntries(db, categoryId) {
  const { rows } = await db.query(
    `SELECT e.id, e.player1_name, e.player2_name, e.club, e.draw_lot, e.disqualified_at, e.dq_reason,
            e.player1_athlete_id, e.player2_athlete_id,
            g.id AS group_id, g.name AS group_name,
            EXISTS (SELECT 1 FROM matches m WHERE e.id IN (m.entry_a_id, m.entry_b_id) AND m.status <> 'cancelled'
                      AND (m.status IN ('live', 'finished', 'walkover') OR m.games <> '[]'::jsonb)) AS has_played
       FROM entries e LEFT JOIN group_members gm ON gm.entry_id = e.id LEFT JOIN groups g ON g.id = gm.group_id
      WHERE e.category_id = $1 ORDER BY g.sort_order NULLS LAST, e.draw_lot NULLS LAST, e.created_at, e.player1_name`,
    [categoryId],
  );
  return rows.map((e) => ({ ...e, name: entryLabel(e) }));
}

/** @param {Queryable} db @param {Viewer} viewer @param {string} tid */
async function listStaff(db, viewer, tid) {
  await requireOrganizer(db, tid, viewer);
  const { rows } = await db.query(
    `SELECT s.user_id, s.role, u.full_name FROM tournament_staff s JOIN users u ON u.id = s.user_id
      WHERE s.tournament_id = $1 ORDER BY s.role, u.full_name`, [tid],
  );
  return rows;
}

/**
 * Tìm tài khoản đang hoạt động (để thêm BTC / trọng tài). Chỉ admin hoặc BTC của ít nhất 1 giải.
 * @param {Queryable} db @param {Viewer} viewer @param {string} q
 */
async function searchUsers(db, viewer, q) {
  if (viewer.role !== 'admin') {
    const r = await db.query(`SELECT 1 FROM tournament_staff WHERE user_id = $1 AND role = 'organizer' LIMIT 1`, [viewer.id]);
    if (!r.rows[0]) throw forbidden();
  }
  // Escape ký tự đại diện của LIKE để input người dùng chỉ là chuỗi thường.
  const pattern = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const { rows } = await db.query(
    `SELECT id, username, full_name, role FROM users
      WHERE disabled_at IS NULL AND (full_name ILIKE $1 OR username ILIKE $1) ORDER BY full_name LIMIT 20`, [pattern],
  );
  return rows;
}

module.exports = {
  assertVisible, tournamentOfCategory, listEntries, listStaff, searchUsers, listEvents,
  disqualifyEntry, reinstateEntry, swapEntries, updateEntry,
  withTx, roleIn, requireOrganizer, lockScorable, logEvent, nameKey, participantKey, entryLabel, presentMatch, MATCH_SELECT, FINAL_STATUSES,
  createTournament, updateTournament, deleteTournament, restoreTournament, listDeletedTournaments, purgeDeletedTournaments, upsertStaff, removeStaff, createCategory, updateCategory, deleteCategory,
  addEntries, removeEntry,
  drawGroups, scheduleTournament, groupStandings, generateKnockout,
  startMatch, recordScore, reopenMatch, assignReferee, setRoundRules,
  getTournament, listTournaments, listMatches, getMatch, getBracket, refereeQueue,
};


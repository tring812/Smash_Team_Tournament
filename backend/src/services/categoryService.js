'use strict';
/**
 * Nghiệp vụ NỘI DUNG THI ĐẤU: tạo / sửa / xoá nội dung, luật điểm theo vòng và các kiểm tra khoá luật.
 * Tách từ tournamentService (không đổi hành vi); tournamentService vẫn re-export các hàm ở đây.
 */

const { effectiveRules, buildRoundRules, sameRules, scopeKey, fromEndLabel } = require('../domain/roundRules');
const { notFound, conflict, unprocessable } = require('../errors');
const { withTx, requireOrganizer, logEvent } = require('./tournamentService');
const { STARTED_SQL } = require('./shared');

/** @typedef {import('./tournamentService').Pool} Pool */
/** @typedef {import('./tournamentService').Queryable} Queryable */
/** @typedef {import('./tournamentService').Viewer} Viewer */

/** @param {Queryable} db @param {string} categoryId */
async function loadCategory(db, categoryId, lock = false) {
  const { rows } = await db.query(
    `SELECT * FROM categories WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [categoryId],
  );
  if (!rows[0]) throw notFound('Không tìm thấy nội dung thi đấu');
  return rows[0];
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
    // Nạp muộn: entryService require categoryService (loadCategory) → tránh vòng require.
    const { pruneAthletes } = require('./entryService');
    await pruneAthletes(c, cat.tournament_id);
    return { deleted: categoryId, code: cat.code };
  });
}

module.exports = {
  createCategory, updateCategory, deleteCategory, setRoundRules, assertRulesChangeAllowed, categoryStarted, loadCategory,
};

'use strict';
/**
 * Tiện ích nội bộ dùng chung giữa tournamentService và các service theo khu vực
 * (categoryService, entryService, matchService). Không phụ thuộc service nào → không vòng require.
 * Chỉ dùng nội bộ trong services/, không export ra ngoài tầng service.
 */

const { roundRobin } = require('../domain/draw');

/** @typedef {import('./tournamentService').Queryable} Queryable */

/** Trận đã bắt đầu hoặc có kết quả, kể cả khi trạng thái trước truất quyền đang được lưu để khôi phục. */
const STARTED_SQL = `(status IN ('live', 'finished', 'walkover') OR games <> '[]'::jsonb
  OR pre_cancel->>'status' IN ('live', 'finished', 'walkover'))`;

/** Đội (e) thuộc nội dung (c) vẫn còn trong phạm vi thi đấu. */
const DISQUALIFIABLE_ENTRY_SQL = `(e.disqualified_at IS NULL AND (
  c.stage IN ('setup', 'groups') OR (c.stage = 'knockout' AND EXISTS (
    SELECT 1 FROM matches m WHERE m.category_id = c.id AND m.stage = 'knockout'
      AND m.status IN ('pending', 'scheduled', 'live') AND e.id IN (m.entry_a_id, m.entry_b_id)
  ))))`;

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
 * Từng VĐV của một đội: { athleteId, name }. athleteId (hồ sơ VĐV theo giải) KHÔNG phải dữ liệu cá nhân — chỉ để
 * client phân biệt hai người trùng tên (ô tìm VĐV gom theo người). MSSV/SĐT không bao giờ trả ở đây.
 */
function playersOfEntry(p1, p1Aid, p2, p2Aid) {
  return [p1 ? { athleteId: p1Aid ?? null, name: p1 } : null, p2 ? { athleteId: p2Aid ?? null, name: p2 } : null].filter(Boolean);
}

/** @param {any} e entries row */
const entryPlayers = (e) => (e ? playersOfEntry(e.player1_name, e.player1_athlete_id, e.player2_name, e.player2_athlete_id) : []);

module.exports = { STARTED_SQL, DISQUALIFIABLE_ENTRY_SQL, insertRoundRobin, playersOfEntry, entryPlayers };

'use strict';
/**
 * Đọc / ghi bảng match_rallies (không kiểm tra quyền — bên gọi đã khoá trận và kiểm tra).
 * Tách riêng để tournamentService (PUT /score) và rallyService dùng chung mà không vòng require.
 */

/** @typedef {import('./tournamentService').Queryable} Queryable */
/** @typedef {import('../domain/rally').RallyEvent} RallyEvent */

/**
 * Sự kiện biên bản của trận, theo seq (dạng domain).
 * @param {Queryable} c @param {string} matchId @returns {Promise<(RallyEvent & { game: number, score: [number, number]|null, at: string })[]>}
 */
async function loadEvents(c, matchId) {
  const { rows } = await c.query(
    `SELECT seq, game, type, side, server_slot, receiver_slot, score_a, score_b, games, created_at
       FROM match_rallies WHERE match_id = $1 ORDER BY seq`,
    [matchId],
  );
  return rows.map((r) => ({
    seq: r.seq, game: r.game, type: r.type, side: r.side, server: r.server_slot, receiver: r.receiver_slot,
    score: r.score_a === null ? null : [r.score_a, r.score_b], games: r.games, at: r.created_at,
  }));
}

/**
 * BTC sửa tỉ số bằng tay khi trận đã có biên bản → ghi mốc override (điểm sau đó tính tiếp từ bản sửa).
 * Trận chưa có biên bản thì không ghi gì.
 * @param {Queryable} c @param {string} matchId @param {[number, number][]} games @param {string} actorId
 */
async function recordOverride(c, matchId, games, actorId) {
  const { rows } = await c.query('SELECT max(seq) AS seq FROM match_rallies WHERE match_id = $1', [matchId]);
  const last = rows[0]?.seq;
  if (!last) return;
  const g = games[games.length - 1] ?? [0, 0];
  await c.query(
    `INSERT INTO match_rallies (match_id, seq, game, type, score_a, score_b, games, created_by)
     VALUES ($1, $2, $3, 'override', $4, $5, $6::jsonb, $7)`,
    [matchId, last + 1, Math.min(Math.max(games.length, 1), 5), g[0], g[1], JSON.stringify(games), actorId],
  );
}

module.exports = { loadEvents, recordOverride };

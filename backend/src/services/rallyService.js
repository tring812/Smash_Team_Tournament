'use strict';
/**
 * Biên bản diễn biến điểm (Bàn điểm trọng tài): thêm từng sự kiện vào cuối, hoàn tác sự kiện cuối.
 *  - Máy chủ tự tính tỉ số và người giao (domain/rally) rồi cập nhật matches.games trong CÙNG giao dịch.
 *  - `expectedSeq` (seq của sự kiện sắp thêm / sự kiện cuối khi hoàn tác) chống 2 máy cùng bấm: lệch → 409.
 *  - Nhật ký BTC chỉ ghi sửa người giao và hoàn tác — không ghi từng điểm.
 */
const { conflict, unprocessable } = require('../errors');
const { withTx, logEvent } = require('./tournamentService');
const { lockScorable, matchSelectFrom, presentMatch } = require('./matchService');
const store = require('./rallyStore');
const { replay, applyEvent, RallyError } = require('../domain/rally');

/** @typedef {import('./tournamentService').Pool} Pool */
/** @typedef {import('./tournamentService').Queryable} Queryable */
/** @typedef {import('./tournamentService').Viewer} Viewer */

/**
 * Sự kiện biên bản để trả cho client (công khai được: chỉ có ô VĐV, không có người bấm / dữ liệu cá nhân).
 * @param {Awaited<ReturnType<typeof store.loadEvents>>[number]} e
 */
const present = (e) => ({
  seq: e.seq, game: e.game, type: e.type, side: e.side ?? null, server: e.server ?? null, receiver: e.receiver ?? null,
  score: e.score, games: e.type === 'override' ? e.games : null, at: e.at,
});

/** @param {Queryable} db @param {string} matchId */
async function listRallies(db, matchId) {
  return (await store.loadEvents(db, matchId)).map(present);
}

/** Tên VĐV theo ô (để ghi nhật ký dễ đọc). */
async function slotName(c, m, slot) {
  if (!slot) return null;
  const { rows } = await c.query('SELECT player1_name, player2_name FROM entries WHERE id = $1', [slot[0] === 'a' ? m.entry_a_id : m.entry_b_id]);
  return (slot[1] === '1' ? rows[0]?.player1_name : rows[0]?.player2_name) ?? slot;
}

/**
 * Ghi games mới vào trận (cache của biên bản) + đánh dấu đang đánh + chuyển giải sang "đang diễn ra" (lần đầu),
 * kèm thay đổi biên bản `change` (CTE thêm / xoá match_rallies, tham số từ $5) — TẤT CẢ trong 1 câu lệnh, và trả
 * về luôn trận đã cập nhật (dạng MATCH_SELECT) để route khỏi phải đọc lại. Mỗi điểm trọng tài bấm đi qua đây.
 * @param {Queryable} c @param {any} m @param {[number, number][]} games @param {string} role @param {Viewer} viewer
 * @param {{ cte: string, params: unknown[] }} change
 */
async function saveGames(c, m, games, role, viewer, change) {
  const { rows } = await c.query(
    `WITH ${change.cte},
     upd AS (
       UPDATE matches SET games = $2::jsonb, status = 'live', called_at = COALESCE(called_at, now()),
              referee_user_id = COALESCE(referee_user_id, $3::uuid), version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *
     ), tour AS (
       UPDATE tournaments SET status = 'ongoing' WHERE id = $4 AND status = 'published'
     )
     ${matchSelectFrom('upd')}`,
    [m.id, JSON.stringify(games), role === 'referee' ? viewer.id : null, m.tournament_id, ...change.params],
  );
  const row = rows[0];
  // Câu SELECT chính đọc tournaments theo ảnh chụp TRƯỚC câu lệnh → tự phản ánh việc vừa chuyển "đang diễn ra".
  if (m.tournament_status === 'published') row.tournament_status = 'ongoing';
  return row;
}

/**
 * Trận + biên bản để trả cho client sau khi thêm / hoàn tác (cùng dạng GET /matches/:id).
 * @param {any} row hàng MATCH_SELECT @param {Awaited<ReturnType<typeof store.loadEvents>>} events
 */
const view = (row, events) => ({ ...presentMatch(row), rallies: events.map(present) });

/**
 * Thêm một sự kiện: start (người giao + nhận) · point (đội thắng pha) · fix_server (sửa người giao).
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId
 * @param {{ type: 'start'|'point'|'fix_server', side?: 'a'|'b', server?: string, receiver?: string, expectedSeq: number }} input
 */
async function addRally(pool, viewer, matchId, input) {
  return withTx(pool, async (c) => {
    const { m, role, rules } = await lockScorable(c, matchId, viewer);
    const events = await store.loadEvents(c, matchId);
    const seq = (events[events.length - 1]?.seq ?? 0) + 1;
    if (input.expectedSeq !== seq) {
      throw conflict('RALLY_CONFLICT', 'Biên bản vừa được cập nhật từ thiết bị khác — đã tải lại bản mới nhất', { nextSeq: seq });
    }
    const doubles = Boolean(m.is_doubles);
    const ev = { seq, type: input.type, side: input.side ?? null, server: input.server ?? null, receiver: input.receiver ?? null };
    let st;
    try {
      st = applyEvent(replay(events, rules, doubles), /** @type {any} */ (ev), rules, doubles);
    } catch (err) {
      if (err instanceof RallyError) throw unprocessable(err.message);
      throw err;
    }
    const g = st.games[st.games.length - 1] ?? [0, 0];
    const game = Math.min(Math.max(st.games.length, 1), 5);
    const score = input.type === 'point' ? /** @type {[number, number]} */ ([g[0], g[1]]) : null;
    const row = await saveGames(c, m, st.games, role, viewer, {
      cte: `ins AS (
        INSERT INTO match_rallies (match_id, seq, game, type, side, server_slot, receiver_slot, score_a, score_b, created_by)
        VALUES ($1, $5, $6, $7, $8, $9, $10, $11, $12, $13))`,
      params: [seq, game, input.type, ev.side, st.server, st.receiver, score?.[0] ?? null, score?.[1] ?? null, viewer.id],
    });
    if (input.type === 'fix_server') {
      await logEvent(c, m.tournament_id, m.category_id, viewer.id, 'rally_fix_server',
        { matchId, seq, server: input.server, name: await slotName(c, m, input.server), score: g });
    }
    // Biên bản sau khi thêm = đã đọc + sự kiện mới (đúng như loadEvents sẽ trả) → khỏi đọc lại.
    // created_at mặc định now() = thời điểm giao dịch, trùng updated_at của trận vừa ghi.
    const added = { seq, game, type: input.type, side: ev.side, server: st.server, receiver: st.receiver, score, games: null, at: row.updated_at };
    return { seq, tournament_started: m.tournament_status === 'published', view: view(row, [...events, /** @type {any} */ (added)]) };
  });
}

/**
 * Hoàn tác: xoá sự kiện CUỐI (phải đúng `expectedSeq`) và tính lại tỉ số. Chỉ khi trận chưa xác nhận.
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId @param {number} expectedSeq
 */
async function undoRally(pool, viewer, matchId, expectedSeq) {
  return withTx(pool, async (c) => {
    const { m, role, rules } = await lockScorable(c, matchId, viewer);
    const events = await store.loadEvents(c, matchId);
    const last = events[events.length - 1];
    if (!last) throw conflict('NOTHING_TO_UNDO', 'Biên bản chưa có gì để hoàn tác');
    if (last.seq !== expectedSeq) {
      throw conflict('RALLY_CONFLICT', 'Biên bản vừa được cập nhật từ thiết bị khác — đã tải lại bản mới nhất', { nextSeq: last.seq + 1 });
    }
    const rest = events.slice(0, -1);
    const st = replay(rest, rules, Boolean(m.is_doubles));
    const row = await saveGames(c, m, st.games, role, viewer, {
      cte: 'del AS (DELETE FROM match_rallies WHERE match_id = $1 AND seq = $5)',
      params: [last.seq],
    });
    await logEvent(c, m.tournament_id, m.category_id, viewer.id, 'rally_undo',
      { matchId, seq: last.seq, type: last.type, side: last.side ?? null, score: last.score ?? null });
    return { seq: last.seq, tournament_started: m.tournament_status === 'published', view: view(row, rest) };
  });
}

module.exports = { listRallies, addRally, undoRally };

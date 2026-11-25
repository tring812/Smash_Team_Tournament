'use strict';
/**
 * Điều phối theo SÂN — cách chạy giải phong trào thực tế: lịch giờ chỉ là dự kiến, sân nào trống thì
 * BTC "gọi" trận kế tiếp vào sân đó.
 *
 *  - Sân BẬN khi có trận đang đánh (status 'live') hoặc trận đã gọi vào sân mà chưa có điểm
 *    (called_at IS NOT NULL, status 'pending'/'scheduled').
 *  - VĐV BẬN khi đang ở một trận như trên (kể cả nội dung khác) → không gọi trận khác của họ.
 *  - VĐV vừa đánh xong < REST_MINUTES phút được ưu tiên nghỉ (gợi ý né, BTC vẫn gọi được).
 *  - Gợi ý "trận kế tiếp" cho từng sân trống: tham lam, ưu tiên trận lịch dự kiến ở chính sân đó,
 *    rồi trận có giờ dự kiến sớm nhất, rồi theo vòng — giống cách trọng tài bàn chính gọi trận.
 */
const { notFound, conflict, unprocessable } = require('../errors');
const {
  withTx, requireOrganizer, logEvent, participantKey, FINAL_STATUSES,
} = require('./tournamentService');
const { presentMatch, MATCH_SELECT } = require('./matchService');

/** @typedef {import('./tournamentService').Pool} Pool */
/** @typedef {import('./tournamentService').Queryable} Queryable */
/** @typedef {import('./tournamentService').Viewer} Viewer */

const REST_MINUTES = 10;

/** Trận đang chiếm sân/VĐV (SQL, alias m). */
const OCCUPYING = `(m.status = 'live' OR (m.called_at IS NOT NULL AND m.status IN ('pending', 'scheduled')))`;

/** Cột người chơi để tính khoá VĐV (chống 1 người ở 2 sân). */
const PLAYER_COLS = `ea.player1_athlete_id AS a1a, ea.player1_user_id AS a1u, ea.player1_name AS a1n,
  ea.player2_athlete_id AS a2a, ea.player2_user_id AS a2u, ea.player2_name AS a2n,
  eb.player1_athlete_id AS b1a, eb.player1_user_id AS b1u, eb.player1_name AS b1n,
  eb.player2_athlete_id AS b2a, eb.player2_user_id AS b2u, eb.player2_name AS b2n`;

/** @param {any} r @returns {{ key: string, name: string }[]} */
function playersOf(r) {
  return [[r.a1a, r.a1u, r.a1n], [r.a2a, r.a2u, r.a2n], [r.b1a, r.b1u, r.b1n], [r.b2a, r.b2u, r.b2n]]
    .filter(([, , n]) => n)
    .map(([a, u, n]) => ({ key: /** @type {string} */ (participantKey(a, u, n)), name: n }));
}

/**
 * Mọi trận chưa xong của giải + người chơi + lần cuối từng người đánh xong.
 * @param {Queryable} db @param {string} tid
 */
async function loadOpenMatches(db, tid) {
  const { rows } = await db.query(
    `SELECT sel.*, ${PLAYER_COLS}
       FROM (${MATCH_SELECT} WHERE m.tournament_id = $1 AND m.status IN ('pending', 'scheduled', 'live')) sel
       LEFT JOIN entries ea ON ea.id = sel.entry_a_id
       LEFT JOIN entries eb ON eb.id = sel.entry_b_id`,
    [tid],
  );
  const { rows: done } = await db.query(
    `SELECT m.finished_at, ${PLAYER_COLS} FROM matches m
       LEFT JOIN entries ea ON ea.id = m.entry_a_id LEFT JOIN entries eb ON eb.id = m.entry_b_id
      WHERE m.tournament_id = $1 AND m.status IN ('finished', 'walkover') AND m.finished_at > now() - make_interval(mins => $2)`,
    [tid, REST_MINUTES],
  );
  /** @type {Map<string, Date>} */
  const lastFinished = new Map();
  for (const d of done) {
    for (const p of playersOf(d)) {
      const prev = lastFinished.get(p.key);
      if (!prev || prev < d.finished_at) lastFinished.set(p.key, d.finished_at);
    }
  }
  return { rows, lastFinished };
}

const isOccupying = (r) => r.status === 'live' || (r.called_at && ['pending', 'scheduled'].includes(r.status));

/**
 * Bảng điều phối: từng sân (trọng tài, trận đang chiếm sân, gợi ý trận kế tiếp) + hàng chờ.
 * @param {Queryable} db @param {Viewer} viewer @param {string} tid
 * @param {{ now?: Date }} [opts]
 */
async function courtBoard(db, viewer, tid, opts = {}) {
  await requireOrganizer(db, tid, viewer);
  const t = (await db.query('SELECT courts FROM tournaments WHERE id = $1', [tid])).rows[0];
  if (!t) throw notFound('Không tìm thấy giải');
  const now = opts.now ?? new Date();
  const { rows, lastFinished } = await loadOpenMatches(db, tid);
  const { rows: refs } = await db.query(
    `SELECT cr.court, cr.user_id, u.full_name FROM court_referees cr JOIN users u ON u.id = cr.user_id WHERE cr.tournament_id = $1`, [tid],
  );

  /** @type {Map<string, { court: number|null, label: string }>} người chơi → trận đang chiếm */
  const busy = new Map();
  for (const r of rows.filter(isOccupying)) {
    for (const p of playersOf(r)) busy.set(p.key, { court: r.court, label: p.name });
  }

  const ready = rows
    .filter((r) => !isOccupying(r) && r.entry_a_id && r.entry_b_id)
    .map((r) => {
      const players = playersOf(r);
      const busyWith = players.filter((p) => busy.has(p.key)).map((p) => ({ name: p.name, court: busy.get(p.key)?.court ?? null }));
      const restMs = Math.max(0, ...players.map((p) => {
        const f = lastFinished.get(p.key);
        return f ? REST_MINUTES * 60_000 - (now.getTime() - new Date(f).getTime()) : 0;
      }));
      return { r, players, busyWith, restingMinutes: Math.ceil(restMs / 60_000) };
    })
    .sort((x, y) => {
      const tx = x.r.scheduled_at ? new Date(x.r.scheduled_at).getTime() : Infinity;
      const ty = y.r.scheduled_at ? new Date(y.r.scheduled_at).getTime() : Infinity;
      return tx - ty || x.r.round - y.r.round || x.r.position - y.r.position || (x.r.category_code < y.r.category_code ? -1 : 1);
    });

  const courtCount = Math.max(t.courts, ...rows.map((r) => r.court ?? 0));
  /** @type {Set<string>} */ const taken = new Set();
  /** @type {Set<string>} */ const takenPlayers = new Set();
  const courts = [];
  for (let n = 1; n <= courtCount; n += 1) {
    const current = rows.find((r) => r.court === n && isOccupying(r));
    const ref = refs.find((x) => x.court === n);
    let suggestion = null;
    if (!current) {
      // Ưu tiên: không bận → không đang nghỉ → lịch dự kiến ở chính sân này → giờ sớm nhất.
      const candidates = ready.filter((c) => !taken.has(c.r.id) && !c.busyWith.length && !c.players.some((p) => takenPlayers.has(p.key)));
      const pick = candidates.find((c) => !c.restingMinutes && c.r.court === n)
        ?? candidates.find((c) => !c.restingMinutes)
        ?? candidates[0];
      if (pick) {
        suggestion = pick.r.id;
        taken.add(pick.r.id);
        for (const p of pick.players) takenPlayers.add(p.key);
      }
    }
    courts.push({
      court: n,
      referee: ref ? { id: ref.user_id, name: ref.full_name } : null,
      current: current ? presentMatch(current) : null,
      suggestionId: suggestion,
    });
  }
  return {
    restMinutes: REST_MINUTES,
    courts,
    queue: ready.map((c) => ({ match: presentMatch(c.r), busyWith: c.busyWith, restingMinutes: c.restingMinutes })),
  };
}

/**
 * Khoá trận để điều phối + kiểm tra cơ bản.
 * @param {Queryable} c @param {string} matchId
 */
async function lockMatch(c, matchId) {
  const { rows } = await c.query(
    `SELECT m.*, t.courts AS t_courts, t.slot_minutes, ${PLAYER_COLS}
       FROM matches m JOIN tournaments t ON t.id = m.tournament_id
       LEFT JOIN entries ea ON ea.id = m.entry_a_id LEFT JOIN entries eb ON eb.id = m.entry_b_id
      WHERE m.id = $1 FOR UPDATE OF m`,
    [matchId],
  );
  if (!rows[0]) throw notFound('Không tìm thấy trận');
  return rows[0];
}

/** @param {number} court @param {number} max */
function checkCourt(court, max) {
  if (!Number.isInteger(court) || court < 1 || court > Math.max(max, 1)) throw unprocessable(`Sân phải từ 1 đến ${max}`);
}

/**
 * Sân `court` có đang bị trận khác chiếm không (đang đánh / đã gọi).
 * @param {Queryable} c @param {string} tid @param {number} court @param {string} exceptId
 */
async function assertCourtFree(c, tid, court, exceptId) {
  const { rows } = await c.query(
    `SELECT m.id FROM matches m WHERE m.tournament_id = $1 AND m.court = $2 AND m.id <> $3 AND ${OCCUPYING} LIMIT 1`,
    [tid, court, exceptId],
  );
  if (rows[0]) throw conflict('COURT_BUSY', `Sân ${court} đang có trận — kết thúc hoặc rút trận đó trước`);
}

/**
 * Không VĐV nào của trận đang ở trận khác (đang đánh / đã gọi).
 * @param {Queryable} c @param {any} m
 */
async function assertPlayersFree(c, m) {
  const mine = new Map(playersOf(m).map((p) => [p.key, p.name]));
  const { rows } = await c.query(
    `SELECT m.court, ${PLAYER_COLS} FROM matches m
       LEFT JOIN entries ea ON ea.id = m.entry_a_id LEFT JOIN entries eb ON eb.id = m.entry_b_id
      WHERE m.tournament_id = $1 AND m.id <> $2 AND ${OCCUPYING}`,
    [m.tournament_id, m.id],
  );
  for (const r of rows) {
    const clash = playersOf(r).find((p) => mine.has(p.key));
    if (clash) throw conflict('PLAYER_BUSY', `${clash.name} đang ở sân ${r.court ?? '?'} — chờ trận đó xong rồi gọi`);
  }
}

/**
 * GỌI trận vào sân: sân và VĐV phải rảnh. Giờ gọi lưu ở called_at — KHÔNG ghi đè giờ dự kiến (scheduled_at);
 * sân dự kiến được giữ ở planned_court để "Rút về" trả lại.
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId @param {{ court: number, now?: Date }} input
 */
async function callMatch(pool, viewer, matchId, input) {
  return withTx(pool, async (c) => {
    const m = await lockMatch(c, matchId);
    await requireOrganizer(c, m.tournament_id, viewer);
    // Khoá theo giải để 2 BTC bấm gọi cùng lúc không cùng chiếm một sân.
    await c.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [m.tournament_id]);
    if (!['pending', 'scheduled'].includes(m.status)) {
      throw conflict('MATCH_NOT_WAITING', m.status === 'live' ? 'Trận đang đánh' : 'Trận không còn ở trạng thái chờ');
    }
    if (!m.entry_a_id || !m.entry_b_id) throw conflict('MISSING_ENTRY', 'Trận chưa đủ 2 đội');
    checkCourt(input.court, m.t_courts);
    await assertCourtFree(c, m.tournament_id, input.court, m.id);
    await assertPlayersFree(c, m);
    const now = input.now ?? new Date();
    const { rows } = await c.query(
      `UPDATE matches SET planned_court = CASE WHEN called_at IS NULL THEN court ELSE planned_court END,
              court = $2, called_at = $3, version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING id`,
      [m.id, input.court, now.toISOString()],
    );
    await logEvent(c, m.tournament_id, m.category_id, viewer.id, 'call_match',
      { matchId: m.id, court: input.court, fromCourt: m.court, plannedAt: m.scheduled_at });
    return rows[0];
  });
}

/**
 * RÚT trận đã gọi về hàng chờ (chưa có điểm). Trận đang đánh thì dùng "chuyển sân".
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId
 */
async function uncallMatch(pool, viewer, matchId) {
  return withTx(pool, async (c) => {
    const m = await lockMatch(c, matchId);
    await requireOrganizer(c, m.tournament_id, viewer);
    if (!m.called_at || !['pending', 'scheduled'].includes(m.status)) {
      throw conflict('NOT_CALLED', m.status === 'live' ? 'Trận đã có điểm — dùng "Chuyển sân" thay vì rút' : 'Trận chưa được gọi vào sân');
    }
    // Trả về đúng giờ (không đổi) và SÂN DỰ KIẾN ban đầu → trận về lại vị trí cũ trong hàng chờ.
    await c.query(
      `UPDATE matches SET called_at = NULL, court = planned_court, planned_court = NULL, version = version + 1, updated_at = now()
        WHERE id = $1`,
      [m.id],
    );
    await logEvent(c, m.tournament_id, m.category_id, viewer.id, 'uncall_match', { matchId: m.id, court: m.court, toCourt: m.planned_court });
    return { id: m.id };
  });
}

/**
 * DỜI một trận: đổi sân và/hoặc giờ dự kiến (không phải xếp lại cả giai đoạn).
 *  - Trận đang đánh / đã gọi: chỉ đổi sân, sân mới phải trống (chuyển sân giữa chừng).
 *  - Trận chờ: đổi giờ thì VĐV không được có trận khác trong ±1 khung giờ; sân không trùng khung với trận khác.
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId
 * @param {{ court?: number|null, scheduledAt?: string|null }} input
 */
async function moveMatch(pool, viewer, matchId, input) {
  return withTx(pool, async (c) => {
    const m = await lockMatch(c, matchId);
    await requireOrganizer(c, m.tournament_id, viewer);
    await c.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [m.tournament_id]);
    if (FINAL_STATUSES.has(m.status) || m.status === 'cancelled') throw conflict('MATCH_CLOSED', 'Trận đã kết thúc hoặc đã huỷ');
    const occupying = isOccupying(m);
    const court = input.court === undefined ? m.court : input.court;
    const at = input.scheduledAt === undefined ? m.scheduled_at : input.scheduledAt;
    if (court !== null) checkCourt(court, m.t_courts);
    if (occupying) {
      if (input.scheduledAt !== undefined) throw unprocessable('Trận đang ở sân — chỉ chuyển sân được, không đổi giờ');
      if (court === null) throw unprocessable('Trận đang ở sân — chọn sân mới');
      if (court !== m.court) await assertCourtFree(c, m.tournament_id, court, m.id);
    } else if (at) {
      const slotMs = m.slot_minutes * 60_000;
      const { rows: near } = await c.query(
        `SELECT m.id, m.court, m.scheduled_at, ${PLAYER_COLS} FROM matches m
           LEFT JOIN entries ea ON ea.id = m.entry_a_id LEFT JOIN entries eb ON eb.id = m.entry_b_id
          WHERE m.tournament_id = $1 AND m.id <> $2 AND m.status IN ('pending', 'scheduled', 'live')
            AND m.scheduled_at > $3::timestamptz - make_interval(secs => $4) AND m.scheduled_at < $3::timestamptz + make_interval(secs => $4)`,
        [m.tournament_id, m.id, at, slotMs / 1000],
      );
      const mine = new Map(playersOf(m).map((p) => [p.key, p.name]));
      for (const r of near) {
        if (court !== null && r.court === court) {
          throw conflict('COURT_TAKEN', `Sân ${court} đã có trận khác trong khung giờ này`);
        }
        const clash = playersOf(r).find((p) => mine.has(p.key));
        if (clash) throw conflict('PLAYER_TAKEN', `${clash.name} đã có trận khác trong khung giờ này (sân ${r.court ?? '?'})`);
      }
    }
    // Trận chờ: có giờ → 'scheduled', bỏ giờ → về 'pending'. Trận đang đánh giữ nguyên trạng thái.
    const status = m.status === 'live' ? 'live' : at ? 'scheduled' : 'pending';
    await c.query(
      `UPDATE matches SET court = $2, scheduled_at = $3, status = $4, version = version + 1, updated_at = now() WHERE id = $1`,
      [m.id, court, at, status],
    );
    await logEvent(c, m.tournament_id, m.category_id, viewer.id, 'move_match',
      { matchId: m.id, from: { court: m.court, at: m.scheduled_at }, to: { court, at } });
    return { id: m.id };
  });
}

/**
 * Gán / bỏ trọng tài phụ trách một sân.
 * @param {Pool} pool @param {Viewer} viewer @param {string} tid @param {number} court @param {string|null} userId
 */
async function setCourtReferee(pool, viewer, tid, court, userId) {
  return withTx(pool, async (c) => {
    await requireOrganizer(c, tid, viewer);
    const t = (await c.query('SELECT courts FROM tournaments WHERE id = $1', [tid])).rows[0];
    if (!t) throw notFound('Không tìm thấy giải');
    checkCourt(court, t.courts);
    let name = null;
    if (userId) {
      const r = await c.query(
        `SELECT u.full_name FROM tournament_staff s JOIN users u ON u.id = s.user_id
          WHERE s.tournament_id = $1 AND s.user_id = $2 AND u.disabled_at IS NULL`, [tid, userId],
      );
      if (!r.rows[0]) throw unprocessable('Người này chưa là trọng tài/BTC của giải');
      name = r.rows[0].full_name;
      await c.query(
        `INSERT INTO court_referees (tournament_id, court, user_id) VALUES ($1, $2, $3)
         ON CONFLICT (tournament_id, court) DO UPDATE SET user_id = EXCLUDED.user_id, assigned_at = now()`,
        [tid, court, userId],
      );
    } else {
      await c.query('DELETE FROM court_referees WHERE tournament_id = $1 AND court = $2', [tid, court]);
    }
    await logEvent(c, tid, null, viewer.id, 'court_referee', { court, referee: name });
    return { court, referee: userId ? { id: userId, name } : null };
  });
}

module.exports = {
  REST_MINUTES, courtBoard, callMatch, uncallMatch, moveMatch, setCourtReferee,
  lockMatch, checkCourt, assertCourtFree, assertPlayersFree,
};

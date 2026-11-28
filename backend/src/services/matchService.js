'use strict';
/**
 * Nghiệp vụ TRẬN ĐẤU: đọc / trình bày trận, nhánh, hàng chờ trọng tài; bắt đầu trận, nhập điểm,
 * mở lại, phân công trọng tài; đưa đội thắng đi tiếp & xử walkover.
 * Tách từ tournamentService; nơi gọi require thẳng tệp này.
 */

const { roundLabel, seedsFromGroups } = require('../domain/bracket');
const { evaluateMatch } = require('../domain/scoring');
const { effectiveRules } = require('../domain/roundRules');
const { notFound, forbidden, conflict, unprocessable } = require('../errors');
const rallies = require('./rallyStore');
const { withTx, roleIn, requireOrganizer, logEvent, groupStandings, FINAL_STATUSES } = require('./tournamentService');
const { playersOfEntry } = require('./shared');
const { loadCategory } = require('./categoryService');

/** @typedef {import('./tournamentService').Pool} Pool */
/** @typedef {import('./tournamentService').Queryable} Queryable */
/** @typedef {import('./tournamentService').Viewer} Viewer */

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

/** Hai trận cuối có thể được chốt đồng thời; khoá nội dung rồi đọc trạng thái mới nhất của cả hai. */
async function completeKnockout(c, categoryId) {
  await c.query('SELECT id FROM categories WHERE id = $1 FOR UPDATE', [categoryId]);
  await c.query(
    `UPDATE categories SET stage = 'completed' WHERE id = $1 AND stage = 'knockout'
      AND NOT EXISTS (
        SELECT 1 FROM matches WHERE category_id = $1 AND stage = 'knockout' AND next_match_id IS NULL
          AND status NOT IN ('finished', 'walkover', 'bye', 'cancelled')
      )`, [categoryId],
  );
}

/** Đưa đối thủ còn hợp lệ đi tiếp khi gặp đội đã bị truất quyền. Hai đội tranh hạng đều bị truất quyền → không trao hạng. */
async function settleDisqualifiedMatch(c, m, actorId) {
  if (!m?.entry_a_id || !m?.entry_b_id || FINAL_STATUSES.has(m.status) || m.status === 'cancelled') return false;
  const { rows: dq } = await c.query(
    'SELECT id FROM entries WHERE id IN ($1, $2) AND disqualified_at IS NOT NULL', [m.entry_a_id, m.entry_b_id],
  );
  if (dq.length === 1) {
    await walkoverTo(c, m, dq[0].id === m.entry_a_id ? m.entry_b_id : m.entry_a_id, actorId);
    return true;
  }
  if (dq.length === 2 && m.is_third_place) {
    await c.query(
      `UPDATE matches SET status = 'cancelled', finished_at = now(), version = version + 1, updated_at = now() WHERE id = $1`, [m.id],
    );
    await completeKnockout(c, m.category_id);
  }
  return false;
}

/** Trận nhận đội thắng, và trận nhận đội thua nếu đây là bán kết có tranh hạng Ba–Tư. */
const downstreamIds = (m) => [m.next_match_id, m.loser_next_match_id].filter(Boolean);

/**
 * Đưa đội thắng đi tiếp và chuyển đội thua bán kết vào trận tranh hạng Ba–Tư (nếu bật).
 * @param {Queryable} c @param {any} m @param {string} winnerId @param {string} actorId
 */
async function advanceWinner(c, m, winnerId, actorId) {
  if (m.stage !== 'knockout') return;
  if (!m.next_match_id) {
    await completeKnockout(c, m.category_id);
    return;
  }
  const col = m.next_slot === 'a' ? 'entry_a_id' : 'entry_b_id';
  const putInto = async (id, entryId) => (await c.query(
    `UPDATE matches SET ${col} = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, entryId],
  )).rows[0];
  const next = await putInto(m.next_match_id, winnerId);
  const third = m.loser_next_match_id
    ? await putInto(m.loser_next_match_id, winnerId === m.entry_a_id ? m.entry_b_id : m.entry_a_id)
    : null;
  await settleDisqualifiedMatch(c, next, actorId);
  await settleDisqualifiedMatch(c, third, actorId);
}

/** Khoá và kiểm tra mọi trận nhận đội trước khi đổi kết quả hoặc mở lại trận dẫn vào. */
async function assertDownstreamWaiting(c, ids) {
  if (!ids.length) return;
  let rows;
  try {
    ({ rows } = await c.query(
      'SELECT status, games, called_at FROM matches WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE NOWAIT', [ids],
    ));
  } catch (err) {
    if (err.code === '55P03') throw conflict('NEXT_STARTED', 'Trận vòng sau đang được cập nhật — hãy thử lại');
    throw err;
  }
  if (rows.length !== ids.length || rows.some((r) => !['pending', 'scheduled'].includes(r.status) || r.called_at || r.games.length)) {
    throw conflict('NEXT_STARTED', 'Trận vòng sau đã được gọi hoặc bắt đầu; hãy rút trận về hàng chờ nếu chưa đánh');
  }
}

/**
 * Khoá trận để NHẬP ĐIỂM (lưu tỉ số / biên bản) + kiểm tra quyền và trạng thái chung:
 * trọng tài được phân công (trận hoặc sân) hoặc BTC; giải chưa kết thúc; trận đủ 2 đội, chưa huỷ, chưa xong.
 * @param {Queryable} c @param {string} matchId @param {Viewer} viewer
 * @param {{ claim?: boolean }} [opts]
 */
async function lockScorable(c, matchId, viewer, opts = {}) {
  // Chạy ở MỖI điểm trọng tài bấm → 1 lượt gọi DB: đọc luôn vai trò người xem và trọng tài phụ trách sân
  // (trước là 3 câu: trận, roleIn, court_referees). DB ở xa thì mỗi lượt vài chục ms.
  const { rows } = await c.query(
    `SELECT m.*, cat.points_to_win, cat.max_points, cat.games_to_win, cat.round_rules, cat.is_doubles, t.status AS tournament_status,
            t.deleted_at AS tournament_deleted_at,
            (SELECT max(k.round) FROM matches k WHERE k.category_id = m.category_id AND k.stage = 'knockout') AS ko_rounds,
            (SELECT s.role FROM tournament_staff s WHERE s.tournament_id = m.tournament_id AND s.user_id = $2::uuid) AS viewer_role,
            (SELECT cr.user_id FROM court_referees cr WHERE cr.tournament_id = m.tournament_id AND cr.court = m.court) AS court_referee_id
       FROM matches m JOIN categories cat ON cat.id = m.category_id JOIN tournaments t ON t.id = m.tournament_id
      WHERE m.id = $1 FOR UPDATE OF m`,
    [matchId, viewer?.id ?? null],
  );
  const m = rows[0];
  if (!m) throw notFound('Không tìm thấy trận');
  // Cùng quy tắc với roleIn(), nhưng đã đọc sẵn trong câu SELECT trên — kể cả quy tắc giải đã xoá (mềm):
  // không ai (cả quản trị viên) nhập điểm / bắt đầu trận được nữa, chỉ khôi phục giải.
  const role = !viewer || m.tournament_deleted_at ? null : viewer.role === 'admin' ? 'admin' : m.viewer_role ?? null;
  if (!role) throw forbidden();
  if (role === 'referee') {
    // Trọng tài hiệu lực: gán riêng cho trận, nếu không thì trọng tài phụ trách sân của trận.
    const assigned = m.referee_user_id ?? (m.court ? m.court_referee_id : null) ?? null;
    if (assigned && assigned !== viewer.id) throw forbidden('Trận này đã phân công cho trọng tài khác');
  }
  if (m.tournament_status === 'completed') throw conflict('TOURNAMENT_CLOSED', 'Giải đã kết thúc');
  if (m.tournament_status === 'draft' && role === 'referee') throw forbidden('Giải chưa công bố');
  if (!m.entry_a_id || !m.entry_b_id) throw conflict('MISSING_ENTRY', 'Trận chưa đủ 2 đội');
  if (m.status === 'cancelled') throw conflict('MATCH_CANCELLED', 'Trận đã bị huỷ do có đội bị truất quyền');
  if (FINAL_STATUSES.has(m.status)) throw conflict('MATCH_CLOSED', 'Trận đã kết thúc');
  if (opts.claim !== false && m.status !== 'live') {
    // Ghi điểm/chọn giao đầu tiên tự nhận sân, cùng khoá với thao tác điều phối.
    const t = (await c.query('SELECT status FROM tournaments WHERE id = $1 FOR UPDATE', [m.tournament_id])).rows[0];
    if (t.status === 'completed') throw conflict('TOURNAMENT_CLOSED', 'Giải đã kết thúc');
    if (t.status === 'draft' && role === 'referee') throw forbidden('Giải chưa công bố');
    m.tournament_status = t.status;
    const courts = require('./courtService');
    const occupancy = await courts.lockMatch(c, m.id);
    if (m.court !== null) {
      courts.checkCourt(m.court, occupancy.t_courts);
      await courts.assertCourtFree(c, m.tournament_id, m.court, m.id);
    }
    await courts.assertPlayersFree(c, occupancy);
  }
  return { m, role, rules: effectiveRules(m, m.stage, m.round, m.ko_rounds, m.is_third_place) };
}

/**
 * Nhận sân và bắt đầu trận; cùng khoá theo giải với gọi / chuyển sân để không nhận trùng.
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId @param {{ version: number }} input
 */
async function startMatch(pool, viewer, matchId, input) {
  return withTx(pool, async (c) => {
    const { m, role } = await lockScorable(c, matchId, viewer, { claim: false });
    if (input.version !== m.version) {
      throw conflict('VERSION_CONFLICT', 'Trận vừa được cập nhật — tải lại trước khi bắt đầu');
    }
    if (m.status === 'live') throw conflict('MATCH_ALREADY_STARTED', 'Trận đã bắt đầu');
    const t = (await c.query('SELECT status FROM tournaments WHERE id = $1 FOR UPDATE', [m.tournament_id])).rows[0];
    if (t.status === 'completed') throw conflict('TOURNAMENT_CLOSED', 'Giải đã kết thúc');
    if (t.status === 'draft' && role === 'referee') throw forbidden('Giải chưa công bố');
    if (!m.court) throw conflict('COURT_REQUIRED', 'Trận chưa có sân — liên hệ BTC để gán sân');
    // Nạp muộn vì courtService require tệp này (presentMatch, MATCH_SELECT) → tránh vòng require.
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
    // tournament_started: giải vừa chuyển sang "đang diễn ra" → kênh trực tiếp báo thay đổi toàn bộ (xem routes/matches).
    return { ...rows[0], tournament_started: t.status === 'published' };
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
    const { m, role, rules } = await lockScorable(c, matchId, viewer, { claim: input.action !== 'walkover' });
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
               called_at = CASE WHEN $3 = 'live' THEN COALESCE(called_at, now()) ELSE called_at END,
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
    /** @type {string[]} */ let changed = [matchId];
    if (winnerId) {
      await logEvent(c, m.tournament_id, m.category_id, viewer.id, 'score_confirm',
        { matchId, games: input.action === 'walkover' ? null : games, walkover: input.action === 'walkover', winner: winnerId === m.entry_a_id ? 'a' : 'b' });
      await advanceWinner(c, m, winnerId, viewer.id);
      // Mọi trận giao dịch này đã ghi (đưa đội thắng sang trận sau, walkover dây chuyền khi đối thủ bị truất quyền…)
      // đều mang updated_at = now() của giao dịch → kênh trực tiếp chỉ báo đúng các trận đó.
      const { rows: touched } = await c.query(
        'SELECT id FROM matches WHERE category_id = $1 AND updated_at = now()', [m.category_id],
      );
      changed = [...new Set([matchId, ...touched.map((r) => r.id)])];
    }
    return { ...upd[0], changed_match_ids: changed, tournament_started: m.tournament_status === 'published' };
  });
}

/**
 * Đính chính kết quả mà không mở lại trận, nhận sân hoặc ghi đè biên bản cũ.
 * @param {Pool} pool @param {Viewer} viewer @param {string} matchId
 * @param {{action: 'finish', version: number, games: [number, number][], reason: string}
 *   | {action: 'walkover', version: number, walkoverWinner: 'a'|'b', reason: string}} input
 */
async function correctResult(pool, viewer, matchId, input) {
  return withTx(pool, async (c) => {
    const ref = (await c.query('SELECT tournament_id, category_id, stage FROM matches WHERE id = $1', [matchId])).rows[0];
    if (!ref) throw notFound('Không tìm thấy trận');
    await requireOrganizer(c, ref.tournament_id, viewer);
    const cat = await loadCategory(c, ref.category_id, ref.stage === 'group');
    const m = (await c.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [matchId])).rows[0];
    if (!m) throw notFound('Không tìm thấy trận');
    if (!['finished', 'walkover'].includes(m.status) || !m.entry_a_id || !m.entry_b_id) {
      throw conflict('NOT_FINISHED', 'Chỉ sửa kết quả của trận đã kết thúc hoặc xử bỏ cuộc');
    }
    if (input.version !== m.version) throw conflict('VERSION_CONFLICT', 'Kết quả vừa được cập nhật — tải lại trước khi sửa');
    const reason = input.reason?.trim();
    if (!reason || reason.length < 3 || reason.length > 300) throw unprocessable('Lý do sửa kết quả phải từ 3 đến 300 ký tự');

    const status = input.action === 'finish' ? 'finished' : 'walkover';
    const games = input.action === 'finish' ? input.games : m.games;
    let side;
    if (input.action === 'finish') {
      const koRounds = m.stage === 'knockout'
        ? (await c.query("SELECT max(round) AS rounds FROM matches WHERE category_id = $1 AND stage = 'knockout'", [m.category_id])).rows[0].rounds
        : 0;
      const ev = evaluateMatch(games, effectiveRules(cat, m.stage, m.round, koRounds, m.is_third_place));
      if (!ev.valid || !ev.complete) throw unprocessable(ev.error ?? 'Tỉ số chưa đủ số game thắng');
      side = ev.winner;
    } else {
      side = input.walkoverWinner;
    }
    const winnerId = side === 'a' ? m.entry_a_id : m.entry_b_id;
    const winnerChanged = winnerId !== m.winner_entry_id;
    const gamesChanged = JSON.stringify(games) !== JSON.stringify(m.games);
    if (!winnerChanged && !gamesChanged && status === m.status) throw conflict('RESULT_UNCHANGED', 'Kết quả không thay đổi');

    if (winnerChanged && m.stage === 'knockout') {
      const dq = await c.query('SELECT 1 FROM entries WHERE id = $1 AND disqualified_at IS NOT NULL', [winnerId]);
      if (dq.rows.length) throw conflict('WINNER_DISQUALIFIED', 'Không thể đưa đội đã bị truất quyền đi tiếp');
      await assertDownstreamWaiting(c, downstreamIds(m));
    }
    const qualifiers = async () => JSON.stringify(seedsFromGroups(
      (await groupStandings(c, cat.id)).map((g) => g.standings.filter((r) => !r.disqualified).map((r) => r.entryId)),
      cat.advance_per_group,
    ));
    const beforeSeeds = m.stage === 'group' && cat.stage !== 'groups' ? await qualifiers() : null;
    await c.query(
      `UPDATE matches SET status = $2, games = $3::jsonb, winner_entry_id = $4, version = version + 1, updated_at = now()
        WHERE id = $1`, [m.id, status, JSON.stringify(games), winnerId],
    );
    if (beforeSeeds !== null && beforeSeeds !== await qualifiers()) {
      throw conflict('QUALIFIERS_CHANGED', 'Sửa kết quả sẽ đổi đội hoặc vị trí trong nhánh đã tạo; chưa thể lưu');
    }
    if (winnerChanged && m.next_match_id) await advanceWinner(c, m, winnerId, viewer.id);
    if (gamesChanged) await rallies.recordOverride(c, matchId, games, viewer.id);
    await c.query(
      `INSERT INTO match_score_events (match_id, actor_user_id, action, games) VALUES ($1, $2, 'score_correct', $3::jsonb)`,
      [m.id, viewer.id, JSON.stringify(games)],
    );
    const labels = await c.query('SELECT id, player1_name, player2_name FROM entries WHERE id IN ($1, $2)', [m.entry_a_id, m.entry_b_id]);
    const names = new Map(labels.rows.map((r) => [r.id, [r.player1_name, r.player2_name].filter(Boolean).join(' / ')]));
    await logEvent(c, m.tournament_id, m.category_id, viewer.id, 'score_correct', {
      matchId, reason, teams: [names.get(m.entry_a_id), names.get(m.entry_b_id)],
      before: { status: m.status, games: m.games, winner: m.winner_entry_id === m.entry_a_id ? 'a' : 'b' },
      after: { status, games, winner: side },
    });
    return { tournament_id: m.tournament_id };
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
    const dq = await c.query('SELECT 1 FROM entries WHERE id IN ($1, $2) AND disqualified_at IS NOT NULL', [m.entry_a_id, m.entry_b_id]);
    if (dq.rows.length) throw conflict('ENTRY_DISQUALIFIED', 'Trận có đội bị truất quyền — dùng Sửa kết quả để đính chính lịch sử');
    // Phục hồi cũng là nhận sân/VĐV: dùng cùng khoá với gọi sân và bắt đầu trận.
    await c.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [m.tournament_id]);
    if (m.stage === 'group') {
      const cat = await loadCategory(c, m.category_id, true);
      if (cat.stage !== 'groups') throw conflict('KNOCKOUT_STARTED', 'Đã tạo nhánh loại trực tiếp, không thể sửa vòng bảng');
    }
    const ids = downstreamIds(m);
    if (ids.length) {
      await assertDownstreamWaiting(c, ids);
      const col = m.next_slot === 'a' ? 'entry_a_id' : 'entry_b_id';
      await c.query(`UPDATE matches SET ${col} = NULL, version = version + 1, updated_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
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

// ───────────────────────────── Đọc (công khai) ─────────────────────────────

/**
 * SELECT trận đầy đủ cho `presentMatch`, đọc từ `source` — bảng `matches` hoặc CTE `upd` có cùng cột
 * (UPDATE matches … RETURNING *) để câu ghi trả luôn trận đã cập nhật. `source` là hằng trong code, không phải input.
 * @param {'matches'|'upd'} source
 */
const matchSelectFrom = (source) => `
  SELECT m.id, m.tournament_id, m.category_id, cat.code AS category_code, cat.name AS category_name,
         m.stage, g.name AS group_name, m.round, m.position, m.is_third_place, m.status, m.games, m.court, m.scheduled_at, m.called_at,
         m.version, m.updated_at, m.referee_user_id, ru.full_name AS referee_name,
         m.entry_a_id, m.entry_b_id, m.winner_entry_id,
         ea.player1_name AS a_p1, ea.player2_name AS a_p2, ea.club AS a_club, ea.disqualified_at IS NOT NULL AS a_dq,
         eb.player1_name AS b_p1, eb.player2_name AS b_p2, eb.club AS b_club, eb.disqualified_at IS NOT NULL AS b_dq,
         ea.player1_athlete_id AS a_p1_aid, ea.player2_athlete_id AS a_p2_aid,
         eb.player1_athlete_id AS b_p1_aid, eb.player2_athlete_id AS b_p2_aid,
         cat.points_to_win, cat.max_points, cat.games_to_win, cat.round_rules, mt.status AS tournament_status,
         (SELECT max(k.round) FROM matches k WHERE k.category_id = m.category_id AND k.stage = 'knockout') AS ko_rounds
    FROM ${source} m
    JOIN categories cat ON cat.id = m.category_id
    JOIN tournaments mt ON mt.id = m.tournament_id
    LEFT JOIN groups g ON g.id = m.group_id
    LEFT JOIN entries ea ON ea.id = m.entry_a_id
    LEFT JOIN entries eb ON eb.id = m.entry_b_id
    LEFT JOIN users ru ON ru.id = m.referee_user_id`;
const MATCH_SELECT = matchSelectFrom('matches');

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
    isThirdPlace: Boolean(r.is_third_place),
    roundLabel: r.is_third_place ? 'Tranh hạng Ba–Tư' : r.stage === 'knockout' ? roundLabel(r.round, r.ko_rounds) : `Lượt ${r.round}`,
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
    rules: effectiveRules(r, r.stage, r.round, r.ko_rounds, r.is_third_place),
  };
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
  const third = rows.find((r) => r.is_third_place);
  const matches = rows.filter((r) => !r.is_third_place).map(presentMatch);
  const total = matches.reduce((mx, m) => Math.max(mx, m.round), 0);
  const rounds = [];
  for (let r = 1; r <= total; r += 1) {
    rounds.push({ round: r, label: roundLabel(r, total), matches: matches.filter((m) => m.round === r) });
  }
  return { rounds, thirdPlace: third ? presentMatch(third) : null };
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

module.exports = {
  MATCH_SELECT, matchSelectFrom, presentMatch, getMatch, listMatches, getBracket, refereeQueue,
  startMatch, recordScore, correctResult, reopenMatch, assignReferee, lockScorable, advanceWinner, settleDisqualifiedMatch,
};

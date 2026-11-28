'use strict';
/**
 * Nghiệp vụ ĐỘI / VĐV trong một nội dung: thêm, xoá, sửa đội; truất quyền / huỷ truất quyền; đổi bảng.
 * Tách từ tournamentService; nơi gọi require thẳng tệp này.
 */

const { notFound, conflict, unprocessable } = require('../errors');
const { withTx, requireOrganizer, logEvent, entryLabel } = require('./tournamentService');
const { STARTED_SQL, DISQUALIFIABLE_ENTRY_SQL, insertRoundRobin } = require('./shared');
const { loadCategory } = require('./categoryService');
const { settleDisqualifiedMatch } = require('./matchService');

/** @typedef {import('./tournamentService').Pool} Pool */
/** @typedef {import('./tournamentService').Queryable} Queryable */
/** @typedef {import('./tournamentService').Viewer} Viewer */

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

/**
 * Huỷ các trận vòng bảng chưa chốt kết quả có đội bị truất quyền; lưu trạng thái cũ để khôi phục.
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
      WHERE m.category_id = $1 AND m.stage = 'group' AND m.status IN ('pending', 'scheduled', 'live')
        AND EXISTS (SELECT 1 FROM entries e WHERE e.id IN (m.entry_a_id, m.entry_b_id) AND e.disqualified_at IS NOT NULL
                      AND ($2::uuid IS NULL OR e.id = $2::uuid))`,
    [categoryId, entryId],
  );
  return rowCount ?? 0;
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
 *  - Vòng bảng: chỉ huỷ trận chưa chốt kết quả.
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
    return disqualifyRegistration(c, viewer, e, reason);
  });
}

/**
 * Truất quyền theo hồ sơ VĐV: cập nhật các đội đủ điều kiện trong phạm vi đã chọn, trong một giao dịch.
 * @param {Pool} pool @param {Viewer} viewer @param {string} athleteId
 * @param {{scope: 'category', categoryId: string, reason: string} | {scope: 'tournament', reason: string}} input
 */
async function disqualifyAthlete(pool, viewer, athleteId, input) {
  return withTx(pool, async (c) => {
    const a = (await c.query('SELECT id, tournament_id, full_name FROM athletes WHERE id = $1', [athleteId])).rows[0];
    if (!a) throw notFound('Không tìm thấy VĐV');
    await requireOrganizer(c, a.tournament_id, viewer);
    const { rows } = await c.query(
      `SELECT e.*, c.stage, c.id AS cat_id, c.tournament_id
         FROM entries e JOIN categories c ON c.id = e.category_id
        WHERE c.tournament_id = $1 AND $2 IN (e.player1_athlete_id, e.player2_athlete_id)
          AND ($3::uuid IS NULL OR c.id = $3)
        ORDER BY c.id, e.id FOR UPDATE OF c, e`,
      [a.tournament_id, athleteId, input.scope === 'category' ? input.categoryId : null],
    );
    const entries = [];
    for (const e of rows) {
      if (e.disqualified_at || e.stage === 'completed') continue;
      // Đọc trạng thái trận sau khi đã khoá nội dung/đội để không áp quyết định lên vòng đã kết thúc.
      const { rows: eligible } = await c.query(
        `SELECT 1 FROM entries e JOIN categories c ON c.id = e.category_id
          WHERE e.id = $1 AND ${DISQUALIFIABLE_ENTRY_SQL}`, [e.id],
      );
      if (eligible.length) entries.push(await disqualifyRegistration(c, viewer, e, input.reason, {
        athleteId: a.id, athleteName: a.full_name, scope: input.scope,
      }));
    }
    if (!entries.length) throw conflict('NO_DISQUALIFIABLE_ENTRY', 'VĐV không còn đội nào có thể truất quyền trong phạm vi này');
    return { tournamentId: a.tournament_id, entries };
  });
}

/** @param {Queryable} c @param {Viewer} viewer @param {any} e @param {string} reason
 * @param {{athleteId: string, athleteName: string, scope: string}} [source] */
async function disqualifyRegistration(c, viewer, e, reason, source) {
  // Lý do về cá nhân chỉ ghi nhật ký BTC, không đưa vào bảng đấu công khai.
  await c.query('UPDATE entries SET disqualified_at = now(), dq_reason = $2 WHERE id = $1', [e.id, source ? null : reason]);
  let cancelled = 0;
  let walkover = null;
  if (e.stage === 'groups') {
    cancelled = await cancelDisqualifiedGroupMatches(c, e.cat_id, e.id);
  } else if (e.stage === 'knockout') {
    const { rows } = await c.query(
      `SELECT * FROM matches WHERE category_id = $1 AND stage = 'knockout' AND status IN ('pending', 'scheduled', 'live')
          AND $2 IN (entry_a_id, entry_b_id) FOR UPDATE`, [e.cat_id, e.id],
    );
    const m = rows[0];
    if (await settleDisqualifiedMatch(c, m, viewer.id)) walkover = m.id;
  }
  await logEvent(c, e.tournament_id, e.cat_id, viewer.id, 'disqualify', {
    entryId: e.id, name: entryLabel(e), reason, cancelledMatches: cancelled, walkoverMatchId: walkover, ...source,
  });
  return { entryId: e.id, cancelledMatches: cancelled, walkoverMatchId: walkover };
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
    if (!['setup', 'groups'].includes(e.stage)) throw conflict('KNOCKOUT_STARTED', 'Chỉ huỷ truất quyền được khi chưa tạo nhánh loại trực tiếp');
    if (e.stage === 'groups') {
      const member = await c.query('SELECT 1 FROM group_members WHERE entry_id = $1', [entryId]);
      if (!member.rows.length) throw conflict('ENTRY_NOT_DRAWN', 'Đội không có tên trong lần bốc thăm hiện tại, không thể khôi phục vào bảng');
    }
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
    if (e.disqualified_at) throw conflict('ENTRY_DISQUALIFIED', 'Đội đã bị truất quyền, không thể thay VĐV');
    if (e.is_doubles !== Boolean(input.player2Name)) {
      throw unprocessable(`Nội dung ${e.is_doubles ? 'đôi cần 2' : 'đơn chỉ cần 1'} VĐV`);
    }
    if (e.stage !== 'setup') {
      const started = await c.query(
        `SELECT 1 FROM matches WHERE $1 IN (entry_a_id, entry_b_id) AND ${STARTED_SQL} LIMIT 1`, [entryId],
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

module.exports = {
  addEntries, removeEntry, updateEntry, disqualifyEntry, disqualifyAthlete, reinstateEntry, swapEntries, loadEntryForUpdate, pruneAthletes,
};

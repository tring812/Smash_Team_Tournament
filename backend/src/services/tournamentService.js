'use strict';
/**
 * Nghiệp vụ giải đấu: quản lý giải, BTC / trọng tài, quyền xem, bốc thăm, xếp lịch, BXH & loại trực tiếp,
 * cùng các tiện ích dùng chung (withTx, roleIn, requireOrganizer, logEvent…).
 * Nội dung thi đấu → categoryService, đội → entryService, trận → matchService (require thẳng tệp đó).
 * Chỉ phụ thuộc interface `{ query(text, params) }` và `pool.connect()`
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
const { randomDraw, partitionKey, shuffle } = require('../domain/draw');
const { scheduleMatches, countNoRest } = require('../domain/schedule');
const { computeStandings } = require('../domain/standings');
const { seedsFromGroups, buildBracket } = require('../domain/bracket');
const { notFound, forbidden, conflict, unprocessable } = require('../errors');
const { STARTED_SQL, insertRoundRobin, entryPlayers } = require('./shared');

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

/**
 * Nạp muộn loadCategory từ categoryService (categoryService require tệp này → tránh vòng require lúc nạp).
 * @param {Queryable} db @param {string} categoryId @param {boolean} [lock]
 */
function loadCategory(db, categoryId, lock = false) {
  return require('./categoryService').loadCategory(db, categoryId, lock);
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

/**
 * Khoá NGƯỜI CHƠI cho chống trùng lịch / gọi sân: hồ sơ VĐV (MSSV/SĐT) nếu có, rồi tài khoản, cuối cùng tên chuẩn hoá.
 * @param {string|null|undefined} aid athlete id @param {string|null|undefined} uid @param {string|null|undefined} name
 */
const participantKey = (aid, uid, name) => (aid ? `a:${aid}` : uid ? `u:${uid}` : name ? nameKey(name) : null);

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

// ───────────────────────────── Bốc thăm & lịch ─────────────────────────────

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

/**
 * Giải theo slug; giải draft chỉ BTC/admin xem được.
 * @param {Queryable} db @param {string} slug @param {Viewer|null} viewer
 */
async function getTournament(db, slug, viewer) {
  // Một truy vấn lấy luôn vai trò của người xem (thay cho roleIn riêng).
  const t = (await db.query(
    `SELECT t.*, s.role AS staff_role FROM tournaments t
       LEFT JOIN tournament_staff s ON s.tournament_id = t.id AND s.user_id = $2::uuid
      WHERE t.slug = $1 AND t.deleted_at IS NULL`,
    [slug, viewer?.id ?? null],
  )).rows[0];
  if (!t) throw notFound('Không tìm thấy giải');
  const role = viewerRole(viewer, t.staff_role);
  if (t.status === 'draft' && role !== 'admin' && role !== 'organizer') throw notFound('Không tìm thấy giải');
  const { rows: categories } = await db.query(
    `SELECT c.*, (SELECT count(*)::int FROM entries e WHERE e.category_id = c.id) AS entry_count
       FROM categories c WHERE tournament_id = $1 ORDER BY code`, [t.id],
  );
  const { deleted_at: _deletedAt, deleted_by: _deletedBy, staff_role: _staffRole, ...info } = t;
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
 * Vai trò của người xem trong giải, từ vai trò hệ thống + dòng tournament_staff (giống roleIn nhưng không truy vấn).
 * @param {Viewer|null} viewer @param {string|null|undefined} staffRole
 */
function viewerRole(viewer, staffRole) {
  if (!viewer) return null;
  if (viewer.role === 'admin') return 'admin';
  return staffRole ?? null;
}

/**
 * Ném 404 nếu giải không có / đã xoá, hoặc là draft mà người xem không phải BTC/admin (không lộ sự tồn tại).
 * @param {{ status: string, deleted_at: unknown, staff_role: string|null }|undefined} t @param {Viewer|null} viewer
 */
function checkVisible(t, viewer) {
  if (!t || t.deleted_at) throw notFound('Không tìm thấy giải');
  if (t.status !== 'draft') return;
  const role = viewerRole(viewer, t.staff_role);
  if (role !== 'admin' && role !== 'organizer') throw notFound('Không tìm thấy giải');
}

/**
 * Ném 404 nếu giải là draft và viewer không phải BTC/admin (không lộ sự tồn tại). Một truy vấn.
 * @param {Queryable} db @param {string} tid @param {Viewer|null} viewer
 */
async function assertVisible(db, tid, viewer) {
  const { rows } = await db.query(
    `SELECT t.status, t.deleted_at, s.role AS staff_role FROM tournaments t
       LEFT JOIN tournament_staff s ON s.tournament_id = t.id AND s.user_id = $2::uuid
      WHERE t.id = $1`,
    [tid, viewer?.id ?? null],
  );
  checkVisible(rows[0], viewer);
}

/**
 * Như assertVisible nhưng đi từ nội dung thi đấu; trả id giải. Một truy vấn thay cho loadCategory + assertVisible.
 * @param {Queryable} db @param {string} categoryId @param {Viewer|null} viewer @returns {Promise<string>}
 */
async function assertCategoryVisible(db, categoryId, viewer) {
  const { rows } = await db.query(
    `SELECT c.tournament_id, t.status, t.deleted_at, s.role AS staff_role FROM categories c
       JOIN tournaments t ON t.id = c.tournament_id
       LEFT JOIN tournament_staff s ON s.tournament_id = t.id AND s.user_id = $2::uuid
      WHERE c.id = $1`,
    [categoryId, viewer?.id ?? null],
  );
  if (!rows[0]) throw notFound('Không tìm thấy nội dung thi đấu');
  checkVisible(rows[0], viewer);
  return rows[0].tournament_id;
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
  assertVisible, assertCategoryVisible, tournamentOfCategory, listEntries, listStaff, searchUsers, listEvents,
  withTx, roleIn, requireOrganizer, logEvent, nameKey, participantKey, entryLabel, FINAL_STATUSES,
  createTournament, updateTournament, deleteTournament, restoreTournament, listDeletedTournaments, purgeDeletedTournaments, upsertStaff, removeStaff,
  drawGroups, scheduleTournament, groupStandings, generateKnockout,
  getTournament, listTournaments,
};

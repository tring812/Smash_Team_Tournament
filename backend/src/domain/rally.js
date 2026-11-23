'use strict';
/**
 * Biên bản diễn biến điểm (rally) — thuần logic, không I/O. Bản TS: frontend/app/lib/rally.ts (sửa cả hai).
 *
 * Ô VĐV (slot): 'a1', 'a2', 'b1', 'b2' — đội a/b, VĐV 1/2 của đội (đánh đơn chỉ có 'a1', 'b1').
 * Sự kiện (theo thứ tự seq):
 *   start      { server, receiver }  chọn người giao / nhận đầu game (game mới, hoặc game đang dở sau khi BTC sửa tay)
 *   point      { side }              đội `side` thắng pha cầu
 *   fix_server { server }            trọng tài sửa người giao (áp vào pha mới nhất trở đi)
 *   override   { games }             BTC sửa tỉ số bằng tay (PUT /score) — biên bản ghi mốc, điểm sau đó tính tiếp
 *
 * Luật giao cầu đánh đôi (BWF):
 *   - Đầu game: người giao đứng ô PHẢI; người nhận đứng chéo (ô phải bên kia).
 *   - Đội giao thắng pha: CÙNG người giao, hai VĐV đội giao đổi ô cho nhau.
 *   - Đội nhận thắng pha: được giao, KHÔNG đổi ô; người giao = VĐV đang đứng ở ô theo điểm của đội mình
 *     (chẵn → PHẢI, lẻ → TRÁI).
 * Biên bản (theo mẫu giấy): mỗi pha một cột; điểm mới của đội thắng ghi ở HÀNG người sẽ giao pha kế tiếp.
 */
const { gameState } = require('./scoring');

/** @typedef {'a'|'b'} Side */
/** @typedef {'a1'|'a2'|'b1'|'b2'} Slot */
/** @typedef {{ pointsToWin: number, maxPoints: number, gamesToWin: number }} Rules */
/**
 * @typedef {{ seq: number, type: 'start'|'point'|'fix_server'|'override', side?: Side|null, server?: Slot|null,
 *   receiver?: Slot|null, games?: [number, number][]|null }} RallyEvent
 */
/**
 * Một cột của biên bản.
 * @typedef {{ seq: number, kind: 'point'|'override', side: Side|null, score: [number, number], row: Slot|null,
 *   fixed: boolean, interval: boolean }} SheetCol
 */
/** @typedef {{ game: number, server: Slot, receiver: Slot, fixedStart: boolean, cols: SheetCol[] }} SheetBlock */

class RallyError extends Error {}

const SLOTS = ['a1', 'a2', 'b1', 'b2'];
/** @param {Slot} s @returns {Side} */
const sideOf = (s) => /** @type {Side} */ (s[0]);
/** @param {Side} s @returns {Side} */
const otherSide = (s) => (s === 'a' ? 'b' : 'a');
/** @param {Slot} s @returns {Slot} */
const partnerOf = (s) => /** @type {Slot} */ (`${s[0]}${s[1] === '1' ? '2' : '1'}`);
/** Ô theo điểm của đội giao: chẵn → phải, lẻ → trái. */
const courtFor = (score) => (score % 2 === 0 ? 'right' : 'left');
/** Mốc nghỉ giữa game: nửa số điểm thắng (21 → 11, 15 → 8, 11 → 6). */
const intervalAt = (pointsToWin) => Math.ceil(pointsToWin / 2);
/** Game thứ `index` (0-based) là game quyết định (đổi sân ở mốc nghỉ). */
const isDecidingGame = (index, gamesToWin) => gamesToWin > 1 && index === gamesToWin * 2 - 2;

/** Trạng thái rỗng (chưa có sự kiện nào). */
function emptyState() {
  return {
    /** @type {[number, number][]} */ games: [],
    /** @type {Slot|null} */ server: null,
    /** @type {Slot|null} */ receiver: null,
    /** Ô PHẢI / TRÁI hiện tại của từng đội (đánh đôi). */
    /** @type {{ a: { right: Slot, left: Slot }, b: { right: Slot, left: Slot } }} */
    pos: { a: { right: 'a1', left: 'a2' }, b: { right: 'b1', left: 'b2' } },
    /** Game hiện tại đã chọn người giao (start) và đang đánh. */
    active: false,
    matchOver: false,
    /** @type {SheetBlock[]} */ sheet: [],
  };
}

/** @param {[number, number][]} games @param {Rules} rules */
function winsOf(games, rules) {
  let a = 0;
  let b = 0;
  for (const g of games) {
    const s = gameState(g, rules);
    if (s === 'a') a += 1;
    if (s === 'b') b += 1;
  }
  return { a, b, over: a >= rules.gamesToWin || b >= rules.gamesToWin };
}

/** Đặt vị trí đội giao theo người giao + điểm; người nhận = VĐV đội kia đứng chéo (cùng tên ô). */
function placeServer(st, server, doubles) {
  const side = sideOf(server);
  const g = st.games[st.games.length - 1] ?? [0, 0];
  const court = courtFor(g[side === 'a' ? 0 : 1]);
  if (doubles) {
    st.pos[side] = court === 'right' ? { right: server, left: partnerOf(server) } : { right: partnerOf(server), left: server };
    st.receiver = st.pos[otherSide(side)][court];
  } else {
    st.receiver = /** @type {Slot} */ (`${otherSide(side)}1`);
  }
  st.server = server;
}

/**
 * Áp một sự kiện lên trạng thái (sao chép, không sửa đầu vào). Sai luật → RallyError.
 * @param {ReturnType<typeof emptyState>} prev @param {RallyEvent} ev @param {Rules} rules @param {boolean} doubles
 */
function applyEvent(prev, ev, rules, doubles) {
  /** @type {ReturnType<typeof emptyState>} */
  const st = JSON.parse(JSON.stringify(prev));
  const validSlot = (s) => SLOTS.includes(s) && (doubles || s[1] === '1');
  const cur = st.games[st.games.length - 1];
  const inProgress = Boolean(cur) && gameState(cur, rules) === 'in_progress';

  if (ev.type === 'start') {
    if (st.matchOver) throw new RallyError('Trận đã đủ số game thắng');
    if (st.active) throw new RallyError('Game đang đánh — dùng "Sửa bên giao" để đổi người giao');
    const { server, receiver } = ev;
    if (!server || !validSlot(server)) throw new RallyError('Chọn người giao cầu');
    if (doubles) {
      if (!receiver || !validSlot(receiver)) throw new RallyError('Chọn người nhận cầu');
      if (sideOf(receiver) === sideOf(server)) throw new RallyError('Người nhận phải ở đội bên kia');
    }
    if (!inProgress) st.games.push([0, 0]);
    const g = st.games[st.games.length - 1];
    const side = sideOf(server);
    const court = courtFor(g[side === 'a' ? 0 : 1]);
    if (doubles) {
      st.pos[side] = court === 'right' ? { right: server, left: partnerOf(server) } : { right: partnerOf(server), left: server };
      const rSide = otherSide(side);
      st.pos[rSide] = court === 'right' ? { right: receiver, left: partnerOf(receiver) } : { right: partnerOf(receiver), left: receiver };
      st.receiver = receiver;
    } else {
      st.receiver = /** @type {Slot} */ (`${otherSide(side)}1`);
    }
    st.server = server;
    st.active = true;
    st.sheet.push({ game: st.games.length, server, receiver: /** @type {Slot} */ (st.receiver), fixedStart: false, cols: [] });
    return st;
  }

  if (ev.type === 'point') {
    if (!st.active || !st.server || !cur) throw new RallyError('Chưa chọn người giao cầu cho game này');
    const side = ev.side;
    if (side !== 'a' && side !== 'b') throw new RallyError('Thiếu đội thắng pha cầu');
    const before = [...cur];
    cur[side === 'a' ? 0 : 1] += 1;
    if (gameState(cur, rules) === 'invalid') throw new RallyError('Tỉ số không hợp lệ');
    const servingSide = sideOf(st.server);
    if (side === servingSide) {
      if (doubles) st.pos[side] = { right: st.pos[side].left, left: st.pos[side].right }; // đổi ô, cùng người giao
    } else {
      st.server = doubles ? st.pos[side][courtFor(cur[side === 'a' ? 0 : 1])] : /** @type {Slot} */ (`${side}1`);
    }
    st.receiver = doubles ? st.pos[otherSide(sideOf(st.server))][courtFor(cur[sideOf(st.server) === 'a' ? 0 : 1])] : /** @type {Slot} */ (`${otherSide(side)}1`);
    const mid = intervalAt(rules.pointsToWin);
    const block = st.sheet[st.sheet.length - 1];
    block?.cols.push({
      seq: ev.seq, kind: 'point', side, score: [cur[0], cur[1]], row: st.server, fixed: false,
      interval: Math.max(...cur) === mid && Math.max(...before) < mid && gameState(cur, rules) === 'in_progress',
    });
    if (gameState(cur, rules) !== 'in_progress') {
      st.active = false;
      st.matchOver = winsOf(st.games, rules).over;
    }
    return st;
  }

  if (ev.type === 'fix_server') {
    const block = st.sheet[st.sheet.length - 1];
    if (!block || !st.server) throw new RallyError('Chưa có người giao để sửa');
    if (!ev.server || !validSlot(ev.server)) throw new RallyError('Chọn người giao cầu');
    placeServer(st, ev.server, doubles);
    const last = [...block.cols].reverse().find((c) => c.kind === 'point');
    // Sửa áp vào pha mới nhất (số của pha đó chuyển sang hàng người giao đúng); chưa có pha nào → sửa cột 0.
    if (last && block.cols[block.cols.length - 1] === last) {
      last.row = ev.server;
      last.fixed = true;
    } else if (!block.cols.length) {
      block.server = ev.server;
      block.receiver = /** @type {Slot} */ (st.receiver);
      block.fixedStart = true;
    }
    return st;
  }

  if (ev.type === 'override') {
    const games = Array.isArray(ev.games) ? ev.games.map((g) => /** @type {[number, number]} */ ([g[0], g[1]])) : [];
    st.games = games;
    const last = games[games.length - 1];
    const live = Boolean(last) && gameState(last, rules) === 'in_progress';
    st.active = live && Boolean(st.server);
    st.matchOver = winsOf(games, rules).over;
    const block = st.sheet[st.sheet.length - 1];
    if (block) {
      block.cols.push({ seq: ev.seq, kind: 'override', side: null, score: last ? [last[0], last[1]] : [0, 0], row: null, fixed: false, interval: false });
    }
    return st;
  }
  throw new RallyError('Loại sự kiện không hợp lệ');
}

/**
 * Dựng lại toàn bộ trạng thái từ danh sách sự kiện (đã sắp theo seq).
 * @param {RallyEvent[]} events @param {Rules} rules @param {boolean} doubles
 */
function replay(events, rules, doubles) {
  let st = emptyState();
  for (const ev of events) st = applyEvent(st, ev, rules, doubles);
  return st;
}

module.exports = { RallyError, SLOTS, emptyState, applyEvent, replay, intervalAt, isDecidingGame, courtFor };

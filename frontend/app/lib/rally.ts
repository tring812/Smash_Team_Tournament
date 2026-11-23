/**
 * Bản TS của backend/src/domain/rally.js — để Bàn điểm phản hồi tức thì (kể cả khi mất mạng) và vẽ biên bản.
 * Máy chủ luôn tính lại và là nguồn sự thật. Sửa luật ở đây thì sửa cả bản JS (và test của nó).
 *
 * Ô VĐV: "a1" "a2" "b1" "b2" (đơn chỉ có "a1", "b1"). Luật giao cầu đánh đôi (BWF):
 *  - Đầu game: người giao ở ô PHẢI, người nhận đứng chéo (ô phải bên kia).
 *  - Đội giao thắng pha: CÙNG người giao, hai VĐV đội giao đổi ô.
 *  - Đội nhận thắng pha: được giao, KHÔNG đổi ô; người giao = VĐV ở ô theo điểm đội mình (chẵn PHẢI, lẻ TRÁI).
 * Biên bản: mỗi pha một cột; điểm mới của đội thắng ghi ở HÀNG người sẽ giao pha kế tiếp.
 */
import { gameState } from "./scoring";
import type { Game, Rally, ScoringRules, Slot } from "./types";

export type Side = "a" | "b";
export interface SheetCol {
  seq: number; kind: "point" | "override"; side: Side | null; score: Game; row: Slot | null;
  fixed: boolean; interval: boolean;
}
export interface SheetBlock { game: number; server: Slot; receiver: Slot; fixedStart: boolean; cols: SheetCol[] }
export interface RallyState {
  games: Game[];
  server: Slot | null;
  receiver: Slot | null;
  pos: Record<Side, { right: Slot; left: Slot }>;
  active: boolean;
  matchOver: boolean;
  sheet: SheetBlock[];
}
/** Sự kiện tối thiểu để dựng lại (từ máy chủ hoặc đang chờ gửi). */
export type RallyInput = Pick<Rally, "seq" | "type"> & Partial<Pick<Rally, "side" | "server" | "receiver" | "games">>;

export class RallyError extends Error {}

const SLOTS: Slot[] = ["a1", "a2", "b1", "b2"];
export const sideOf = (s: Slot) => s[0] as Side;
export const otherSide = (s: Side): Side => (s === "a" ? "b" : "a");
const partnerOf = (s: Slot) => `${s[0]}${s[1] === "1" ? "2" : "1"}` as Slot;
const courtFor = (score: number) => (score % 2 === 0 ? "right" : "left") as "right" | "left";
export const intervalAt = (pointsToWin: number) => Math.ceil(pointsToWin / 2);
export const isDecidingGame = (index: number, gamesToWin: number) => gamesToWin > 1 && index === gamesToWin * 2 - 2;

export function emptyState(): RallyState {
  return {
    games: [], server: null, receiver: null,
    pos: { a: { right: "a1", left: "a2" }, b: { right: "b1", left: "b2" } },
    active: false, matchOver: false, sheet: [],
  };
}

function winsOver(games: Game[], rules: ScoringRules) {
  let a = 0;
  let b = 0;
  for (const g of games) {
    const s = gameState(g, rules);
    if (s === "a") a += 1;
    if (s === "b") b += 1;
  }
  return a >= rules.gamesToWin || b >= rules.gamesToWin;
}

const scoreOf = (g: Game, side: Side) => g[side === "a" ? 0 : 1];

export function applyEvent(prev: RallyState, ev: RallyInput, rules: ScoringRules, doubles: boolean): RallyState {
  const st: RallyState = JSON.parse(JSON.stringify(prev));
  const validSlot = (s: Slot | null | undefined): s is Slot => Boolean(s) && SLOTS.includes(s!) && (doubles || s![1] === "1");
  const cur = st.games[st.games.length - 1];
  const inProgress = Boolean(cur) && gameState(cur!, rules) === "in_progress";

  if (ev.type === "start") {
    if (st.matchOver) throw new RallyError("Trận đã đủ số game thắng");
    if (st.active) throw new RallyError("Game đang đánh — dùng \"Sửa người giao\"");
    if (!validSlot(ev.server)) throw new RallyError("Chọn người giao cầu");
    const server = ev.server;
    if (doubles && (!validSlot(ev.receiver) || sideOf(ev.receiver) === sideOf(server))) throw new RallyError("Chọn người nhận cầu ở đội bên kia");
    if (!inProgress) st.games.push([0, 0]);
    const g = st.games[st.games.length - 1]!;
    const side = sideOf(server);
    const court = courtFor(scoreOf(g, side));
    if (doubles) {
      const receiver = ev.receiver as Slot;
      st.pos[side] = court === "right" ? { right: server, left: partnerOf(server) } : { right: partnerOf(server), left: server };
      st.pos[otherSide(side)] = court === "right" ? { right: receiver, left: partnerOf(receiver) } : { right: partnerOf(receiver), left: receiver };
      st.receiver = receiver;
    } else {
      st.receiver = `${otherSide(side)}1` as Slot;
    }
    st.server = server;
    st.active = true;
    st.sheet.push({ game: st.games.length, server, receiver: st.receiver!, fixedStart: false, cols: [] });
    return st;
  }

  if (ev.type === "point") {
    if (!st.active || !st.server || !cur) throw new RallyError("Chưa chọn người giao cầu cho game này");
    const side = ev.side;
    if (side !== "a" && side !== "b") throw new RallyError("Thiếu đội thắng pha cầu");
    const g = st.games[st.games.length - 1]!;
    const before: Game = [g[0], g[1]];
    g[side === "a" ? 0 : 1] += 1;
    if (gameState(g, rules) === "invalid") throw new RallyError("Tỉ số không hợp lệ");
    if (side === sideOf(st.server)) {
      if (doubles) st.pos[side] = { right: st.pos[side].left, left: st.pos[side].right };
    } else {
      st.server = doubles ? st.pos[side][courtFor(scoreOf(g, side))] : (`${side}1` as Slot);
    }
    const sSide = sideOf(st.server);
    st.receiver = doubles ? st.pos[otherSide(sSide)][courtFor(scoreOf(g, sSide))] : (`${otherSide(side)}1` as Slot);
    const mid = intervalAt(rules.pointsToWin);
    st.sheet[st.sheet.length - 1]?.cols.push({
      seq: ev.seq, kind: "point", side, score: [g[0], g[1]], row: st.server, fixed: false,
      interval: Math.max(...g) === mid && Math.max(...before) < mid && gameState(g, rules) === "in_progress",
    });
    if (gameState(g, rules) !== "in_progress") {
      st.active = false;
      st.matchOver = winsOver(st.games, rules);
    }
    return st;
  }

  if (ev.type === "fix_server") {
    const block = st.sheet[st.sheet.length - 1];
    if (!block || !st.server) throw new RallyError("Chưa có người giao để sửa");
    if (!validSlot(ev.server)) throw new RallyError("Chọn người giao cầu");
    const server = ev.server;
    const side = sideOf(server);
    const g = st.games[st.games.length - 1] ?? [0, 0];
    const court = courtFor(scoreOf(g, side));
    if (doubles) {
      st.pos[side] = court === "right" ? { right: server, left: partnerOf(server) } : { right: partnerOf(server), left: server };
      st.receiver = st.pos[otherSide(side)][court];
    } else {
      st.receiver = `${otherSide(side)}1` as Slot;
    }
    st.server = server;
    const last = block.cols[block.cols.length - 1];
    if (last?.kind === "point") {
      last.row = server;
      last.fixed = true;
    } else if (!block.cols.length) {
      block.server = server;
      block.receiver = st.receiver!;
      block.fixedStart = true;
    }
    return st;
  }

  if (ev.type === "override") {
    const games: Game[] = (ev.games ?? []).map((g) => [g[0], g[1]]);
    st.games = games;
    const last = games[games.length - 1];
    st.active = Boolean(last) && gameState(last!, rules) === "in_progress" && Boolean(st.server);
    st.matchOver = winsOver(games, rules);
    st.sheet[st.sheet.length - 1]?.cols.push({
      seq: ev.seq, kind: "override", side: null, score: last ? [last[0], last[1]] : [0, 0], row: null, fixed: false, interval: false,
    });
    return st;
  }
  throw new RallyError("Loại sự kiện không hợp lệ");
}

export function replay(events: RallyInput[], rules: ScoringRules, doubles: boolean): RallyState {
  let st = emptyState();
  for (const ev of events) st = applyEvent(st, ev, rules, doubles);
  return st;
}

/** Tên VĐV theo ô (đánh đơn: tên đội). */
export function slotName(match: { a: { name: string; players?: { name: string }[] } | null; b: { name: string; players?: { name: string }[] } | null }, slot: Slot): string {
  const team = match[sideOf(slot)];
  if (!team) return slot;
  const p = team.players?.[slot[1] === "1" ? 0 : 1];
  return p?.name ?? team.name;
}

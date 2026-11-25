import { gameState } from "./scoring";
import type { Game, Match } from "./types";

/** Chỉ xác nhận khi toàn bộ tỉ số hợp lệ và không có game dư sau khi trận đã được quyết định. */
export function completeScore(games: Game[], rules: Match["rules"]): boolean {
  if (!games.length || games.length > rules.gamesToWin * 2 - 1) return false;
  let a = 0;
  let b = 0;
  for (const game of games) {
    if (a === rules.gamesToWin || b === rules.gamesToWin) return false;
    const state = gameState(game, rules);
    if (state !== "a" && state !== "b") return false;
    if (state === "a") a += 1;
    else b += 1;
  }
  return a === rules.gamesToWin || b === rules.gamesToWin;
}

/** Cổng thao tác phía giao diện; máy chủ vẫn kiểm tra quyền, phiên bản và trạng thái độc lập. */
export function matchControls(
  match: Pick<Match, "status" | "tournamentStatus" | "a" | "b" | "court" | "rules">,
  games: Game[],
  pending: number,
  busy: boolean,
  sync: "idle" | "saving" | "saved" | "offline" | "error",
) {
  const closed = ["finished", "walkover", "bye", "cancelled"].includes(match.status);
  const available = !closed && match.tournamentStatus !== "completed" && Boolean(match.a && match.b);
  const started = available && match.status === "live";
  const complete = completeScore(games, match.rules);
  return {
    closed,
    started,
    canStart: available && !started && match.court !== null && !busy && pending === 0,
    canScore: started && !complete && !busy,
    canFinish: started && complete && pending === 0 && !busy && !["saving", "offline", "error"].includes(sync),
  };
}

/**
 * Bản TS của backend/src/domain/scoring.js — CHỈ để UI trọng tài phản hồi tức thì
 * (tự sang game mới, gợi ý kết thúc trận). Server luôn kiểm tra lại và là nguồn sự thật.
 * Sửa luật ở đây thì sửa cả bản JS (và test của nó).
 */
import type { Game, ScoringRules } from "./types";

export type GameState = "a" | "b" | "in_progress" | "invalid";

export function gameState([a, b]: Game, r: ScoringRules): GameState {
  const P = r.pointsToWin;
  const M = r.maxPoints;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > M || b > M) return "invalid";
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const winner = a > b ? "a" : "b";
  if (hi === lo) return hi < M ? "in_progress" : "invalid";
  const endedNormally = (hi === P && lo <= P - 2) || (hi > P && hi - lo === 2 && lo >= P - 1);
  const endedAtCap = M === P ? hi === M : hi === M && lo === M - 1;
  if (endedNormally || endedAtCap) return winner;
  if (hi < P) return "in_progress";
  if (hi - lo === 1 && lo >= P - 1 && hi < M) return "in_progress";
  return "invalid";
}

export function matchProgress(games: Game[], r: ScoringRules) {
  let gamesA = 0;
  let gamesB = 0;
  for (const g of games) {
    const s = gameState(g, r);
    if (s === "a") gamesA += 1;
    if (s === "b") gamesB += 1;
  }
  const winner = gamesA >= r.gamesToWin ? "a" : gamesB >= r.gamesToWin ? "b" : null;
  return { gamesA, gamesB, winner } as const;
}

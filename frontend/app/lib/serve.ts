/**
 * Luật giao cầu & nghỉ giữa trận (BWF, tính điểm rally) — thuần logic cho bàn điểm trọng tài.
 *
 *  - Bên thắng pha cầu được giao pha tiếp theo (kể cả pha đầu game sau: bên thắng game giao trước).
 *  - Ô giao: điểm của BÊN GIAO chẵn → ô PHẢI, lẻ → ô TRÁI (đơn và đôi như nhau).
 *  - Nghỉ 60 giây khi bên dẫn chạm nửa số điểm thắng game (21 → 11, 15 → 8, 11 → 6).
 *  - Nghỉ 120 giây giữa hai game, hai bên đổi sân.
 *  - Game quyết định (game 3 của thể thức 2/3, game 5 của 3/5): đổi sân khi bên dẫn chạm mốc nghỉ.
 */
import { gameState } from "./scoring";
import type { Game, ScoringRules } from "./types";

export type Side = "a" | "b";
export interface Reminder { kind: "interval" | "between-games"; seconds: number; changeEnds: boolean; title: string }

/** Mốc nghỉ giữa game: nửa số điểm thắng, làm tròn lên. */
export const intervalAt = (pointsToWin: number) => Math.ceil(pointsToWin / 2);

/** Game thứ `index` (0-based) có phải game quyết định không. */
export const isDecidingGame = (index: number, gamesToWin: number) => gamesToWin > 1 && index === gamesToWin * 2 - 2;

/** Ô giao cầu của bên giao theo điểm của chính bên đó. */
export const serviceCourt = (serverScore: number): "right" | "left" => (serverScore % 2 === 0 ? "right" : "left");

/**
 * Nhắc nghỉ / đổi sân sau một pha ghi điểm (+1). null = không có gì để nhắc.
 * @param before các game trước pha cầu  @param after các game sau pha cầu
 */
export function reminderAfterPoint(before: Game[], after: Game[], rules: ScoringRules): Reminder | null {
  const idx = after.length - 1;
  const g = after[idx];
  if (!g) return null;
  const prev = before.length === after.length ? before[idx]! : [0, 0] as Game;
  const state = gameState(g, rules);
  if (state === "a" || state === "b") {
    // Hết game: còn đánh tiếp không?
    let wa = 0;
    let wb = 0;
    for (const x of after) {
      const s = gameState(x, rules);
      if (s === "a") wa += 1;
      if (s === "b") wb += 1;
    }
    if (wa >= rules.gamesToWin || wb >= rules.gamesToWin) return null;
    return { kind: "between-games", seconds: 120, changeEnds: true, title: `Hết game ${idx + 1} (${g[0]}-${g[1]}) — nghỉ 2 phút, hai bên đổi sân` };
  }
  const mid = intervalAt(rules.pointsToWin);
  if (Math.max(...g) === mid && Math.max(...prev) < mid) {
    const deciding = isDecidingGame(idx, rules.gamesToWin);
    return {
      kind: "interval", seconds: 60, changeEnds: deciding,
      title: `${mid} điểm — nghỉ 60 giây${deciding ? ", game quyết định: hai bên đổi sân" : ""}`,
    };
  }
  return null;
}

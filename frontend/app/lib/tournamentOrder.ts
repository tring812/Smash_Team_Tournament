import type { TournamentSummary } from "./types";

export const STATUS_RANK: Record<TournamentSummary["status"], number> = { ongoing: 0, published: 1, draft: 2, completed: 3 };

/**
 * Thứ tự hiển thị giải (thanh điều hướng + trang chủ dùng chung):
 * đang diễn ra → sắp diễn ra (gần nhất trước) → nháp → đã kết thúc (mới nhất trước).
 */
export function sortTournaments(ts: TournamentSummary[]): TournamentSummary[] {
  return [...ts].sort((a, b) => {
    const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (r) return r;
    const d = Date.parse(a.starts_at) - Date.parse(b.starts_at);
    return a.status === "completed" ? -d : d;
  });
}

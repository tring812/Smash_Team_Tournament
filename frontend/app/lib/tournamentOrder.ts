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

export type TournamentFilter = TournamentSummary["status"] | "all";

/** Dữ liệu trang chủ đã xếp thứ tự; bộ lọc chỉ thay danh sách, không đổi giải nổi bật. */
export function homeTournamentView(tournaments: readonly TournamentSummary[], filter: TournamentFilter) {
  return {
    featured: tournaments.find((t) => t.status === "ongoing") ?? tournaments.find((t) => t.status === "published"),
    visible: filter === "all" ? tournaments : tournaments.filter((t) => t.status === filter),
    showDraft: filter === "draft" || tournaments.some((t) => t.status === "draft"),
  };
}

/**
 * Lần tải danh sách giải gần nhất của thanh điều hướng (dùng chung trong trang). Thanh điều hướng chỉ tải lại khi
 * danh sách đã cũ hơn NAV_LIST_TTL_MS hoặc đổi tài khoản — trước đây tải lại MỖI lần chuyển trang, nối tiếp sau /me.
 */
export const NAV_LIST_TTL_MS = 30_000;
export const navList = { at: 0, viewer: null as string | null };
/** Vừa tạo / sửa giải → lần chuyển trang kế tiếp tải lại danh sách giải của thanh điều hướng ngay. */
export function invalidateNavTournaments() { navList.at = 0; }

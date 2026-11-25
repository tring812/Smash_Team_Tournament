import { api, ApiError } from "./api";
import type { Category, GroupStanding } from "./types";

export interface CategoryStandings {
  categoryId: string;
  groups: GroupStanding[];
}

type StandingsCategory = Pick<Category, "id" | "stage">;

/** Mỗi trang chỉ nhớ khả năng hỗ trợ API trong một phút, không lưu kết quả hay chia sẻ giữa các phiên. */
export function createStandingsLoader(request: typeof api = api, now: () => number = Date.now) {
  let legacyUntil = 0;

  return async function loadStandings(
    tournamentId: string,
    categories: readonly StandingsCategory[],
    signal?: AbortSignal,
  ): Promise<CategoryStandings[]> {
    signal?.throwIfAborted();
    if (now() >= legacyUntil) {
      try {
        return await request<CategoryStandings[]>(`/tournaments/${encodeURIComponent(tournamentId)}/standings`, { signal });
      } catch (error) {
        signal?.throwIfAborted();
        // NOT_FOUND còn dùng cho tài nguyên không tồn tại: chỉ thay đường gọi khi thiếu đúng route.
        if (!(error instanceof ApiError) || error.status !== 404 || error.code !== "NOT_FOUND"
          || error.body.title !== "API không tồn tại") throw error;
        legacyUntil = now() + 60_000;
      }
    }

    const drawn = categories.filter((category) => category.stage !== "setup");
    const result: CategoryStandings[] = new Array(drawn.length);
    let cursor = 0;
    let failed = false;
    // Giới hạn bốn request đồng thời, giữ thứ tự nội dung và huỷ theo vòng tải của usePoll.
    await Promise.all(Array.from({ length: Math.min(4, drawn.length) }, async () => {
      while (!failed && cursor < drawn.length) {
        signal?.throwIfAborted();
        const index = cursor++;
        const category = drawn[index];
        if (!category) return;
        try {
          const groups = await request<GroupStanding[]>(`/categories/${encodeURIComponent(category.id)}/standings`, { signal });
          signal?.throwIfAborted();
          result[index] = { categoryId: category.id, groups };
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }));
    signal?.throwIfAborted();
    return result;
  };
}

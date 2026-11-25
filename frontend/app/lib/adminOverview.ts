import type { Match } from "./types";

/** Thống kê điều hành chỉ tính trận thực; trận có sân dự kiến chưa chắc đang chiếm sân. */
export function adminOverview(matches: Match[], courts: number) {
  const real = matches.filter((m) => !["bye", "cancelled"].includes(m.status));
  const finished = real.filter((m) => ["finished", "walkover"].includes(m.status)).length;
  const live = real.filter((m) => m.status === "live");
  const called = real.filter((m) => ["pending", "scheduled"].includes(m.status) && Boolean(m.calledAt));
  const onCourt = [...live, ...called].sort((a, b) => (a.court ?? Infinity) - (b.court ?? Infinity));
  const busyCourts = new Set(onCourt.filter((m) => m.court !== null && m.court >= 1 && m.court <= courts).map((m) => m.court));
  return {
    total: real.length,
    finished,
    live: live.length,
    called: called.length,
    waiting: real.length - finished - live.length - called.length,
    progress: real.length ? Math.round(finished * 100 / real.length) : 0,
    freeCourts: Math.max(0, courts - busyCourts.size),
    onCourt,
  };
}

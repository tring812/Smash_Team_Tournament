"use client";

import { useEffect, useState } from "react";
import type { LiveChange } from "./types";

/** Sự kiện "chỉ vài trận đổi tỉ số" — object mới mỗi lần, để đặt vào deps. */
export interface LiveMatchEvent { ids: string[] }

/** Đọc `data` của sự kiện; dữ liệu cũ / lạ (vd máy chủ bản trước gửi timestamp) coi như thay đổi cấu trúc. */
function matchIdsOf(data: unknown): string[] | null {
  try {
    const d = JSON.parse(String(data)) as LiveChange;
    if (d && d.kind === "match" && Array.isArray(d.matchIds) && d.matchIds.length && d.matchIds.every((x) => typeof x === "string")) {
      return d.matchIds;
    }
  } catch { /* không phải JSON */ }
  return null;
}

/**
 * Theo dõi "giải vừa thay đổi" qua Server-Sent Events (`/api/tournaments/:id/stream`).
 * - `tick`: tăng khi có thay đổi CẤU TRÚC (gọi sân, dời trận, kết quả, bốc thăm…) → đặt vào `deps` của usePoll để tải lại ngay.
 * - `matchEvent`: chỉ tỉ số / biên bản / trọng tài của vài trận đổi (mỗi điểm) → dùng `useMatchPatches` tải riêng các trận đó,
 *   khỏi tải lại cả lịch + bảng xếp hạng.
 * - `anyTick`: tăng với mọi thay đổi — cho trang cần tải lại toàn bộ dù chỉ một trận đổi (bảng điều phối sân).
 * `live` = đang kết nối; mất kết nối thì EventSource tự nối lại, trong lúc đó polling của usePoll vẫn chạy dự phòng.
 */
export function useLive(tournamentId: string | undefined) {
  const [tick, setTick] = useState(0);
  const [anyTick, setAnyTick] = useState(0);
  const [matchEvent, setMatchEvent] = useState<LiveMatchEvent | null>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!tournamentId || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/tournaments/${tournamentId}/stream`);
    const onChange = (e: MessageEvent) => {
      setAnyTick((n) => n + 1);
      const ids = matchIdsOf(e.data);
      if (ids) setMatchEvent({ ids });
      else setTick((n) => n + 1);
    };
    es.addEventListener("changed", onChange);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    return () => { es.removeEventListener("changed", onChange); es.close(); setLive(false); };
  }, [tournamentId]);
  return { tick, anyTick, matchEvent, live };
}

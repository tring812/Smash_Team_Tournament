"use client";

import { useEffect, useState } from "react";

/**
 * Theo dõi "giải vừa thay đổi" qua Server-Sent Events (`/api/tournaments/:id/stream`).
 * Trả `tick` tăng mỗi lần có thay đổi → đặt vào `deps` của usePoll để tải lại NGAY (điểm, gọi sân, dời trận…).
 * `live` = đang kết nối; mất kết nối thì EventSource tự nối lại, trong lúc đó polling của usePoll vẫn chạy dự phòng.
 */
export function useLive(tournamentId: string | undefined) {
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!tournamentId || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/tournaments/${tournamentId}/stream`);
    const onChange = () => setTick((n) => n + 1);
    es.addEventListener("changed", onChange);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    return () => { es.removeEventListener("changed", onChange); es.close(); setLive(false); };
  }, [tournamentId]);
  return { tick, live };
}

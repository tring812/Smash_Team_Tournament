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
    let changedWhileHidden = false;
    const onChange = () => {
      if (document.visibilityState !== "visible") { changedWhileHidden = true; return; }
      setTick((n) => n + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && changedWhileHidden) {
        changedWhileHidden = false;
        setTick((n) => n + 1);
      }
    };
    es.addEventListener("changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    return () => { document.removeEventListener("visibilitychange", onVisible); es.removeEventListener("changed", onChange); es.close(); setLive(false); };
  }, [tournamentId]);
  return { tick, live };
}

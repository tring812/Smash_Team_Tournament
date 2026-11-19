"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tải dữ liệu và tự làm mới mỗi `ms` khi tab đang hiển thị (bảng điểm "gần realtime").
 * TODO(Tier 2): thay polling bằng SSE/WebSocket khi số người xem lớn.
 */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], ms = 10_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  const refresh = useCallback(async () => {
    const ctl = new AbortController();
    try {
      setData(await loadRef.current(ctl.signal));
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ms, refresh]);

  return { data, error, refresh };
}

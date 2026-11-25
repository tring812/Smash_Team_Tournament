"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPollTask } from "./pollTask";

/**
 * Tự làm mới khi tab hiển thị; không chồng request, huỷ lượt cũ khi đổi bộ lọc/trang.
 */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], ms = 10_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  const taskRef = useRef<ReturnType<typeof createPollTask<T>> | null>(null);
  useEffect(() => { loadRef.current = load; });

  const refresh = useCallback(() => taskRef.current?.refresh() ?? Promise.resolve(), []);

  useEffect(() => {
    const task = createPollTask(
      (signal) => loadRef.current(signal),
      (next) => { setData(next); setError(null); },
      (e) => setError(e.message),
    );
    taskRef.current = task;
    const whenVisible = () => { if (document.visibilityState === "visible") void task.refresh(); };
    whenVisible();
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      document.removeEventListener("visibilitychange", whenVisible);
      task.dispose();
      if (taskRef.current === task) taskRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refresh]);

  // Đổi nhịp dự phòng khi SSE kết nối/ngắt không huỷ request đang chạy hay tải lại ngay.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, ms);
    return () => clearInterval(timer);
  }, [ms, refresh]);

  return { data, error, refresh };
}

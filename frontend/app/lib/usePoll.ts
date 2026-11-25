"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tải dữ liệu và tự làm mới mỗi `ms` khi tab đang hiển thị (bảng điểm "gần realtime").
 * Mỗi lần tải mới huỷ lần tải trước còn dở, và chỉ kết quả của lần tải MỚI NHẤT được ghi vào state —
 * tránh trường hợp có điểm liên tục (useLive đổi `tick`) mà response cũ về sau đè lên tỉ số mới.
 */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], ms = 10_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const ctlRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    const seq = ++seqRef.current;
    try {
      const next = await loadRef.current(ctl.signal);
      if (seq !== seqRef.current) return; // đã có lần tải mới hơn
      setData(next);
      setError(null);
    } catch (e) {
      if (seq !== seqRef.current || (e as Error).name === "AbortError") return;
      setError((e as Error).message);
    } finally {
      if (ctlRef.current === ctl) ctlRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, ms);
    return () => {
      clearInterval(t);
      // Đổi deps / rời trang: huỷ request đang dở và bỏ mọi kết quả về muộn của nó.
      ctlRef.current?.abort();
      ctlRef.current = null;
      seqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ms, refresh]);

  return { data, error, refresh };
}

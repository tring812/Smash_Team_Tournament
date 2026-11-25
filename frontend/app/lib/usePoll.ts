"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bộ nhớ đệm trong trang (mất khi tải lại / đóng tab — không ghi xuống máy): mở lại một trang vừa xem (vd chuyển tab
 * Lịch ↔ Bảng đấu, mỗi tab là một trang riêng nên dữ liệu bị tải lại từ đầu) hiện NGAY dữ liệu cũ rồi làm mới ngầm.
 * Giới hạn số mục để không phình bộ nhớ trên điện thoại.
 */
const cache = new Map<string, unknown>();
const CACHE_MAX = 40;
function remember(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/**
 * Tải dữ liệu và tự làm mới mỗi `ms` khi tab đang hiển thị (bảng điểm "gần realtime"). `ms <= 0` = chỉ tải khi đổi deps.
 * `cacheKey`: hiện ngay bản đã tải lần trước (cùng khoá) trong lúc chờ bản mới — dùng cho dữ liệu công khai của trang giải.
 * Mỗi lần tải mới huỷ lần tải trước còn dở, và chỉ kết quả của lần tải MỚI NHẤT được ghi vào state —
 * tránh trường hợp có điểm liên tục (useLive đổi `tick`) mà response cũ về sau đè lên tỉ số mới.
 */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], ms = 10_000, cacheKey?: string) {
  const [data, setData] = useState<T | null>(() => (cacheKey ? (cache.get(cacheKey) as T | undefined) ?? null : null));
  const keyRef = useRef(cacheKey);
  useEffect(() => { keyRef.current = cacheKey; });
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
      if (keyRef.current) remember(keyRef.current, next);
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
    const t = ms > 0 ? setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, ms) : undefined;
    return () => {
      if (t) clearInterval(t);
      // Đổi deps / rời trang: huỷ request đang dở và bỏ mọi kết quả về muộn của nó.
      ctlRef.current?.abort();
      ctlRef.current = null;
      seqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ms, refresh]);

  /**
   * Sửa dữ liệu ngay trên máy (cập nhật lạc quan / thay bằng bản máy chủ trả về sau khi ghi), không tải lại cả danh sách.
   * Huỷ lần tải đang dở: nó có thể bắt đầu TRƯỚC thao tác ghi và mang dữ liệu cũ về đè lên.
   */
  const mutate = useCallback((fn: (d: T) => T) => {
    ctlRef.current?.abort();
    ctlRef.current = null;
    seqRef.current += 1;
    setData((d) => {
      if (d === null) return d;
      const next = fn(d);
      if (keyRef.current) remember(keyRef.current, next);
      return next;
    });
  }, []);

  return { data, error, refresh, mutate };
}

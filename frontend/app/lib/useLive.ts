"use client";

import { useEffect, useState } from "react";
import type { LiveChange } from "./types";

/** Sự kiện "chỉ vài trận đổi" — object mới mỗi lần, để đặt vào deps. `categoryIds`: nội dung vừa đổi kết quả. */
export interface LiveMatchEvent { ids: string[]; categoryIds: string[] }

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Đọc `data` của sự kiện; dữ liệu cũ / lạ (vd máy chủ bản trước gửi timestamp) coi như thay đổi cấu trúc. */
function matchEventOf(data: unknown): LiveMatchEvent | null {
  try {
    const d = JSON.parse(String(data)) as LiveChange;
    if (d && d.kind === "match" && strings(d.matchIds) && d.matchIds.length) {
      return { ids: d.matchIds, categoryIds: strings(d.categoryIds) ? d.categoryIds : [] };
    }
  } catch { /* không phải JSON */ }
  return null;
}

/**
 * Theo dõi "giải vừa thay đổi" qua Server-Sent Events (`/api/tournaments/:id/stream`).
 * - `tick`: tăng khi có thay đổi CẤU TRÚC (gọi sân, dời trận, kết quả, bốc thăm…) → đặt vào `deps` của usePoll để tải lại ngay.
 * - `matchEvent`: chỉ vài trận đổi (tỉ số mỗi điểm, trọng tài, gọi sân, dời trận, bắt đầu, xác nhận) → dùng `useMatchPatches`
 *   tải riêng các trận đó, khỏi tải lại cả lịch.
 * - `resultTick`: tăng khi một trận vừa có KẾT QUẢ (xác nhận / bỏ cuộc) → đặt vào deps của bảng xếp hạng / nhánh.
 * - `anyTick`: tăng với mọi thay đổi — cho trang cần tải lại toàn bộ dù chỉ một trận đổi (bảng điều phối sân).
 * `live` = đang kết nối; mất kết nối thì EventSource tự nối lại, trong lúc đó polling của usePoll vẫn chạy dự phòng.
 */
export function useLive(tournamentId: string | undefined) {
  const [tick, setTick] = useState(0);
  const [anyTick, setAnyTick] = useState(0);
  const [matchEvent, setMatchEvent] = useState<LiveMatchEvent | null>(null);
  const [resultTick, setResultTick] = useState(0);
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!tournamentId || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/tournaments/${tournamentId}/stream`);
    let changedWhileHidden = false;
    const onChange = (e: MessageEvent) => {
      if (document.visibilityState !== "visible") { changedWhileHidden = true; return; }
      setAnyTick((n) => n + 1);
      const ev = matchEventOf(e.data);
      if (!ev) { setTick((n) => n + 1); return; }
      setMatchEvent(ev);
      if (ev.categoryIds.length) setResultTick((n) => n + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && changedWhileHidden) {
        changedWhileHidden = false;
        setTick((n) => n + 1);
        setAnyTick((n) => n + 1);
        setResultTick((n) => n + 1);
      }
    };
    es.addEventListener("changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    return () => { document.removeEventListener("visibilitychange", onVisible); es.removeEventListener("changed", onChange); es.close(); setLive(false); };
  }, [tournamentId]);
  return { tick, anyTick, matchEvent, resultTick, live };
}

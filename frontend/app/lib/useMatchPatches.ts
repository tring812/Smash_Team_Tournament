"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Match } from "./types";
import type { LiveMatchEvent } from "./useLive";

/**
 * Khi chỉ vài trận đổi tỉ số (`matchEvent` của useLive): tải riêng từng trận (`GET /matches/:id`) và giữ làm "lớp phủ".
 * `patch(m)` trả bản mới hơn theo `version` — nên thứ tự response không quan trọng: bản cũ về muộn không đè bản mới,
 * và khi danh sách đầy đủ tải lại có version mới hơn thì danh sách thắng. Lỗi tải bỏ qua (polling dự phòng vẫn chạy).
 */
export function useMatchPatches(matchEvent: LiveMatchEvent | null) {
  const [overlay, setOverlay] = useState<Record<string, Match>>({});
  const ctlRef = useRef<AbortController | null>(null);
  useEffect(() => () => ctlRef.current?.abort(), []);

  useEffect(() => {
    if (!matchEvent) return;
    ctlRef.current ??= new AbortController();
    const { signal } = ctlRef.current;
    for (const id of matchEvent.ids) {
      api<Match>(`/matches/${id}`, { signal })
        .then((full) => {
          const m: Match = { ...full };
          delete m.rallies; // biên bản không cần cho lịch / TV — không giữ trong bộ nhớ
          setOverlay((o) => (o[id] && o[id].version >= m.version ? o : { ...o, [id]: m }));
        })
        .catch(() => { /* bỏ qua: lần polling kế tiếp sẽ sửa */ });
    }
  }, [matchEvent]);

  return useCallback(<T extends Match>(m: T): T => {
    const o = overlay[m.id];
    return o && o.version > m.version ? { ...m, ...o } : m;
  }, [overlay]);
}

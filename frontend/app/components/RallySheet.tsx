"use client";

import { useEffect, useRef } from "react";
import { isDecidingGame, slotName, type RallyState, type SheetBlock } from "../lib/rally";
import type { Match, Slot } from "../lib/types";

/** Đánh đôi khi có VĐV thứ 2 ở một trong hai đội. */
export const isDoublesMatch = (m: Pick<Match, "a" | "b">) => Boolean(m.a?.players?.[1] || m.b?.players?.[1]);

/**
 * Biên bản diễn biến điểm theo mẫu giấy BTC — CHỈ ĐỂ XEM (chạm ô không đổi điểm).
 *  - Hàng = từng VĐV (đôi 4 hàng, kẻ đậm giữa 2 đội; đơn 2 hàng). Cột tên cố định bên trái, G = giao, N = nhận đầu game.
 *  - Cột 0: "0" ở hàng người giao và người nhận. Mỗi pha thêm 1 cột: số mới của đội thắng ghi ở hàng người giao pha kế tiếp.
 *  - Mỗi game một khối "G1 · 19–21". Vạch nét đứt "Nghỉ" ở mốc nửa game ("Đổi sân" ở game quyết định).
 *  - ✎ = sửa người giao / BTC sửa tay; ⏳ = pha chưa lưu lên máy chủ (mất mạng). Ô mới nhất tô nhạt, tự cuộn tới.
 */
export function RallySheet({ match, state, pending = new Set<number>(), autoScroll = true, print = false }: {
  match: Pick<Match, "a" | "b" | "rules" | "games">;
  state: RallyState;
  /** seq các pha chưa lưu được (hiện mờ + ⏳). */
  pending?: Set<number>;
  autoScroll?: boolean;
  /** Bản in A4: không cuộn, chữ đậm hơn. */
  print?: boolean;
}) {
  if (!state.sheet.length) {
    return <p className="rounded-2xl border border-dashed border-slate-200 p-3 text-center text-sm text-slate-500">Chưa có pha cầu nào — chọn người giao để bắt đầu biên bản.</p>;
  }
  const lastBlock = state.sheet.length - 1;
  return (
    <div className="space-y-3">
      {state.sheet.map((b, i) => (
        <Block key={`${b.game}-${i}`} match={match} block={b} index={i} latest={i === lastBlock}
          score={state.games[b.game - 1] ?? null} pending={pending} autoScroll={autoScroll && i === lastBlock} print={print} />
      ))}
    </div>
  );
}

function Block({ match, block, index, latest, score, pending, autoScroll, print }: {
  match: Pick<Match, "a" | "b" | "rules">; block: SheetBlock; index: number; latest: boolean;
  score: [number, number] | null; pending: Set<number>; autoScroll: boolean; print: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const doubles = isDoublesMatch(match);
  const rows: Slot[] = doubles ? ["a1", "a2", "b1", "b2"] : ["a1", "b1"];
  const lastSeq = block.cols[block.cols.length - 1]?.seq;
  const deciding = isDecidingGame(block.game - 1, match.rules.gamesToWin);

  // Luôn thấy ô mới nhất: cuộn hết sang phải mỗi khi có cột mới.
  useEffect(() => {
    const el = scroller.current;
    if (autoScroll && el) el.scrollLeft = el.scrollWidth;
  }, [autoScroll, block.cols.length, lastSeq]);

  const cell = print ? "h-7 min-w-7" : "h-7 min-w-7";
  const name = (s: Slot) => (doubles ? slotName(match, s) : match[s[0] as "a" | "b"]?.name ?? s);

  return (
    <section aria-label={`Biên bản game ${block.game}`} className={`rounded-2xl border border-slate-200 bg-white ${print ? "break-inside-avoid" : ""}`}>
      <h4 className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm font-bold text-slate-900">
        G{block.game}{score ? <span className="tabular">· {score[0]}–{score[1]}</span> : null}
      </h4>
      <div ref={scroller} className={print ? "" : "overflow-x-auto"}>
        <table className="border-separate border-spacing-0 text-sm tabular">
          <thead>
            <tr className="h-5 text-[11px] text-slate-500">
              <th className="sticky left-0 z-10 w-24 min-w-24 bg-white" aria-hidden />
              <th className={cell} aria-hidden />
              {block.cols.map((c) => (
                <th key={c.seq} scope="col" className={`${cell} px-0.5 font-normal ${c.interval ? "border-r-2 border-dashed border-slate-400" : ""}`}>
                  {pending.has(c.seq) ? <span title="Chưa lưu — sẽ gửi khi có mạng">⏳</span>
                    : c.kind === "override" ? <span title={`BTC sửa tay tỉ số: ${c.score[0]}–${c.score[1]}`} className="text-amber-700">✎</span>
                    : c.fixed ? <span title="Đã sửa người giao" className="text-sky-700">✎</span>
                    : c.interval ? <span className="whitespace-nowrap text-[10px]">{deciding ? "Đổi sân" : "Nghỉ"}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((slot, ri) => {
              const teamEdge = doubles && ri === 1; // kẻ đậm ngăn 2 đội
              const isServer = block.server === slot;
              const isReceiver = block.receiver === slot;
              return (
                <tr key={slot} className={teamEdge ? "[&>*]:border-b-2 [&>*]:border-b-slate-800" : "[&>*]:border-b [&>*]:border-b-slate-100"}>
                  <th scope="row" className="sticky left-0 z-10 w-24 min-w-24 max-w-24 bg-white pl-2 pr-1 text-left font-medium text-slate-800">
                    <span className="flex items-center gap-1">
                      {/* Tên dài: cắt phía đầu, giữ phần tên cuối ("…Chí Cường"). */}
                      <span className="min-w-0 flex-1 truncate text-xs" style={{ direction: "rtl", textAlign: "left" }} title={name(slot)}>
                        <bdi>{name(slot)}</bdi>
                      </span>
                      {(isServer || isReceiver) && (
                        <span className={`shrink-0 rounded px-1 text-[10px] font-bold ${isServer ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}`}
                          title={isServer ? "Giao đầu game" : "Nhận đầu game"}>{isServer ? "G" : "N"}</span>
                      )}
                    </span>
                  </th>
                  <td className={`${cell} border-r border-r-slate-200 text-center font-semibold text-slate-900`}>{isServer || isReceiver ? 0 : ""}</td>
                  {block.cols.map((c) => {
                    const mine = c.kind === "point" && c.row === slot;
                    const n = c.side === "a" ? c.score[0] : c.score[1];
                    const newest = latest && c.seq === lastSeq && !print;
                    return (
                      <td key={c.seq} className={`${cell} px-0.5 text-center ${c.interval ? "border-r-2 border-r-slate-400 [border-right-style:dashed]" : ""} ${newest ? "bg-amber-100" : ""} ${pending.has(c.seq) ? "opacity-50" : ""}`}>
                        {mine ? <span className="font-semibold text-slate-900">{n}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!print && index === 0 && block.cols.length === 0 && (
        <p className="px-3 py-1.5 text-xs text-slate-500">Mỗi pha cầu thêm một cột; số ghi ở hàng người sẽ giao pha kế tiếp.</p>
      )}
    </section>
  );
}

import Link from "next/link";
import type { GroupStanding, Match, MatchStatus, StandingRow } from "../lib/types";
import { fmtTime } from "../lib/api";
import { DqBadge, EmptyState } from "./ui";

/* Huy hiệu trạng thái dạng viên thuốc nền nhạt (giống web CLB). Không chỉ dựa vào màu: luôn có chữ. */
const STATUS: Record<MatchStatus, { label: string; cls: string }> = {
  pending: { label: "Chờ xếp", cls: "bg-slate-100 text-slate-600" },
  scheduled: { label: "Sắp đánh", cls: "bg-slate-900 text-white" },
  live: { label: "Đang đánh", cls: "bg-red-600 text-white" },
  finished: { label: "Kết thúc", cls: "bg-emerald-50 text-emerald-700" },
  walkover: { label: "Bỏ cuộc", cls: "bg-amber-50 text-amber-800" },
  bye: { label: "Miễn đấu", cls: "bg-slate-100 text-slate-500" },
  cancelled: { label: "Đã huỷ", cls: "bg-slate-100 text-slate-500 line-through" },
};

/** `called`: trận đã được BTC gọi vào sân nhưng chưa có điểm → "Mời ra sân" (nổi bật cho VĐV/khán giả). */
export function StatusBadge({ status, called = false }: { status: MatchStatus; called?: boolean }) {
  const s = called && (status === "pending" || status === "scheduled") ? { label: "Mời ra sân", cls: "bg-amber-400 text-black" } : STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${s.cls}`}>
      {status === "live" && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
      {s.label}
    </span>
  );
}

export function matchTitle(m: Match): string {
  return m.stage === "group" ? `${m.category.code} · Bảng ${m.groupName} · ${m.roundLabel}` : `${m.category.code} · ${m.roundLabel}`;
}

/** Thẻ trận: tên 2 bên + điểm từng game; bên thắng in đậm. */
export function MatchCard({ m, compact = false }: { m: Match; compact?: boolean }) {
  const row = (side: "a" | "b") => {
    const s = m[side];
    const won = m.winner === side;
    return (
      <div className={`flex items-center justify-between gap-3 ${won ? "font-bold text-slate-900" : "text-slate-700"}`}>
        <span className="min-w-0 truncate">
          {s ? <>{s.name}{s.disqualified && <DqBadge />}</> : <span className="italic text-slate-400">{m.status === "bye" ? "—" : "Chờ đội thắng"}</span>}
          {won && <span className="sr-only"> (thắng)</span>}
        </span>
        <span className="tabular flex shrink-0 gap-2">
          {m.games.map((g, i) => <span key={i} className="w-6 text-right">{g[side === "a" ? 0 : 1]}</span>)}
        </span>
      </div>
    );
  };
  return (
    <article aria-label={`${matchTitle(m)}: ${m.a?.name ?? "?"} gặp ${m.b?.name ?? "?"}`}
      className={`bg-white rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md ${m.status === "live" ? "border-red-300 ring-2 ring-red-100" : m.calledAt ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-100"} ${m.status === "cancelled" ? "opacity-60" : ""}`}>
      {!compact && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span className="font-medium">{matchTitle(m)}</span>
          <span className="flex items-center gap-2">
            {m.court && <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">Sân {m.court}</span>}
            <span className="tabular">{fmtTime(m.scheduledAt)}</span>
            <StatusBadge status={m.status} called={Boolean(m.calledAt)} />
            {["live", "finished"].includes(m.status) && (
              <Link href={`/bien-ban/${m.id}`} className="inline-flex min-h-6 items-center font-semibold text-slate-700 underline underline-offset-2 hover:text-black"
                aria-label={`Xem biên bản trận ${m.a?.name ?? "?"} gặp ${m.b?.name ?? "?"}`}>Biên bản</Link>
            )}
          </span>
        </div>
      )}
      <div className="space-y-1.5 text-sm">{row("a")}{row("b")}</div>
    </article>
  );
}

/** `highlight`: dòng khớp ô tìm VĐV được tô nổi (đánh dấu "Bạn"). */
export function StandingsTables({ groups, highlight }: { groups: GroupStanding[]; highlight?: (r: StandingRow) => boolean }) {
  if (!groups.length) return <EmptyState title="Chưa bốc thăm chia bảng" />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => (
        <section key={g.groupId} id={`g-${g.groupId}`} className="scroll-mt-28 overflow-hidden bg-white rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="flex items-center justify-between bg-black px-4 py-3 text-white">
            <span className="headline text-xl">Bảng <span className="text-red-500">{g.name}</span></span>
            {g.complete && <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold">Đã xong</span>}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Bảng xếp hạng bảng {g.name}</caption>
              <thead className="text-xs text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-left">#</th>
                  <th scope="col" className="px-2 py-2.5 text-left">Đội / VĐV</th>
                  <th scope="col" className="px-2 py-2.5 text-right"><abbr title="Số trận đã đánh">Tr</abbr></th>
                  <th scope="col" className="px-2 py-2.5 text-right"><abbr title="Thắng">T</abbr></th>
                  <th scope="col" className="px-2 py-2.5 text-right"><abbr title="Hiệu số game">±G</abbr></th>
                  <th scope="col" className="px-4 py-2.5 text-right"><abbr title="Hiệu số điểm">±Đ</abbr></th>
                </tr>
              </thead>
              <tbody className="tabular">
                {g.standings.map((r) => (
                  <tr key={r.entryId} aria-current={highlight?.(r) ? "true" : undefined}
                    className={`border-t border-slate-100 ${r.disqualified ? "text-slate-400" : ""} ${highlight?.(r) ? "bg-amber-50 shadow-[inset_4px_0_0_#f59e0b]" : ""}`}>
                    <td className="px-4 py-2.5">
                      {r.rank ? <span className={`inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${r.rank <= 2 ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600"}`}>{r.rank}</span> : "—"}
                    </td>
                    <th scope="row" className="px-2 py-2.5 text-left font-semibold">
                      <span className={r.disqualified ? "line-through" : "text-slate-900"}>{r.name}</span>
                      {r.disqualified && <DqBadge reason={r.dqReason} />}
                      {r.club && <span className="block text-xs font-normal text-slate-500">{r.club}</span>}
                    </th>
                    <td className="px-2 py-2.5 text-right">{r.played}</td>
                    <td className="px-2 py-2.5 text-right font-bold">{r.won}</td>
                    <td className="px-2 py-2.5 text-right">{r.gamesFor - r.gamesAgainst}</td>
                    <td className="px-4 py-2.5 text-right">{r.pointsFor - r.pointsAgainst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

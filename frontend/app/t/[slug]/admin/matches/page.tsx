"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Clock, FileText, PenLine, RotateCcw, Swords } from "lucide-react";
import { api, fmtTime } from "../../../../lib/api";
import { usePoll } from "../../../../lib/usePoll";
import type { Match, MatchStatus, Staff } from "../../../../lib/types";
import { Button, Card, CardSkeleton, DqBadge, EmptyState, PageHeader, textInputClass } from "../../../../components/ui";
import { StatusBadge, matchTitle } from "../../../../components/MatchViews";
import { useAdmin } from "../AdminContext";
import { MoveMatchModal } from "../MoveMatchModal";

const FILTERS: { id: "all" | MatchStatus; label: string }[] = [
  { id: "all", label: "Tất cả" }, { id: "live", label: "Đang đánh" }, { id: "scheduled", label: "Sắp đánh" },
  { id: "finished", label: "Kết thúc" }, { id: "cancelled", label: "Đã huỷ" },
];

export default function MatchesPage() {
  const { t, version, busy, act } = useAdmin();
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]["id"]>("all");
  const matches = usePoll((s) => api<Match[]>(`/tournaments/${t.id}/matches${cat ? `?categoryId=${cat}` : ""}`, { signal: s }), [t.id, cat, version], 15_000);
  const staff = usePoll((s) => api<Staff[]>(`/tournaments/${t.id}/staff`, { signal: s }), [t.id, version], 120_000);
  const [moving, setMoving] = useState<Match | null>(null);

  const rows = useMemo(() => (matches.data ?? []).filter((m) => m.status !== "bye" && (status === "all" || m.status === status)), [matches.data, status]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Quản lý giải" title="Trận đấu & trọng tài" desc="Phân công trọng tài, dời giờ / sân từng trận, mở bàn nhập điểm, mở lại trận để sửa tỉ số. Gọi trận theo sân trống ở Điều phối sân." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-full bg-slate-100 p-1" role="group" aria-label="Lọc theo trạng thái">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={status === f.id} onClick={() => setStatus(f.id)}
              className={`min-h-11 rounded-full px-4 text-sm font-bold transition-colors cursor-pointer ${status === f.id ? "bg-black text-white" : "text-slate-600 hover:text-black"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
          Nội dung
          <select value={cat} onChange={(e) => setCat(e.target.value)} className={`${textInputClass} w-auto cursor-pointer`}>
            <option value="">Tất cả</option>
            {t.categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </label>
      </div>

      <Card>
        {!matches.data ? <div className="p-5"><CardSkeleton /></div> : rows.length === 0 ? (
          <EmptyState icon={<Swords className="w-10 h-10" />} title="Không có trận nào" desc="Thử bộ lọc khác, hoặc bốc thăm để tạo trận." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Danh sách trận</caption>
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">Giờ / Sân</th>
                  <th scope="col" className="py-3 pr-3">Trận</th>
                  <th scope="col" className="py-3 pr-3">Tỉ số</th>
                  <th scope="col" className="py-3 pr-3">Trọng tài</th>
                  <th scope="col" className="py-3 pr-5"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className={`border-t border-slate-100 align-top ${m.status === "cancelled" ? "opacity-60" : ""}`}>
                    <td className="tabular whitespace-nowrap px-5 py-3">
                      <span className="font-semibold text-slate-900">{fmtTime(m.scheduledAt)}</span>
                      {m.court && <span className="block text-xs text-slate-500">Sân {m.court}</span>}
                    </td>
                    <td className="py-3 pr-3">
                      <span className="text-xs text-slate-500">{matchTitle(m)}</span>
                      <p className="mt-0.5 text-slate-900">
                        {m.a?.name ?? "?"}{m.a?.disqualified && <DqBadge />} <span className="text-slate-400">vs</span> {m.b?.name ?? "?"}{m.b?.disqualified && <DqBadge />}
                      </p>
                      <span className="mt-1 inline-block"><StatusBadge status={m.status} called={Boolean(m.calledAt)} /></span>
                    </td>
                    <td className="tabular py-3 pr-3 font-semibold">{m.games.map((g) => g.join("-")).join(", ") || "—"}</td>
                    <td className="py-3 pr-3">
                      <label className="sr-only" htmlFor={`ref-${m.id}`}>Trọng tài trận {m.a?.name} gặp {m.b?.name}</label>
                      <select id={`ref-${m.id}`} value={m.referee?.id ?? ""} disabled={busy || ["finished", "walkover", "cancelled"].includes(m.status)}
                        onChange={(e) => act(() => api(`/matches/${m.id}/referee`, { method: "PUT", body: { refereeUserId: e.target.value || null } }), "Đã phân công trọng tài")}
                        className={`${textInputClass} min-w-40 cursor-pointer`}>
                        <option value="">— Ai cũng được —</option>
                        {(staff.data ?? []).map((r) => <option key={r.user_id} value={r.user_id}>{r.full_name}</option>)}
                      </select>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-5 text-right">
                      {["live", "finished", "walkover"].includes(m.status) && (
                        <Link href={`/bien-ban/${m.id}`} className="mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
                          aria-label={`Biên bản trận ${m.a?.name} gặp ${m.b?.name}`}>
                          <FileText className="w-4 h-4" aria-hidden />Biên bản
                        </Link>
                      )}
                      {["finished", "walkover"].includes(m.status) ? (
                        <Button variant="outline" className="px-3" disabled={busy}
                          onClick={() => act(() => api(`/matches/${m.id}/reopen`, { method: "POST" }), "Đã mở lại trận để sửa")}>
                          <RotateCcw className="w-4 h-4" aria-hidden />Mở lại
                        </Button>
                      ) : m.a && m.b && m.status !== "cancelled" ? (
                        <span className="inline-flex gap-2">
                        <Button variant="ghost" className="px-3" disabled={busy} onClick={() => setMoving(m)} aria-label={`Dời trận ${m.a?.name} gặp ${m.b?.name}`}>
                          <Clock className="w-4 h-4" aria-hidden />Dời
                        </Button>
                        <Link href={`/ref/${m.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-black px-4 text-sm font-bold text-white hover:bg-black/85">
                          <PenLine className="w-4 h-4" aria-hidden />Nhập điểm
                        </Link>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <MoveMatchModal key={moving?.id ?? "none"} match={moving} courts={t.courts} onClose={() => setMoving(null)} />
    </div>
  );
}

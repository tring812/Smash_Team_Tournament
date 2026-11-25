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
import { NoRefereeHint, RefereeOptions } from "../RefereeOptions";

const FILTERS: { id: "all" | "called" | MatchStatus; label: string }[] = [
  { id: "all", label: "Tất cả" }, { id: "called", label: "Mời ra sân" }, { id: "live", label: "Đang đánh" }, { id: "scheduled", label: "Sắp đánh" },
  { id: "finished", label: "Kết thúc" }, { id: "cancelled", label: "Đã huỷ" },
];

export default function MatchesPage() {
  const { t, version, busy, act, setError } = useAdmin();
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]["id"]>("all");
  const matches = usePoll((s) => api<Match[]>(`/tournaments/${t.id}/matches${cat ? `?categoryId=${cat}` : ""}`, { signal: s }), [t.id, cat, version], 15_000);
  const staff = usePoll((s) => api<Staff[]>(`/tournaments/${t.id}/staff`, { signal: s }), [t.id, version], 120_000);
  const [moving, setMoving] = useState<Match | null>(null);
  /** Trận đang lưu trọng tài — chỉ khoá đúng ô đó, các ô khác vẫn chọn tiếp được. */
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const replace = (r: Match) => matches.mutate((list) => list.map((x) => (x.id === r.id ? r : x)));

  /**
   * Phân công trọng tài: đổi NGAY trên màn hình, gửi máy chủ, thay bằng trận máy chủ trả về.
   * Không tải lại danh sách trận / giải (trước đây ô chọn nhảy về tên cũ 1–2 giây chờ tải lại cả giải).
   * Lỗi → báo ở đầu trang và tải lại để hiện đúng trạng thái.
   */
  async function assignReferee(m: Match, refereeUserId: string) {
    const who = (staff.data ?? []).find((s) => s.user_id === refereeUserId);
    matches.mutate((list) => list.map((x) => (x.id === m.id ? { ...x, referee: who ? { id: who.user_id, name: who.full_name } : null } : x)));
    setSaving((s) => new Set(s).add(m.id));
    try {
      replace(await api<Match>(`/matches/${m.id}/referee`, { method: "PUT", body: { refereeUserId: refereeUserId || null } }));
    } catch (e) {
      setError(`Phân công trọng tài trận ${m.a?.name ?? "?"} – ${m.b?.name ?? "?"} thất bại: ${(e as Error).message}`);
      void matches.refresh();
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(m.id); return n; });
    }
  }

  // "Mời ra sân" = đã gọi vào sân, chưa có điểm. "Sắp đánh" không gồm các trận đó (đã ở bộ lọc riêng).
  const rows = useMemo(() => (matches.data ?? []).filter((m) => m.status !== "bye" && (
    status === "all" || (status === "called" ? Boolean(m.calledAt) : m.status === status && !(status === "scheduled" && m.calledAt)))), [matches.data, status]);
  /** Sân đang có trận (đang đánh / đã gọi) — làm mờ khi chuyển sân. */
  const busyCourts = useMemo(() => (matches.data ?? []).filter((m) => m.court && (m.status === "live" || m.calledAt)).map((m) => m.court!), [matches.data]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Quản lý giải" title="Trận đấu & trọng tài" desc="Phân công trọng tài, dời giờ / sân từng trận, mở bàn nhập điểm, mở lại trận để sửa tỉ số. Gọi trận theo sân trống ở Điều phối sân." />

      <NoRefereeHint staff={staff.data} slug={t.slug} />

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
                      <select id={`ref-${m.id}`} value={m.referee?.id ?? ""} disabled={saving.has(m.id) || ["finished", "walkover", "cancelled"].includes(m.status)}
                        aria-busy={saving.has(m.id)} onChange={(e) => void assignReferee(m, e.target.value)}
                        className={`${textInputClass} min-w-40 cursor-pointer`}>
                        <option value="">— Ai cũng được —</option>
                        <RefereeOptions staff={staff.data ?? []} />
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
                          {/* Mở lại vẫn tải lại toàn bộ: trận sau trong nhánh và trạng thái nội dung cũng đổi. */}
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
      <MoveMatchModal key={moving?.id ?? "none"} match={moving} courts={t.courts} busyCourts={busyCourts} onClose={() => setMoving(null)} onDone={replace} />
    </div>
  );
}

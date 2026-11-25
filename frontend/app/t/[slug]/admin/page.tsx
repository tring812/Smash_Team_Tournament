"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2, ChevronDown, Flag, Layers, MonitorPlay, Radio, Settings2, ShieldAlert, Users } from "lucide-react";
import { api, fmtTime } from "../../../lib/api";
import { adminOverview } from "../../../lib/adminOverview";
import { usePoll } from "../../../lib/usePoll";
import type { Match, TournamentEvent } from "../../../lib/types";
import { Card, CardSkeleton, EmptyState, Notice, PageHeader, Select } from "../../../components/ui";
import { StatusBadge, matchTitle } from "../../../components/MatchViews";
import { ACTION_LABEL, STAGE_LABEL, describeEvent, useAdmin } from "./AdminContext";
import { DangerZone, TournamentInfoCard } from "./TournamentSettings";

export default function AdminOverview() {
  const { slug } = useParams<{ slug: string }>();
  const { t, version, busy, act } = useAdmin();
  const matches = usePoll((s) => api<Match[]>(`/tournaments/${t.id}/matches`, { signal: s }), [t.id, version], 15_000);
  const events = usePoll((s) => api<TournamentEvent[]>(`/tournaments/${t.id}/events`, { signal: s }), [t.id, version], 60_000);
  const summary = adminOverview(matches.data ?? [], t.courts);
  const entries = t.categories.reduce((n, c) => n + c.entry_count, 0);
  const base = `/t/${slug}/admin`;
  const statItems = [
    { icon: Radio, label: "Đang thi đấu", value: matches.data ? summary.live : "—", note: matches.data ? `${summary.called} trận đã gọi vào sân` : "Đang tải trận đấu", tone: "text-red-700 bg-red-50" },
    { icon: MonitorPlay, label: "Sân đang trống", value: matches.data ? `${summary.freeCourts}/${t.courts}` : "—", note: "Theo trạng thái nhận sân", tone: "text-emerald-700 bg-emerald-50" },
    { icon: CheckCircle2, label: "Đã hoàn thành", value: matches.data ? `${summary.finished}/${summary.total}` : "—", note: matches.data ? `${summary.waiting} trận đang chờ` : "Đang tải tiến độ", tone: "text-slate-700 bg-slate-100" },
    { icon: Users, label: "Đội / VĐV đăng ký", value: entries, note: `${t.categories.length} nội dung thi đấu`, tone: "text-slate-700 bg-slate-100" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Trung tâm điều hành" title="Tổng quan giải đấu"
        desc={`${fmtTime(t.starts_at)} · ${t.venue || "Chưa có địa điểm"}`}
        actions={<Link href={`${base}/courts`} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-white hover:bg-primary-hover"><MonitorPlay className="h-4 w-4" aria-hidden />Điều phối sân<ArrowUpRight className="h-4 w-4" aria-hidden /></Link>} />

      {matches.error && <Notice kind="error">Không tải được trạng thái trận: {matches.error}</Notice>}

      <section aria-label="Thống kê điều hành" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statItems.map(({ icon: Icon, label, value, note, tone }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2"><p className="min-w-0 text-xs font-semibold text-slate-600 sm:text-sm">{label}</p><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg sm:h-8 sm:w-8 ${tone}`}><Icon className="h-4 w-4" aria-hidden /></span></div>
            <p className="mt-3 font-display text-4xl font-bold tabular-nums leading-none text-slate-900 sm:text-5xl">{value}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="progress-h" className="theme-fixed redline-panel grid gap-6 rounded-xl p-5 text-white sm:p-6 xl:grid-cols-[1fr_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="progress-h" className="flex items-center gap-2 text-sm font-bold"><Flag className="h-4 w-4 text-red-400" aria-hidden />Tiến độ giải đấu</h2><span className="font-display text-3xl font-bold tabular-nums">{matches.data ? `${summary.progress}%` : "—"}</span></div>
          <div role="progressbar" aria-label="Tiến độ hoàn thành trận đấu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={matches.data ? summary.progress : undefined} className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-red-500 transition-[width] motion-reduce:transition-none" style={{ width: `${summary.progress}%` }} /></div>
          <p className="mt-3 text-xs leading-5 text-neutral-300">{!matches.data ? "Đang tải tiến độ…" : summary.total ? `${summary.finished} / ${summary.total} trận đã kết thúc · Cập nhật trạng thái mỗi 15 giây` : "Chưa có trận đấu. Bắt đầu bằng việc thêm đội và bốc thăm."}</p>
        </div>
        <nav aria-label="Thao tác nhanh" className="flex flex-wrap gap-2 xl:border-l xl:border-white/15 xl:pl-6">
          <Link href={`${base}/categories`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 px-3 text-xs font-semibold hover:bg-white/10"><Layers className="h-4 w-4" aria-hidden />Nội dung & VĐV</Link>
          <Link href={`${base}/schedule`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 px-3 text-xs font-semibold hover:bg-white/10"><CalendarClock className="h-4 w-4" aria-hidden />Xếp lịch</Link>
          <Link href={`/t/${slug}/tv`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 px-3 text-xs font-semibold hover:bg-white/10"><MonitorPlay className="h-4 w-4" aria-hidden />Màn hình TV<ArrowUpRight className="h-3 w-3" aria-hidden /></Link>
        </nav>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card title="Trận trên sân" actions={<Link href={`${base}/courts`} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-primary">Tất cả sân<ArrowRight className="h-4 w-4" aria-hidden /></Link>}>
            {!matches.data ? <CardSkeleton rows={2} /> : !summary.onCourt.length ? <EmptyState title="Chưa có trận đang chiếm sân" desc="Gọi trận vào sân từ trang Điều phối sân để bắt đầu." /> : (
              <ul className="divide-y divide-slate-100">
                {summary.onCourt.slice(0, 5).map((m) => <li key={m.id}>
                  <Link href={`/ref/${m.id}`} className="group flex items-center gap-3 rounded-lg py-4 transition-colors hover:bg-slate-50" aria-label={`Mở bàn điểm: ${m.a?.name ?? "Chưa có đội"} gặp ${m.b?.name ?? "Chưa có đội"}`}>
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-slate-100 text-center text-[10px] font-bold uppercase text-slate-600"><span>Sân<span className="block font-display text-2xl leading-none text-slate-900">{m.court ?? "—"}</span></span></span>
                    <span className="min-w-0 flex-1"><span className="mb-1 flex flex-wrap items-center gap-2"><span className="text-[11px] text-slate-500">{matchTitle(m)}</span><StatusBadge status={m.status} called={Boolean(m.calledAt)} /></span><span className="block truncate text-sm font-bold text-slate-900">{m.a?.name ?? "Chờ đội"} <span className="font-normal text-slate-500">—</span> {m.b?.name ?? "Chờ đội"}</span><span className="mt-1 block text-xs font-semibold tabular-nums text-primary">{m.games.length ? m.games.map((g) => `${g[0]}–${g[1]}`).join(" · ") : "Chưa có điểm"}</span></span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-primary" aria-hidden />
                  </Link>
                </li>)}
              </ul>
            )}
            {summary.onCourt.length > 5 && <p className="mt-2 text-xs text-slate-500">Còn {summary.onCourt.length - 5} trận trên sân — xem tại Điều phối sân.</p>}
          </Card>

          <Card title="Nội dung thi đấu" actions={<Link href={`${base}/categories`} className="inline-flex min-h-11 items-center text-xs font-bold text-primary">Quản lý<ArrowRight className="ml-1 h-4 w-4" aria-hidden /></Link>}>
            {!t.categories.length ? <EmptyState title="Chưa có nội dung thi đấu" desc="Thêm nội dung trước khi nhập danh sách VĐV." /> : <ul className="divide-y divide-slate-100">
              {t.categories.map((c) => <li key={c.id} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0"><span className="text-sm font-bold text-slate-900">{c.name}</span><span className="mt-1 block text-xs text-slate-500">{c.code} · {c.entry_count} đội</span></span><span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${c.stage === "setup" ? "bg-amber-50 text-amber-800" : c.stage === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>{STAGE_LABEL[c.stage]}</span></li>)}
            </ul>}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card title="Trạng thái giải">
            <Select label="Hiển thị với khán giả" value={t.status} disabled={busy} onChange={(e) => act(() => api(`/tournaments/${t.id}`, { method: "PATCH", body: { status: e.target.value } }), "Đã cập nhật trạng thái")}>
              <option value="draft">Nháp (chỉ BTC thấy)</option><option value="published">Công bố</option><option value="ongoing">Đang diễn ra</option><option value="completed">Đã kết thúc (khoá nhập điểm)</option>
            </Select>
            <p className="mt-3 text-xs leading-5 text-slate-500">Kết thúc giải sẽ khoá nhập điểm. Các thay đổi được lưu ngay khi chọn.</p>
          </Card>
          <Card title="Thao tác gần đây" actions={<Link href={`${base}/log`} className="inline-flex min-h-11 items-center text-xs font-bold text-primary">Nhật ký<ArrowRight className="ml-1 h-4 w-4" aria-hidden /></Link>}>
            {events.error && <Notice kind="error">{events.error}</Notice>}
            {!events.data ? <CardSkeleton rows={3} /> : !events.data.length ? <p className="text-sm text-slate-500">Chưa có thao tác nào.</p> : <ol className="space-y-0">
              {events.data.slice(0, 5).map((ev) => <li key={ev.id} className="relative border-l border-slate-200 pb-5 pl-5 last:pb-0"><span className="absolute -left-1 top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden /><p className="text-sm font-bold text-slate-900">{ACTION_LABEL[ev.action]}{ev.category_code && <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">{ev.category_code}</span>}</p><p className="mt-1 break-words text-xs leading-5 text-slate-600">{describeEvent(ev)}</p><p className="mt-1 text-[11px] text-slate-500">{fmtTime(ev.created_at)} · {ev.actor}</p></li>)}
            </ol>}
          </Card>
        </div>
      </div>

      <section aria-label="Cài đặt giải" className="space-y-3">
        <details className="group rounded-xl border border-slate-200 bg-white">
          <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 p-4 sm:px-5"><Settings2 className="h-5 w-5 shrink-0 text-slate-500" aria-hidden /><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900">Thông tin & cấu hình giải</span><span className="mt-1 block text-xs text-slate-500">Tên giải, địa điểm, giờ bắt đầu, số sân và thời lượng trận</span></span><ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden /></summary>
          <div className="border-t border-slate-200 p-3 sm:p-5"><TournamentInfoCard key={`${t.id}-${t.slug}-${t.starts_at}-${t.courts}-${t.slot_minutes}-${t.name}-${t.venue}`} matches={matches.data} /></div>
        </details>
        {t.canDelete && <details className="group rounded-xl border border-red-200 bg-white"><summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 sm:px-5"><ShieldAlert className="h-5 w-5 shrink-0 text-red-700" aria-hidden /><span className="flex-1 text-sm font-bold text-red-700">Thao tác nhạy cảm</span><ChevronDown className="h-4 w-4 text-red-700 transition-transform group-open:rotate-180" aria-hidden /></summary><div className="border-t border-red-100 p-3 sm:p-5"><DangerZone /></div></details>}
      </section>
    </div>
  );
}

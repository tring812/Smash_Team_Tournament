"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2, ChevronDown, Flag, Layers, MonitorPlay, Radio, Settings2, ShieldAlert, Users } from "lucide-react";
import { api, fmtTime } from "../../../lib/api";
import { adminOverview } from "../../../lib/adminOverview";
import { usePoll } from "../../../lib/usePoll";
import type { Match, TournamentEvent } from "../../../lib/types";
import { Card, CardSkeleton, EmptyState, Notice, Select } from "../../../components/ui";
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
      {matches.error && <Notice kind="error">Không tải được trạng thái trận: {matches.error}</Notice>}

      <section aria-labelledby="overview-h" className="athlonix-admin-banner theme-fixed grid items-center gap-5 rounded-[.875rem] p-4 text-white sm:p-7 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-7 xl:p-8">
        <div className="min-w-0">
          <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.12em] text-red-200">
            <span aria-hidden className="size-1.5 shrink-0 bg-primary" /> Trung tâm điều hành
          </p>
          <h1 id="overview-h" className="athlonix-title text-balance text-[clamp(2.375rem,5vw,4rem)]">
            Tổng quan <span className="text-red-400">giải đấu.</span>
          </h1>
          <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-neutral-200">
            <CalendarClock className="mt-1 size-4 shrink-0 text-red-300" aria-hidden />
            <span>{fmtTime(t.starts_at)} · {t.venue || "Chưa có địa điểm"}</span>
          </p>
          <Link href={`${base}/courts`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md border border-white bg-white px-4 text-xs font-bold uppercase tracking-wide text-secondary transition-colors hover:bg-slate-200">
            <MonitorPlay className="size-4 shrink-0" aria-hidden />Điều phối sân<ArrowUpRight className="size-4 shrink-0" aria-hidden />
          </Link>
        </div>
        <div className="min-w-0 rounded-xl border border-white/15 bg-black/30 p-4 sm:p-5">
          <h2 id="progress-h" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-neutral-200"><Flag className="size-4 shrink-0 text-red-300" aria-hidden />Tiến độ giải đấu</h2>
          <p className="athlonix-title mt-3 text-5xl tabular-nums sm:text-6xl">{matches.data ? `${summary.progress}%` : "—"}</p>
          <div role="progressbar" aria-labelledby="progress-h" aria-valuemin={0} aria-valuemax={100} aria-valuenow={matches.data ? summary.progress : undefined} className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-red-500 transition-[width] motion-reduce:transition-none" style={{ width: `${summary.progress}%` }} />
          </div>
          <p className="mt-3 text-xs leading-5 text-neutral-300">{!matches.data ? "Đang tải tiến độ…" : summary.total ? `${summary.finished} / ${summary.total} trận đã kết thúc · Cập nhật mỗi 15 giây` : "Chưa có trận đấu. Bắt đầu bằng việc thêm đội và bốc thăm."}</p>
        </div>
      </section>

      <section aria-labelledby="stats-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="stats-h" className="athlonix-title text-2xl">Thống kê điều hành</h2>
          <nav aria-label="Thao tác nhanh" className="flex flex-wrap gap-1.5">
            <Link href={`${base}/categories`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 text-xs font-semibold hover:border-slate-700 hover:bg-white"><Layers className="size-4 shrink-0" aria-hidden />Nội dung & VĐV</Link>
            <Link href={`${base}/schedule`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 text-xs font-semibold hover:border-slate-700 hover:bg-white"><CalendarClock className="size-4 shrink-0" aria-hidden />Xếp lịch</Link>
            <Link href={`/t/${slug}/tv`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 text-xs font-semibold hover:border-slate-700 hover:bg-white"><MonitorPlay className="size-4 shrink-0" aria-hidden />Màn hình TV<ArrowUpRight className="size-3 shrink-0" aria-hidden /></Link>
          </nav>
        </div>
        <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {statItems.map(({ icon: Icon, label, value, note, tone }) => (
            <div key={label} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-5">
              <dt className="flex items-center gap-2 text-xs font-semibold text-slate-700 sm:text-sm">
                <span className={`grid size-7 shrink-0 place-items-center rounded-md sm:size-8 ${tone}`}><Icon className="size-4" aria-hidden /></span>{label}
              </dt>
              <dd className="athlonix-title mt-3 text-4xl tabular-nums sm:text-5xl">{value}</dd>
              <dd className="mt-2 text-xs leading-5 text-slate-600">{note}</dd>
            </div>
          ))}
        </dl>
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

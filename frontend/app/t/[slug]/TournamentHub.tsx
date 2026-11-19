"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, GitBranch, LayoutGrid, MapPin, MonitorPlay, RefreshCw } from "lucide-react";
import { api, fmtTime } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import { useLive } from "../../lib/useLive";
import type { Bracket, GroupStanding, Match, Tournament } from "../../lib/types";
import { MatchCard, StandingsTables } from "../../components/MatchViews";
import { BracketExplorer, BracketViewToggle, type BracketView } from "../../components/BracketExplorer";
import {
  AllMatchesTable, CourtView, ScheduleViewToggle, SCHEDULE_VIEWS, TimeView, dayKey, dayLabel, type ScheduleView,
} from "../../components/ScheduleViews";
import { CardSkeleton, PageHeader, textInputClass } from "../../components/ui";

export type HubTab = "schedule" | "groups" | "bracket";

/** Đường dẫn của từng tab — thanh điều hướng trang dùng chung để luôn mở ĐÚNG trang này. */
export const hubHref = (slug: string, tab: HubTab) => `/t/${slug}${tab === "schedule" ? "" : `/${tab}`}`;

const TABS: { id: HubTab; label: string; icon: typeof CalendarClock }[] = [
  { id: "schedule", label: "Lịch thi đấu", icon: CalendarClock },
  { id: "groups", label: "Bảng đấu", icon: LayoutGrid },
  { id: "bracket", label: "Loại trực tiếp", icon: GitBranch },
];

const clock = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * TRANG GIẢI CÔNG KHAI — một khung duy nhất cho cả 3 phần (lịch / bảng / loại trực tiếp).
 * Mỗi phần có URL riêng (/t/<slug>, /t/<slug>/groups, /t/<slug>/bracket) nên link từ thanh điều hướng,
 * từ thẻ giải ở trang chủ hay chia sẻ đều ra cùng một giao diện. Bộ lọc nằm trên URL:
 * ?cat=MS (mọi tab) · ?view=time|court|table&day=&court= (lịch) · ?view=tree|table (loại trực tiếp).
 */
export function TournamentHub({ tab }: { tab: HubTab }) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const catCode = search.get("cat") ?? "";
  const viewParam = search.get("view");
  const scheduleView = (SCHEDULE_VIEWS.find((v) => v.id === viewParam)?.id ?? "time") as ScheduleView;
  const bracketView: BracketView = viewParam === "table" ? "table" : "tree";
  const day = search.get("day") ?? "";
  const court = search.get("court") ?? "";

  const t = usePoll((s) => api<Tournament>(`/tournaments/${encodeURIComponent(slug)}`, { signal: s }), [slug], 60_000);
  const cats = t.data?.categories ?? [];
  const cat = cats.find((c) => c.code === catCode);
  // Bảng đấu / loại trực tiếp chỉ xem được từng nội dung → mặc định nội dung phù hợp nhất.
  const focusCat = cat
    ?? (tab === "bracket" ? cats.find((c) => c.stage === "knockout" || c.stage === "completed") : cats.find((c) => c.stage !== "setup"))
    ?? cats[0];

  // Có điểm / gọi sân / dời trận → tải lại ngay; polling 10s (30s khi đang nhận trực tiếp) chỉ là dự phòng.
  const { tick, live: streaming } = useLive(t.data?.id);
  const matches = usePoll(
    (s) => (t.data ? api<Match[]>(`/tournaments/${t.data.id}/matches${tab === "schedule" && cat ? `?categoryId=${cat.id}` : ""}`, { signal: s }) : Promise.resolve([])),
    [t.data?.id, cat?.id, tab, tick], streaming ? 30_000 : 10_000,
  );
  const groups = usePoll(
    (s) => (tab === "groups" && focusCat ? api<GroupStanding[]>(`/categories/${focusCat.id}/standings`, { signal: s }) : Promise.resolve([])),
    [tab, focusCat?.id, tick], streaming ? 30_000 : 10_000,
  );
  const bracket = usePoll(
    (s) => (tab === "bracket" && focusCat ? api<Bracket>(`/categories/${focusCat.id}/bracket`, { signal: s }) : Promise.resolve({ rounds: [] })),
    [tab, focusCat?.id, tick], streaming ? 30_000 : 10_000,
  );

  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- ghi lại thời điểm dữ liệu mới về (hiển thị "lần cuối")
  useEffect(() => { if (matches.data) setUpdatedAt(new Date()); }, [matches.data]);

  const all = useMemo(() => (matches.data ?? []).filter((m) => m.status !== "bye" && m.status !== "cancelled"), [matches.data]);
  const days = useMemo(() => [...new Set(all.filter((m) => m.scheduledAt).map((m) => m.scheduledAt as string))]
    .reduce<{ key: string; iso: string }[]>((acc, iso) => (acc.some((d) => d.key === dayKey(iso)) ? acc : [...acc, { key: dayKey(iso), iso }]), [])
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)), [all]);
  const shown = all.filter((m) => (!day || (m.scheduledAt && dayKey(m.scheduledAt) === day)) && (!court || String(m.court) === court));
  const live = all.filter((m) => m.status === "live");

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(search.toString());
    if (v) p.set(k, v); else p.delete(k);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  /** Chuyển tab giữ nguyên nội dung đang chọn (view/ngày/sân là của riêng từng tab). */
  const tabHref = (id: HubTab) => `${hubHref(slug, id)}${catCode ? `?cat=${encodeURIComponent(catCode)}` : ""}`;

  if (t.error) return <p role="alert" className="text-red-700">{t.error}</p>;
  if (!t.data) return <CardSkeleton rows={4} />;
  const canManage = t.data.viewerRole === "admin" || t.data.viewerRole === "organizer";
  const pill = (active: boolean) => `min-h-11 rounded-full px-4 text-sm font-semibold transition-colors cursor-pointer ${active ? "bg-black text-white" : "border border-slate-200 bg-white text-slate-700 hover:border-slate-400"}`;
  const err = matches.error ?? groups.error ?? bracket.error;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Giải cầu lông mở rộng" title={t.data.name}
        desc={<span className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" aria-hidden />{t.data.venue || "Chưa có địa điểm"}</span>
          <span className="inline-flex items-center gap-1.5"><CalendarClock className="w-4 h-4" aria-hidden />{fmtTime(t.data.starts_at)}</span>
        </span>}
        actions={<div className="flex flex-wrap gap-2">
          <Link href={`/t/${slug}/tv`} target="_blank" rel="noopener"
            className="flex items-center gap-2 min-h-11 px-4 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:border-slate-400">
            <MonitorPlay className="w-4 h-4" aria-hidden />Chiếu màn hình
          </Link>
          {canManage && (
          <Link href={`/t/${slug}/admin`}
            className="flex items-center gap-2 min-h-11 pl-5 pr-1.5 rounded-full bg-black text-white text-sm font-semibold hover:bg-black/85 transition-colors">
            Quản lý giải
            <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center"><ArrowUpRight className="w-4 h-4" aria-hidden /></span>
          </Link>
          )}
        </div>} />

      <nav aria-label="Phần của giải" className="flex gap-1 overflow-x-auto rounded-full bg-slate-100 p-1 w-fit max-w-full">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Link key={id} href={tabHref(id)} aria-current={tab === id ? "page" : undefined} scroll={false}
            className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-bold transition-colors ${tab === id ? "bg-black text-white shadow" : "text-slate-600 hover:text-black"}`}>
            <Icon className="w-4 h-4" aria-hidden />{label}
          </Link>
        ))}
      </nav>

      {live.length > 0 && tab === "schedule" && (
        <section aria-labelledby="live-h" className="rounded-3xl bg-black p-5 sm:p-6">
          <h2 id="live-h" className="headline mb-4 flex items-center gap-2 text-xl text-white">
            <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />Đang thi đấu
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">{live.map((m) => <MatchCard key={m.id} m={m} />)}</div>
        </section>
      )}

      {tab === "schedule" && <ScheduleViewToggle view={scheduleView} onChange={(v) => setParam("view", v === "time" ? "" : v)} />}
      {tab === "bracket" && <BracketViewToggle view={bracketView} onChange={(v) => setParam("view", v === "tree" ? "" : v)} />}

      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Chọn nội dung" className="flex flex-wrap gap-2">
          {tab === "schedule" && <button type="button" aria-pressed={!cat} onClick={() => setParam("cat", "")} className={pill(!cat)}>Tất cả nội dung</button>}
          {cats.map((c) => {
            const active = tab === "schedule" ? c.id === cat?.id : c.id === focusCat?.id;
            return <button key={c.id} type="button" aria-pressed={active} onClick={() => setParam("cat", c.code)} className={pill(active)}>{c.code} · {c.name}</button>;
          })}
        </div>
        {tab === "schedule" && (
          <div className="ml-auto flex flex-wrap gap-3">
            {days.length > 1 && (
              <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
                Ngày
                <select value={day} onChange={(e) => setParam("day", e.target.value)} className={`${textInputClass} w-auto cursor-pointer`}>
                  <option value="">Tất cả</option>
                  {days.map((d) => <option key={d.key} value={d.key}>{dayLabel(d.iso)}</option>)}
                </select>
              </label>
            )}
            {scheduleView !== "court" && (
              <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
                Sân
                <select value={court} onChange={(e) => setParam("court", e.target.value)} className={`${textInputClass} w-auto cursor-pointer`}>
                  <option value="">Tất cả</option>
                  {Array.from({ length: Math.max(t.data.courts, ...all.map((m) => m.court ?? 0)) }, (_, i) => <option key={i + 1} value={i + 1}>Sân {i + 1}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-slate-500" aria-live="polite">
        <RefreshCw className="w-3.5 h-3.5" aria-hidden />
        {streaming ? <span className="font-semibold text-emerald-700">Trực tiếp</span> : "Tự cập nhật mỗi 10 giây"}{updatedAt && <> · lần cuối <span className="tabular">{clock.format(updatedAt)}</span></>}
        {tab === "schedule" && <> · {shown.length} trận</>}
      </p>

      {err && <p role="alert" className="text-red-700">{err}</p>}

      {tab === "schedule" && (!matches.data ? <CardSkeleton rows={4} /> : (
        <>
          {scheduleView === "time" && <TimeView matches={shown} />}
          {scheduleView === "court" && <CourtView matches={shown} courts={t.data.courts} />}
          {scheduleView === "table" && <AllMatchesTable matches={shown} />}
        </>
      ))}
      {tab === "groups" && (groups.data ? <StandingsTables groups={groups.data} /> : <CardSkeleton rows={4} />)}
      {tab === "bracket" && (bracket.data ? <BracketExplorer bracket={bracket.data} view={bracketView} /> : <CardSkeleton rows={4} />)}
    </div>
  );
}

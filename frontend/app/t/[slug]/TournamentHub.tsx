"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, GitBranch, LayoutGrid, MapPin, MonitorPlay, RefreshCw, Search, X } from "lucide-react";
import { api, fmtTime } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import { useLive } from "../../lib/useLive";
import type { Bracket, Category, GroupStanding, Match, StandingRow, Tournament } from "../../lib/types";
import { MatchCard, StandingsTables } from "../../components/MatchViews";
import { PlayerResults } from "../../components/PlayerResults";
import { findPeople, hasDiacritics, involves, makeMatcher, peopleOf } from "../../lib/playerSearch";
import { BracketExplorer, BracketViewToggle, type BracketView } from "../../components/BracketExplorer";
import {
  AllMatchesTable, CourtView, ScheduleViewToggle, SCHEDULE_VIEWS, TimeView, dayKey, dayLabel, type ScheduleView,
} from "../../components/ScheduleViews";
import { CardSkeleton, EmptyState, PageHeader, textInputClass } from "../../components/ui";

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
 * TRANG GIẢI CÔNG KHAI — 3 tab, mỗi tab một URL dùng chung khung: "Lịch thi đấu" (/t/<slug>, trận đấu),
 * "Bảng đấu" (/t/<slug>/groups, bảng xếp hạng vòng bảng), "Loại trực tiếp" (/t/<slug>/bracket).
 * Ô tìm VĐV có ở Lịch + Bảng đấu và giữ nguyên khi chuyển giữa hai tab. Bộ lọc nằm trên URL:
 * ?cat=MS (mọi tab) · ?q=tên VĐV · ?view=time|court|table&day=&court= (lịch) · ?view=tree|table (loại trực tiếp).
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
  const qParam = search.get("q") ?? "";

  const t = usePoll((s) => api<Tournament>(`/tournaments/${encodeURIComponent(slug)}`, { signal: s }), [slug], 60_000);
  const cats = t.data?.categories ?? [];
  const cat = cats.find((c) => c.code === catCode);
  // Loại trực tiếp chỉ xem được từng nội dung → mặc định nội dung đã có nhánh.
  const focusCat = cat ?? cats.find((c) => c.stage === "knockout" || c.stage === "completed") ?? cats[0];
  // Bảng xếp hạng: tab Bảng đấu, hoặc tab Lịch khi đang tìm VĐV (để báo "Bảng C · hạng 3").
  // Nội dung đang chọn, hoặc mọi nội dung đã bốc thăm.
  const searching = Boolean(qParam.trim());
  // Khi tìm VĐV: lấy MỌI nội dung đã bốc thăm để thẻ VĐV liệt kê đủ các nội dung người đó đánh.
  const standingCats: Category[] = tab === "groups" || (tab === "schedule" && searching)
    ? (cat && !searching ? [cat] : cats.filter((c) => c.stage !== "setup")) : [];
  const standingKey = standingCats.map((c) => c.id).join(",");

  // Có điểm / gọi sân / dời trận → tải lại ngay; polling 10s (30s khi đang nhận trực tiếp) chỉ là dự phòng.
  const { tick, live: streaming } = useLive(t.data?.id);
  const matches = usePoll(
    (s) => (t.data ? api<Match[]>(`/tournaments/${t.data.id}/matches${tab === "schedule" && cat && !searching ? `?categoryId=${cat.id}` : ""}`, { signal: s }) : Promise.resolve([])),
    [t.data?.id, cat?.id, tab, tick, searching], streaming ? 30_000 : 10_000,
  );
  const groups = usePoll(
    (s) => Promise.all(standingCats.map(async (c) => ({ category: c, groups: await api<GroupStanding[]>(`/categories/${c.id}/standings`, { signal: s }) }))),
    [standingKey, tick], streaming ? 30_000 : 10_000,
  );

  // Ô tìm VĐV: gõ ngay trên máy, URL (?q=) cập nhật sau 300 ms để chia sẻ / quay lại được.
  const [q, setQ] = useState(qParam);
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
  const hit = useMemo(() => makeMatcher(q), [q]);
  // Gom kết quả theo từng VĐV (mọi nội dung). Ưu tiên khớp tên; chỉ khi không ai khớp tên mới tính CLB / trường.
  // Gõ có dấu mà không ra ai (vd sai dấu "Bão" thay vì "Bảo") → thử lại kiểu bỏ dấu.
  const { people, approx } = useMemo(() => {
    if (!hit) return { people: [], approx: false };
    const strict = findPeople(hit, all, groups.data ?? []);
    if (strict.length || !hasDiacritics(q)) return { people: strict, approx: false };
    const loose = makeMatcher(q, true);
    const found = loose ? findPeople(loose, all, groups.data ?? []) : [];
    return { people: found, approx: found.length > 0 };
  }, [hit, q, all, groups.data]);
  const mine = useMemo(() => (hit ? involves(people) : null), [hit, people]);
  const isMine = (m: Match) => !mine || mine(m);
  const inCat = (m: Match) => !cat || m.category.id === cat.id;
  const shown = all.filter((m) => inCat(m) && (!day || (m.scheduledAt && dayKey(m.scheduledAt) === day)) && (!court || String(m.court) === court) && isMine(m));
  const live = all.filter((m) => m.status === "live" && inCat(m) && isMine(m));
  const peopleKeys = new Set(people.map((p) => p.key));
  const rowHit = hit ? (r: StandingRow) => peopleOf(r).some((pl) => peopleKeys.has(pl.key)) : undefined;
  // Khi tìm: chỉ giữ bảng có VĐV khớp.
  const standings = (groups.data ?? []).filter((x) => !cat || x.category.id === cat.id)
    .map((x) => ({ ...x, groups: rowHit ? x.groups.filter((g) => g.standings.some(rowHit)) : x.groups }))
    .filter((x) => !rowHit || x.groups.length);
  const personMatches = mine ? all.filter(mine).length : 0;

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(search.toString());
    if (v) p.set(k, v); else p.delete(k);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  useEffect(() => {
    if (q === qParam) return;
    const id = setTimeout(() => setParam("q", q.trim()), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ đồng bộ khi người dùng gõ
  }, [q]);
  /** Chuyển tab giữ nguyên nội dung đang chọn và ô tìm VĐV (view/ngày/sân là của riêng từng tab). */
  const tabHref = (id: HubTab) => {
    const p = new URLSearchParams();
    if (catCode) p.set("cat", catCode);
    if (id !== "bracket" && q.trim()) p.set("q", q.trim());
    const qs = p.toString();
    return `${hubHref(slug, id)}${qs ? `?${qs}` : ""}`;
  };

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

      {tab !== "bracket" && (
        <search className="block">
          <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
            <label htmlFor="player-q" className="sr-only">Tìm VĐV theo tên hoặc CLB</label>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input id="player-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" enterKeyHint="search"
              placeholder="Tìm tên của bạn (vd: nguyen an, hoặc tên CLB / trường)"
              className={`${textInputClass} min-h-12 rounded-full pl-12 pr-12 text-base`} />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Xoá tìm kiếm"
                className="absolute right-1.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-slate-500 hover:bg-slate-100 cursor-pointer">
                <X className="h-5 w-5" aria-hidden />
              </button>
            )}
          </form>
          {hit && (
            <div aria-live="polite" className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              {people.length ? (
                <PlayerResults people={people} matchCount={personMatches} groupsHref={tabHref("groups")} approx={approx ? q.trim() : null} />
              ) : (
                <p>Không tìm thấy “{q.trim()}”. Thử gõ ít chữ hơn (vd chỉ tên), hoặc gõ không dấu.
                  VĐV chỉ có trong lịch sau khi BTC bốc thăm.</p>
              )}
            </div>
          )}
        </search>
      )}

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
          {tab !== "bracket" && <button type="button" aria-pressed={!cat} onClick={() => setParam("cat", "")} className={pill(!cat)}>Tất cả nội dung</button>}
          {cats.map((c) => {
            const active = tab !== "bracket" ? c.id === cat?.id : c.id === focusCat?.id;
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
        <section aria-label="Trận đấu">
          {hit && !shown.length ? <EmptyState title="Không có trận nào khớp tìm kiếm" /> : (
            <>
              {scheduleView === "time" && <TimeView matches={shown} />}
              {scheduleView === "court" && <CourtView matches={shown} courts={t.data.courts} />}
              {scheduleView === "table" && <AllMatchesTable matches={shown} />}
            </>
          )}
        </section>
      ))}

      {tab === "groups" && (
        <section aria-label="Bảng đấu" className="space-y-6">
          {!groups.data ? <CardSkeleton rows={4} /> : !standings.length ? (
            <EmptyState title={hit ? "Không có bảng nào có tên này" : "Chưa bốc thăm chia bảng"} />
          ) : standings.map(({ category, groups: gs }) => (
            <div key={category.id} className="space-y-3">
              {!cat && standings.length > 0 && <h2 className="headline text-2xl">{category.code} · {category.name}</h2>}
              <StandingsTables groups={gs} highlight={rowHit} />
            </div>
          ))}
        </section>
      )}
      {tab === "bracket" && (bracket.data ? <BracketExplorer bracket={bracket.data} view={bracketView} /> : <CardSkeleton rows={4} />)}
    </div>
  );
}

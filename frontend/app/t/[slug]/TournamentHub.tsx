"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, GitBranch, LayoutGrid, MapPin, MonitorPlay, RefreshCw, Search, X } from "lucide-react";
import { api, fmtTime } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import { useLive } from "../../lib/useLive";
import { useMatchPatches } from "../../lib/useMatchPatches";
import type { Bracket, GroupStanding, Match, StandingRow, Tournament } from "../../lib/types";
import { MatchCard, StandingsTables } from "../../components/MatchViews";
import { PersonPicker, PlayerBadge, PlayerSchedule } from "../../components/PlayerResults";
import { findPeople, findPerson, hasDiacritics, involves, makeMatcher, peopleOf, type Person } from "../../lib/playerSearch";
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
 * Ô tìm VĐV có ở Lịch + Bảng đấu và giữ nguyên khi chuyển giữa hai tab, theo 2 bước:
 *  1. Gõ tên → CHỈ hiện danh sách tên khớp (ẩn lịch / bảng chung) để VĐV bấm chọn đúng mình.
 *  2. Đã chọn (?p=khoá VĐV) → Lịch chỉ còn các trận của người đó; Bảng đấu chỉ còn bảng có người đó.
 * Bộ lọc nằm trên URL: ?cat=MS (mọi tab) · ?q=tên gõ · ?p=VĐV đã chọn · ?view=time|court|table&day=&court= (lịch)
 * · ?view=tree|table (loại trực tiếp).
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
  const pickKey = search.get("p") ?? "";

  // cacheKey: chuyển tab (mỗi tab một trang) hiện ngay dữ liệu vừa xem rồi làm mới ngầm, không phải chờ tải lại từ đầu.
  const t = usePoll((s) => api<Tournament>(`/tournaments/${encodeURIComponent(slug)}`, { signal: s }), [slug], 60_000, `hub:t:${slug}`);
  const cats = useMemo(() => t.data?.categories ?? [], [t.data]);
  const cat = cats.find((c) => c.code === catCode);
  // Loại trực tiếp chỉ xem được từng nội dung → mặc định nội dung đã có nhánh.
  const focusCat = cat ?? cats.find((c) => c.stage === "knockout" || c.stage === "completed") ?? cats[0];
  // Bảng xếp hạng: tab Bảng đấu, hoặc tab Lịch khi đang tìm VĐV (để báo "Bảng C · hạng 3").
  // Nội dung đang chọn, hoặc mọi nội dung đã bốc thăm.
  const searching = Boolean(qParam.trim()) || Boolean(pickKey);
  // Khi tìm VĐV: lấy MỌI nội dung đã bốc thăm để thẻ VĐV liệt kê đủ các nội dung người đó đánh.
  const needStandings = tab === "groups" || (tab === "schedule" && searching);

  // Bốc thăm / xếp lịch / sửa đội → tải lại toàn bộ (`tick`). Điểm, gọi sân, dời trận, kết quả → chỉ tải riêng các trận đó
  // (`matchEvent` → patch); có kết quả mới thì tải thêm bảng xếp hạng / nhánh (`resultTick`), không tải lại cả lịch.
  // Polling 10s (30s khi đang nhận trực tiếp) chỉ là dự phòng.
  const { tick, matchEvent, resultTick, live: streaming } = useLive(t.data?.id);
  const patch = useMatchPatches(matchEvent);
  // Cả lịch (request nặng nhất) chỉ cần ở tab Lịch, hoặc khi tìm VĐV (để gom trận của người đó). Tab Bảng đấu / Loại trực tiếp
  // khi xem chung không tải.
  const matchesPath = t.data && (tab === "schedule" || searching)
    ? `/tournaments/${t.data.id}/matches${tab === "schedule" && cat && !searching ? `?categoryId=${cat.id}` : ""}` : null;
  const matches = usePoll(
    (s) => (matchesPath ? api<Match[]>(matchesPath, { signal: s }) : Promise.resolve([])),
    [matchesPath, tick], streaming ? 30_000 : 10_000, matchesPath ? `hub:${matchesPath}` : undefined,
  );
  // BXH mọi nội dung trong MỘT request (trước: 1 request mỗi nội dung, chờ tải xong thông tin giải mới bắt đầu).
  const standingsPath = t.data && needStandings ? `/tournaments/${t.data.id}/standings` : null;
  const standingsRaw = usePoll(
    (s) => (standingsPath ? api<{ categoryId: string; groups: GroupStanding[] }[]>(standingsPath, { signal: s }) : Promise.resolve(null)),
    [standingsPath, tick, resultTick], streaming ? 30_000 : 10_000, standingsPath ? `hub:${standingsPath}` : undefined,
  );
  const groups = useMemo(() => {
    if (!standingsRaw.data) return { data: needStandings ? null : [], error: standingsRaw.error };
    const byId = new Map(cats.map((c) => [c.id, c]));
    const data = standingsRaw.data.flatMap((x) => {
      const category = byId.get(x.categoryId);
      return category ? [{ category, groups: x.groups }] : [];
    });
    return { data, error: standingsRaw.error };
  }, [standingsRaw.data, standingsRaw.error, cats, needStandings]);

  // Ô tìm VĐV: gõ ngay trên máy, URL (?q=) cập nhật sau 300 ms để chia sẻ / quay lại được.
  const [q, setQ] = useState(qParam);
  const bracketPath = tab === "bracket" && focusCat ? `/categories/${focusCat.id}/bracket` : null;
  const bracket = usePoll(
    (s) => (bracketPath ? api<Bracket>(bracketPath, { signal: s }) : Promise.resolve({ rounds: [] })),
    [bracketPath, tick, resultTick], streaming ? 30_000 : 10_000, bracketPath ? `hub:${bracketPath}` : undefined,
  );

  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- ghi lại thời điểm dữ liệu mới về (hiển thị "lần cuối")
  useEffect(() => { if (matches.data || standingsRaw.data || bracket.data) setUpdatedAt(new Date()); }, [matches.data, standingsRaw.data, bracket.data, patch]);

  const all = useMemo(() => (matches.data ?? []).map(patch).filter((m) => m.status !== "bye" && m.status !== "cancelled"), [matches.data, patch]);
  const bracketData = useMemo(() => (bracket.data
    ? { rounds: bracket.data.rounds.map((r) => ({ ...r, matches: r.matches.map(patch) })) }
    : null), [bracket.data, patch]);
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
  // VĐV đã chọn: lấy lại theo khoá trên URL, gom đủ mọi nội dung (kể cả khi ô tìm đã đổi chữ).
  const picked: Person | null = useMemo(() => (pickKey ? findPerson(pickKey, all, groups.data ?? []) : null), [pickKey, all, groups.data]);
  /** browse = xem chung · picking = đang gõ, chỉ hiện danh sách tên · picked = chỉ lịch / bảng của 1 VĐV. */
  const mode: "browse" | "picking" | "picked" = pickKey ? "picked" : hit ? "picking" : "browse";
  const mine = useMemo(() => (picked ? involves([picked]) : null), [picked]);
  const inCat = (m: Match) => !cat || m.category.id === cat.id;
  const shown = all.filter((m) => inCat(m) && (!day || (m.scheduledAt && dayKey(m.scheduledAt) === day)) && (!court || String(m.court) === court));
  const live = all.filter((m) => m.status === "live" && inCat(m));
  const rowHit = picked ? (r: StandingRow) => peopleOf(r).some((pl) => pl.key === picked.key) : undefined;
  // Đã chọn VĐV: chỉ giữ bảng có người đó (mọi nội dung); xem chung: theo nội dung đang chọn.
  const standings = (groups.data ?? []).filter((x) => mode === "picked" || !cat || x.category.id === cat.id)
    .map((x) => ({ ...x, groups: rowHit ? x.groups.filter((g) => g.standings.some(rowHit)) : x.groups }))
    .filter((x) => !rowHit || x.groups.length);
  const personMatches = mine ? all.filter(mine).length : 0;
  // Dữ liệu đủ để biết VĐV đã chọn có còn trong giải không (tránh báo "không tìm thấy" khi còn đang tải).
  const pickedResolved = Boolean(matches.data && groups.data);

  /** Đổi nhiều tham số URL một lần. Đọc URL HIỆN TẠI (không phải bản lúc render) — tránh lần cập nhật ?q= trễ 300 ms xoá mất ?p=. */
  const replaceParams = (updates: Record<string, string>) => {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(updates)) { if (v) p.set(k, v); else p.delete(k); }
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setParam = (k: string, v: string) => replaceParams({ [k]: v });
  useEffect(() => {
    if (q.trim() === qParam.trim()) return;
    const id = setTimeout(() => setParam("q", q.trim()), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ đồng bộ khi người dùng gõ
  }, [q]);
  const onType = (v: string) => {
    setQ(v);
    if (pickKey) replaceParams({ p: "" }); // sửa chữ = tìm lại từ đầu → bỏ VĐV đã chọn, hiện danh sách tên
  };
  const pick = (p: Person) => {
    setQ(p.name);
    replaceParams({ q: p.name, p: p.key });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const clearSearch = () => {
    setQ("");
    replaceParams({ q: "", p: "" });
  };
  /** Chuyển tab giữ nguyên nội dung đang chọn, ô tìm và VĐV đã chọn (view/ngày/sân là của riêng từng tab). */
  const tabHref = (id: HubTab) => {
    const p = new URLSearchParams();
    if (catCode) p.set("cat", catCode);
    if (id !== "bracket" && q.trim()) p.set("q", q.trim());
    if (id !== "bracket" && pickKey) p.set("p", pickKey);
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
            <input id="player-q" type="search" value={q} onChange={(e) => onType(e.target.value)} autoComplete="off" enterKeyHint="search"
              placeholder="Tìm tên của bạn (vd: nguyen an, hoặc tên CLB / trường)"
              className={`${textInputClass} min-h-12 rounded-full pl-12 pr-12 text-base`} />
            {q && (
              <button type="button" onClick={clearSearch} aria-label="Xoá tìm kiếm"
                className="absolute right-1.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-slate-500 hover:bg-slate-100 cursor-pointer">
                <X className="h-5 w-5" aria-hidden />
              </button>
            )}
          </form>
          {mode === "picking" && (
            <div aria-live="polite" className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              {!pickedResolved ? <p>Đang tìm…</p> : people.length ? (
                <PersonPicker people={people} onPick={pick} approx={approx ? q.trim() : null} />
              ) : (
                <p>Không tìm thấy “{q.trim()}”. Thử gõ ít chữ hơn (vd chỉ tên), hoặc gõ không dấu.
                  VĐV chỉ có trong lịch sau khi BTC bốc thăm.</p>
              )}
            </div>
          )}
          {mode === "picked" && pickedResolved && !picked && (
            <p role="alert" className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Không còn thấy VĐV đã chọn trong giải này (BTC có thể vừa sửa tên). Gõ lại tên để tìm.
            </p>
          )}
        </search>
      )}

      {/* Đang gõ tên (picking): chỉ hiện danh sách tên ở trên, ẩn lịch / bảng chung cho tới khi VĐV chọn đúng mình. */}
      {mode === "picked" && tab !== "bracket" && (
        !pickedResolved ? <CardSkeleton rows={3} /> : picked && (
          tab === "schedule" ? (
            <PlayerSchedule p={picked} groupsHref={tabHref("groups")} onClear={clearSearch} />
          ) : (
            <section aria-label={`Bảng đấu của ${picked.name}`} className="space-y-6">
              <PlayerBadge p={picked} onClear={clearSearch} />
              {!standings.length ? (
                <EmptyState title={`${picked.name} chưa có trong bảng nào`} desc="Bảng đấu có sau khi BTC bốc thăm; nội dung loại trực tiếp xem ở tab Loại trực tiếp." />
              ) : standings.map(({ category, groups: gs }) => (
                <div key={category.id} className="space-y-3">
                  <h2 className="headline text-2xl">{category.code} · {category.name}</h2>
                  <StandingsTables groups={gs} highlight={rowHit} />
                </div>
              ))}
            </section>
          )
        )
      )}

      {(mode === "browse" || tab === "bracket") && (
        <>
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
        </>
      )}

      {mode !== "picking" && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500" aria-live="polite">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden />
          {streaming ? <span className="font-semibold text-emerald-700">Trực tiếp</span> : "Tự cập nhật mỗi 10 giây"}{updatedAt && <> · lần cuối <span className="tabular">{clock.format(updatedAt)}</span></>}
          {tab === "schedule" && <> · {mode === "picked" ? personMatches : shown.length} trận</>}
        </p>
      )}

      {err && <p role="alert" className="text-red-700">{err}</p>}

      {mode === "browse" && tab === "schedule" && (!matches.data ? <CardSkeleton rows={4} /> : (
        <section aria-label="Trận đấu">
          {scheduleView === "time" && <TimeView matches={shown} />}
          {scheduleView === "court" && <CourtView matches={shown} courts={t.data.courts} />}
          {scheduleView === "table" && <AllMatchesTable matches={shown} />}
        </section>
      ))}

      {mode === "browse" && tab === "groups" && (
        <section aria-label="Bảng đấu" className="space-y-6">
          {!groups.data ? <CardSkeleton rows={4} /> : !standings.length ? (
            <EmptyState title="Chưa bốc thăm chia bảng" />
          ) : standings.map(({ category, groups: gs }) => (
            <div key={category.id} className="space-y-3">
              {!cat && standings.length > 0 && <h2 className="headline text-2xl">{category.code} · {category.name}</h2>}
              <StandingsTables groups={gs} />
            </div>
          ))}
        </section>
      )}
      {tab === "bracket" && (bracketData ? <BracketExplorer bracket={bracketData} view={bracketView} /> : <CardSkeleton rows={4} />)}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  CalendarClock, Check, ChevronDown, ClipboardList, Home, KeyRound, LogIn, LogOut, Plus, Settings2, UsersRound,
} from "lucide-react";
import { api, loginUrl } from "../lib/api";
import { desktopNavHighlight, type DesktopNavItem } from "../lib/desktopNav";
import { NAV_LIST_TTL_MS, navList, sortTournaments } from "../lib/tournamentOrder";
import type { TournamentSummary, Viewer } from "../lib/types";
import { RedLineBrand } from "./RedLineBrand";

const STATUS: Record<TournamentSummary["status"], { label: string; cls: string }> = {
  ongoing: { label: "Đang diễn ra", cls: "bg-red-50 text-red-700" },
  published: { label: "Sắp diễn ra", cls: "bg-slate-100 text-slate-600" },
  draft: { label: "Nháp", cls: "bg-amber-50 text-amber-800" },
  completed: { label: "Đã kết thúc", cls: "bg-slate-100 text-slate-500" },
};
const dateFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

/** "Ban tổ chức" → "BC"; "Nguyễn Văn An" → "NA". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Đóng bảng khi bấm ra ngoài các vùng `inside` hoặc nhấn Esc (trả focus về nút mở). */
function useDismiss(open: boolean, close: () => void, inside: RefObject<HTMLElement | null>[], returnFocus: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!inside.some((r) => r.current?.contains(e.target as Node))) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); returnFocus.current?.focus(); }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close, inside, returnFocus]);
}

/** Một nền chạy dưới các nút, đo lại khi font, chiều rộng hoặc mục hiển thị thay đổi. */
function useDesktopIndicator(item: DesktopNavItem | null) {
  const list = useRef<HTMLUListElement>(null);
  const indicator = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const root = list.current;
    const bar = indicator.current;
    if (!root || !bar) return;
    const target = item ? root.querySelector<HTMLElement>(`[data-desktop-tab="${item}"]`) : null;
    const measure = () => {
      const box = target?.getBoundingClientRect();
      if (!box?.width) {
        bar.style.opacity = "0";
        return;
      }
      const x = box.left - root.getBoundingClientRect().left;
      bar.style.width = `${box.width}px`;
      bar.style.transform = `translateX(${x}px)`;
      bar.style.opacity = "1";
      root.dataset.indicatorReady = "true";
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (target) observer.observe(target);
    return () => observer.disconnect();
  }, [item]);
  return { list, indicator };
}

/**
 * Điều hướng chính.
 * - Thanh trên (md+): logo · "Lịch thi đấu ▾" (chọn giải) · "Trọng tài" (chỉ tài khoản có nhiệm vụ trọng tài) · tài khoản.
 *   Máy tính rộng có thêm lối về trang chủ cạnh lịch thi đấu.
 *   Quản lý giải, tạo giải, tài khoản, giao diện nằm trong menu tài khoản.
 * - Điện thoại: thanh trên còn logo + tài khoản; Trang chủ / Lịch đấu / Trọng tài ở THANH TAB ĐÁY.
 */
function SiteNav() {
  const pathname = usePathname() ?? "/";
  const [viewer, setViewer] = useState<Viewer | null | undefined>(undefined);
  const [devLogin, setDevLogin] = useState(false);
  const [tournaments, setTournaments] = useState<TournamentSummary[] | null>(null);
  const [desktopScheduleOpen, setDesktopScheduleOpen] = useState(false);
  const [preview, setPreview] = useState<{ item: DesktopNavItem; pathname: string } | null>(null);

  // Mỗi lần chuyển trang: hỏi lại /me (đăng nhập / đăng xuất / bị khoá). Danh sách giải kèm vai trò người xem tải SONG SONG
  // với /me (cùng cookie nên đúng người xem) và chỉ khi đã cũ (> 30 s, hoặc vừa tạo giải) hoặc đổi tài khoản — trước đây
  // tải lại mỗi lần chuyển trang và phải chờ /me xong mới bắt đầu.
  const [hasList, setHasList] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    const load = () => api<TournamentSummary[]>("/tournaments", { signal: ctl.signal }).catch(() => null);
    const stale = !hasList || Date.now() - navList.at > NAV_LIST_TTL_MS;
    const early = stale ? load() : null;
    const apply = (ts: TournamentSummary[] | null, who: string) => {
      if (!ts || ctl.signal.aborted) return;
      navList.at = Date.now();
      navList.viewer = who;
      setTournaments(sortTournaments(ts));
      setHasList(true);
    };
    api<{ user: Viewer | null; devLogin?: boolean }>("/me", { signal: ctl.signal })
      .then((r) => {
        setViewer(r.user);
        setDevLogin(Boolean(r.devLogin));
        const who = r.user?.id ?? "guest";
        if (early) void early.then((ts) => apply(ts, who));
        else if (navList.viewer !== who) void load().then((ts) => apply(ts, who));
      })
      .catch(() => setViewer(null));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chạy theo trang; hasList chỉ để biết lần đầu
  }, [pathname]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    // Tải lại hẳn trang chủ (không dùng router): xoá mọi trạng thái/dữ liệu của tài khoản vừa đăng xuất.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  /** CHỈ DEV: backend bật DEV_LOGIN=1 thì mới có các nút này. */
  async function loginDev(role: "admin" | "user", name: string) {
    await api("/auth/dev-login", { method: "POST", body: { role, name } });
    window.location.reload();
  }

  const isReferee = Boolean(viewer) && (tournaments ?? []).some((t) => t.is_referee);
  const home = pathname === "/";
  const currentSlug = pathname.match(/^\/t\/([^/]+)/)?.[1] ?? null;
  const onSchedule = currentSlug !== null;
  const onRef = pathname.startsWith("/ref");
  // Màn nhập điểm (/ref/<id>) cần toàn màn hình và tránh bấm nhầm → không có thanh tab đáy.
  const showTabBar = !/^\/ref\/[^/]+/.test(pathname);

  const current = onSchedule ? "schedule" : onRef && isReferee ? "ref" : home ? "home" : null;
  const highlight = desktopNavHighlight(pathname, current, desktopScheduleOpen, preview, isReferee);
  const { list: desktopList, indicator } = useDesktopIndicator(highlight);
  const itemProps = (item: DesktopNavItem) => ({
    "data-desktop-tab": item,
    "data-current": item === current,
    "data-highlighted": item === highlight,
    className: "site-nav-item flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors",
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") setPreview({ item, pathname });
    },
  });

  return (
    <>
      <header className={`fixed inset-x-0 top-0 z-50 ${home ? "bg-secondary pt-safe" : "flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-[max(1rem,env(safe-area-inset-top))]"}`}>
        {home && (
          <p className="theme-fixed flex min-h-8 items-center justify-center gap-2 px-3 py-1 text-center text-[10px] font-bold uppercase tracking-[.12em] text-white">
            <span aria-hidden className="size-1.5 shrink-0 bg-primary" /> Red Line · Giải cầu lông Smash Team
          </p>
        )}
        <div className={home ? "border-b border-slate-200 bg-background/95 backdrop-blur-md" : "w-full max-w-[1232px]"}>
        <nav aria-label="Điều hướng chính"
          className={`flex w-full items-center justify-between gap-2 sm:gap-3 ${home
            ? "mx-auto min-h-[4.25rem] max-w-[1200px] px-4 py-2 sm:px-6 lg:px-8"
            : "rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur-md sm:px-3"}`}>
          <Link href="/" aria-label="Red Line — Trang chủ Smash Team" className="shrink-0 rounded-lg">
            <RedLineBrand />
          </Link>

          <ul ref={desktopList} onPointerLeave={() => setPreview(null)} className="site-nav-desktop relative isolate hidden items-center gap-0.5 md:flex">
            <li ref={indicator} aria-hidden className="site-nav-indicator pointer-events-none absolute inset-y-0 left-0 -z-10 rounded-lg bg-secondary opacity-0" />
            <li className="hidden lg:block">
              <Link href="/" aria-current={home ? "page" : undefined} {...itemProps("home")}>
                Trang chủ
              </Link>
            </li>
            {home && <li className="hidden xl:block"><Link href="/#features" {...itemProps("guide")}>Cách theo dõi</Link></li>}
            {home && <li className="hidden xl:block"><Link href="/#faq" {...itemProps("faq")}>Hỏi đáp</Link></li>}
            <li>
              <SchedulePicker tournaments={tournaments} currentSlug={currentSlug} onOpenChange={setDesktopScheduleOpen}
                trigger={(p) => {
                  const { className, ...props } = itemProps("schedule");
                  return <button {...p} {...props} type="button" className={`${className} cursor-pointer`}>
                    <CalendarClock className="h-4 w-4" aria-hidden />
                    Lịch thi đấu
                    <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${p["aria-expanded"] ? "rotate-180" : ""}`} />
                  </button>;
                }} />
            </li>
            {isReferee && (
              <li>
                <Link href="/ref" aria-current={onRef ? "page" : undefined} {...itemProps("ref")}>
                  <ClipboardList className="h-4 w-4" aria-hidden />
                  Trọng tài
                </Link>
              </li>
            )}
          </ul>

          <div className="flex min-h-11 items-center justify-end gap-2">
            {viewer === undefined ? (
              <span className="h-11 w-11 animate-pulse rounded-full bg-black/5 md:w-40" aria-hidden />
            ) : viewer ? (
              <AccountMenu viewer={viewer} tournaments={tournaments} isReferee={isReferee} onLogout={logout} />
            ) : (
              <>
                {devLogin && (
                  <>
                    <button type="button" onClick={() => loginDev("admin", "Admin Dev")}
                      className="hidden min-h-11 cursor-pointer rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 sm:inline-flex sm:items-center">Dev: Admin</button>
                    <button type="button" onClick={() => loginDev("user", "Trọng tài Dev")}
                      className="hidden min-h-11 cursor-pointer rounded-full border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 sm:block">Dev: Trọng tài</button>
                  </>
                )}
                {/* Khán giả không cần đăng nhập; giữ nút này tách khỏi các liên kết xem giải. */}
                <Link href={loginUrl(pathname)}
                  className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md bg-secondary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover sm:px-4">
                  <LogIn className="h-4 w-4" aria-hidden />
                  Đăng nhập
                </Link>
              </>
            )}
          </div>
        </nav>
        </div>
      </header>

      {showTabBar && (
        <nav aria-label="Điều hướng nhanh" data-tabbar
          className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 shadow-[0_-2px_16px_rgba(0,0,0,0.06)] backdrop-blur-md pb-safe md:hidden">
          <ul className="mx-auto flex max-w-md">
            <li className="flex-1">
              <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={tabCls(pathname === "/")}>
                <TabIcon active={pathname === "/"}><Home className="h-5 w-5" aria-hidden /></TabIcon>
                Trang chủ
              </Link>
            </li>
            <li className="flex-1">
              <SchedulePicker tournaments={tournaments} currentSlug={currentSlug} sheet
                trigger={(p) => (
                  <button {...p} type="button" className={`${tabCls(onSchedule || p["aria-expanded"])} w-full cursor-pointer`}>
                    <TabIcon active={onSchedule || p["aria-expanded"]}><CalendarClock className="h-5 w-5" aria-hidden /></TabIcon>
                    Lịch đấu
                  </button>
                )} />
            </li>
            {isReferee && (
              <li className="flex-1">
                <Link href="/ref" aria-current={onRef ? "page" : undefined} className={tabCls(onRef)}>
                  <TabIcon active={onRef}><ClipboardList className="h-5 w-5" aria-hidden /></TabIcon>
                  Trọng tài
                </Link>
              </li>
            )}
          </ul>
        </nav>
      )}
    </>
  );
}

const tabCls = (active: boolean) =>
  `flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${active ? "text-primary" : "text-slate-500 hover:text-black"}`;

function TabIcon({ active, children }: { active: boolean; children: ReactNode }) {
  return <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${active ? "bg-red-50" : ""}`}>{children}</span>;
}

type TriggerProps = { "aria-expanded": boolean; "aria-controls": string; onClick: () => void; ref: RefObject<HTMLButtonElement | null> };

/**
 * "Lịch thi đấu": bấm để chọn giải cần xem (khỏi phải cuộn trang chủ tìm giải).
 * Máy tính: bảng thả xuống dưới nút. Điện thoại (`sheet`): bảng trượt lên ngay trên thanh tab đáy.
 */
function SchedulePicker({ tournaments, currentSlug, sheet = false, trigger, onOpenChange }: {
  tournaments: TournamentSummary[] | null;
  currentSlug: string | null;
  sheet?: boolean;
  trigger: (p: TriggerProps) => ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inside = useMemo(() => [btnRef, panelRef], []);
  const change = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);
  const close = useCallback(() => change(false), [change]);
  useDismiss(open, close, inside, btnRef);

  const list = (
    <>
      <p className="px-3 pb-2 pt-1 text-xs font-bold uppercase tracking-widest text-slate-500">Chọn giải để xem lịch</p>
      {tournaments === null ? (
        <div className="space-y-2 p-1" aria-hidden>
          {[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : tournaments.length === 0 ? (
        <p className="px-3 py-4 text-sm text-slate-500">Chưa có giải nào được công bố.</p>
      ) : (
        <ul className="max-h-[min(60vh,420px)] space-y-1 overflow-y-auto">
          {tournaments.map((t) => {
            const cur = t.slug === currentSlug;
            const s = STATUS[t.status];
            return (
              <li key={t.id}>
                <Link href={`/t/${t.slug}`} onClick={close} aria-current={cur ? "page" : undefined}
                  className={`flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors ${cur ? "bg-slate-100" : "hover:bg-slate-50"}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">{t.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${s.cls}`}>
                        {t.status === "ongoing" && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />}
                        {s.label}
                      </span>
                      <span className="tabular">{dateFmt.format(new Date(t.starts_at))}</span>
                    </span>
                  </span>
                  {cur && <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Đang xem" />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  return (
    <div className={sheet ? "" : "relative"}>
      {trigger({ "aria-expanded": open, "aria-controls": id, onClick: () => change(!open), ref: btnRef })}
      {open && !sheet && (
        <div ref={panelRef} id={id} role="region" aria-label="Chọn giải"
          className="absolute left-1/2 top-[calc(100%+12px)] w-[360px] -translate-x-1/2 animate-fade-up rounded-3xl border border-black/5 bg-white p-2 shadow-[0_12px_40px_rgba(0,0,0,0.14)]">
          {list}
        </div>
      )}
      {/* Thanh tab đáy có backdrop-blur (tạo khung chứa cho phần tử fixed) → đưa bảng ra <body>. */}
      {open && sheet && createPortal(
        <div className="md:hidden">
          <div aria-hidden className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-40 bg-black/40" />
          <div ref={panelRef} id={id} role="region" aria-label="Chọn giải"
            className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-40 animate-fade-up rounded-t-3xl border-t border-black/5 bg-white p-3 shadow-[0_-12px_40px_rgba(0,0,0,0.18)]">
            {list}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * Nút tài khoản → bảng: thông tin, QUẢN LÝ GIẢI (giải mình quản lý được + tạo giải mới),
 * tài khoản / đổi mật khẩu, giao diện, đăng xuất.
 */
function AccountMenu({ viewer, tournaments, isReferee, onLogout }: {
  viewer: Viewer; tournaments: TournamentSummary[] | null; isReferee: boolean; onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inside = useMemo(() => [wrapRef], []);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, inside, buttonRef);

  const isAdmin = viewer.role === "admin";
  const managed = (tournaments ?? []).filter((t) => isAdmin || t.my_role === "organizer");
  // Tài khoản chưa được phân công gì thì không gọi là "Trọng tài".
  const roleLabel = isAdmin ? "Quản trị viên" : managed.length ? "Ban tổ chức" : isReferee ? "Trọng tài" : "Chưa được phân công";
  const item = "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-black";

  return (
    <div ref={wrapRef} className="relative">
      <button ref={buttonRef} type="button" aria-expanded={open} aria-controls={panelId}
        aria-label={`Tài khoản: ${viewer.full_name}`} onClick={() => setOpen((o) => !o)}
        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full p-1 transition-colors md:pr-3 ${open ? "bg-slate-100" : "hover:bg-slate-50"}`}>
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-black text-xs font-bold text-white">{initials(viewer.full_name)}</span>
        <span className="hidden max-w-40 truncate text-sm font-semibold md:inline">{viewer.full_name}</span>
        <ChevronDown aria-hidden className={`hidden h-4 w-4 text-slate-500 transition-transform md:block ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div id={panelId}
          className="absolute right-0 top-[calc(100%+10px)] w-[min(20rem,calc(100vw-2rem))] origin-top-right animate-fade-up rounded-3xl border border-black/5 bg-white p-2 shadow-[0_12px_40px_rgba(0,0,0,0.14)]">
          <div className="flex items-center gap-3 px-3 py-3">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black text-sm font-bold text-white">{initials(viewer.full_name)}</span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{viewer.full_name}</p>
              <p className="truncate text-xs text-slate-500">{viewer.username ? `@${viewer.username} · ` : ""}{roleLabel}</p>
            </div>
          </div>

          {(isAdmin || managed.length > 0) && (
            <section aria-labelledby={`${panelId}-mg`} className="border-t border-slate-100 pt-2">
              <h2 id={`${panelId}-mg`} className="px-3 pb-1 text-xs font-bold uppercase tracking-widest text-slate-500">Quản lý giải</h2>
              {tournaments === null ? (
                <div className="mx-1 h-11 animate-pulse rounded-2xl bg-slate-100" aria-hidden />
              ) : (
                <ul className="max-h-56 overflow-y-auto">
                  {managed.map((t) => (
                    <li key={t.id}>
                      <Link href={`/t/${t.slug}/admin`} onClick={close} className={item}>
                        <Settings2 className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[t.status].cls}`}>{STATUS[t.status].label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && (
                <Link href="/new" onClick={close} className="flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-semibold text-primary hover:bg-red-50">
                  <Plus className="h-4 w-4" aria-hidden /> Tạo giải mới
                </Link>
              )}
            </section>
          )}

          <div className="mt-2 border-t border-slate-100 pt-2">
            <Link href="/accounts" onClick={close} className={item}>
              {isAdmin ? <UsersRound className="h-4 w-4" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
              {isAdmin ? "Quản lý tài khoản" : "Đổi mật khẩu"}
            </Link>
          </div>

          <div className="mt-1 border-t border-slate-100 pt-1">
            <button type="button" onClick={onLogout}
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-sm font-semibold text-red-600 hover:bg-red-50">
              <LogOut className="h-4 w-4" aria-hidden /> Đăng xuất
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(SiteNav);

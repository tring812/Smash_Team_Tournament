"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo, useEffect, useId, useRef, useState, type ComponentType } from "react";
import { CalendarClock, ChevronDown, ClipboardList, LogIn, LogOut, Plus, Trophy, UsersRound } from "lucide-react";
import { api, loginUrl } from "../lib/api";
import type { TournamentSummary, Viewer } from "../lib/types";
import { ThemeToggle } from "./ThemeToggle";

type NavItem = { href: string; label: string; short: string; Icon: ComponentType<{ className?: string }>; active: boolean };

/** "Ban tổ chức" → "BT"; "Nguyễn Văn An" → "NA". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Điều hướng chính.
 * - Từ md trở lên: thanh nổi dạng viên thuốc ở trên (logo · mục chính · nút tài khoản).
 * - Điện thoại: thanh trên chỉ còn logo + tài khoản; mục chính chuyển xuống THANH TAB ĐÁY (bấm bằng ngón cái).
 * Lịch/Bảng/Loại trực tiếp KHÔNG nằm ở thanh trên vì trang giải đã có tab riêng. Riêng điện thoại có tab
 * "Lịch đấu" ở đáy vì tab trong trang trôi mất khi cuộn.
 */
function SiteNav() {
  const pathname = usePathname() ?? "/";
  // Màn nhập điểm (/ref/<id>) cần toàn bộ màn hình và tránh bấm nhầm → không có thanh tab đáy.
  const showTabBar = !/^\/ref\/[^/]+/.test(pathname);
  const [viewer, setViewer] = useState<Viewer | null | undefined>(undefined);
  const [devLogin, setDevLogin] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    api<{ user: Viewer | null; devLogin?: boolean }>("/me", { signal: ctl.signal })
      .then((r) => { setViewer(r.user); setDevLogin(Boolean(r.devLogin)); })
      .catch(() => setViewer(null));
    return () => ctl.abort();
  }, [pathname]);

  // Giải cho tab "Lịch đấu" ở đáy: giải đang xem, hoặc giải nổi bật (đang diễn ra → sắp diễn ra → mới nhất).
  const [featuredSlug, setFeaturedSlug] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    api<TournamentSummary[]>("/tournaments", { signal: ctl.signal })
      .then((ts) => setFeaturedSlug((ts.find((t) => t.status === "ongoing") ?? ts.find((t) => t.status === "published") ?? ts[0])?.slug ?? null))
      .catch(() => {});
    return () => ctl.abort();
  }, []);
  const slug = pathname.match(/^\/t\/([^/]+)/)?.[1] ?? featuredSlug;

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  }

  /** CHỈ DEV: backend bật DEV_LOGIN=1 thì mới có các nút này. */
  async function loginDev(role: "admin" | "user", name: string) {
    await api("/auth/dev-login", { method: "POST", body: { role, name } });
    window.location.reload();
  }

  const onRef = pathname.startsWith("/ref");
  const primary: NavItem[] = [
    { href: "/", label: "Giải đấu", short: "Giải đấu", Icon: Trophy, active: pathname === "/" },
    ...(viewer ? [{ href: "/ref", label: "Trọng tài", short: "Trọng tài", Icon: ClipboardList, active: onRef }] : []),
    ...(viewer?.role === "admin" ? [{ href: "/new", label: "Tạo giải", short: "Tạo giải", Icon: Plus, active: pathname === "/new" }] : []),
  ];
  const tabs: NavItem[] = [
    ...primary.slice(0, 1),
    ...(slug ? [{ href: `/t/${slug}`, label: "Lịch thi đấu", short: "Lịch đấu", Icon: CalendarClock, active: pathname.startsWith(`/t/${slug}`) }] : []),
    ...primary.slice(1),
  ];

  return (
    <>
      <div className="fixed top-0 left-0 z-50 flex w-full justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-[max(1rem,env(safe-area-inset-top))]">
        <nav aria-label="Điều hướng chính"
          className="flex w-full max-w-[1120px] items-center justify-between gap-4 rounded-full border border-black/5 bg-white/85 py-1.5 pl-2 pr-1.5 shadow-[0_2px_16px_rgba(0,0,0,0.06)] backdrop-blur-md sm:pl-3">
          <Link href="/" className="flex shrink-0 items-center gap-2 rounded-full pr-2">
            <span aria-hidden className="headline grid h-9 w-9 place-items-center rounded-full bg-primary text-sm text-white">ST</span>
            <span className="hidden font-bold text-[17px] tracking-tight min-[360px]:inline">Smash <span className="text-primary">Open Cup</span></span>
          </Link>

          <ul className="hidden items-center gap-1 md:flex">
            {primary.map((l) => (
              <li key={l.href}>
                <Link href={l.href} aria-current={l.active ? "page" : undefined}
                  className={`flex min-h-10 items-center rounded-full px-4 text-[15px] transition-colors ${
                    l.active ? "bg-slate-100 font-semibold text-black" : "font-medium text-slate-600 hover:bg-slate-50 hover:text-black"}`}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex min-h-11 items-center justify-end gap-2">
            {viewer === undefined ? (
              <span className="h-11 w-11 animate-pulse rounded-full bg-black/5 md:w-40" aria-hidden />
            ) : viewer ? (
              <AccountMenu viewer={viewer} onLogout={logout} />
            ) : (
              <>
                {devLogin && (
                  <>
                    <button type="button" onClick={() => loginDev("admin", "Admin Dev")}
                      className="min-h-11 cursor-pointer rounded-full border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800">Dev: Admin</button>
                    <button type="button" onClick={() => loginDev("user", "Trọng tài Dev")}
                      className="hidden min-h-11 cursor-pointer rounded-full border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 sm:block">Dev: Trọng tài</button>
                  </>
                )}
                {/* Khán giả không cần đăng nhập → nút viền, nhường điểm nhấn cho nút hành động của trang. */}
                <Link href={loginUrl(pathname)}
                  className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:text-black">
                  <LogIn className="h-4 w-4" aria-hidden />
                  Đăng nhập
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>

      {showTabBar && tabs.length > 1 && (
        <nav aria-label="Điều hướng nhanh" data-tabbar
          className="fixed inset-x-0 bottom-0 z-50 border-t border-black/5 bg-white/90 shadow-[0_-2px_16px_rgba(0,0,0,0.06)] backdrop-blur-md pb-safe md:hidden">
          <ul className="mx-auto flex max-w-md">
            {tabs.map((t) => (
              <li key={t.href} className="flex-1">
                <Link href={t.href} aria-current={t.active ? "page" : undefined}
                  className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${t.active ? "text-primary" : "text-slate-500 hover:text-black"}`}>
                  <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${t.active ? "bg-red-50" : ""}`}>
                    <t.Icon className="h-5 w-5" aria-hidden />
                  </span>
                  {t.short}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}

/** Nút tài khoản (chữ viết tắt + tên) mở bảng nhỏ: thông tin, quản lý tài khoản (admin), giao diện, đăng xuất. */
function AccountMenu({ viewer, onLogout }: { viewer: Viewer; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const roleLabel = viewer.role === "admin" ? "Quản trị viên" : "BTC · Trọng tài";

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
          className="absolute right-0 top-[calc(100%+10px)] w-72 origin-top-right animate-fade-up rounded-3xl border border-black/5 bg-white p-2 shadow-[0_12px_40px_rgba(0,0,0,0.14)]">
          <div className="flex items-center gap-3 px-3 py-3">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black text-sm font-bold text-white">{initials(viewer.full_name)}</span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{viewer.full_name}</p>
              <p className="truncate text-xs text-slate-500">{viewer.username ? `@${viewer.username} · ` : ""}{roleLabel}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-slate-100" />
          {viewer.role === "admin" && (
            <Link href="/accounts" onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-black">
              <UsersRound className="h-4 w-4" aria-hidden /> Quản lý tài khoản
            </Link>
          )}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-sm font-medium text-slate-700">Giao diện</span>
            <ThemeToggle />
          </div>
          <div className="my-1 h-px bg-slate-100" />
          <button type="button" onClick={onLogout}
            className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-sm font-semibold text-red-600 hover:bg-red-50">
            <LogOut className="h-4 w-4" aria-hidden /> Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(SiteNav);

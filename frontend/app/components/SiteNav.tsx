"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo, useEffect, useState } from "react";
import { ArrowUpRight, CalendarClock, ClipboardList, LayoutGrid, LogOut } from "lucide-react";
import { api, loginUrl } from "../lib/api";
import type { TournamentSummary, Viewer } from "../lib/types";

/** Thanh điều hướng nổi dạng viên thuốc. "Lịch thi đấu" / "Bảng đấu" mở đúng tab của trang giải (TournamentHub). */
function SiteNav() {
  const pathname = usePathname() ?? "/";
  const [viewer, setViewer] = useState<Viewer | null | undefined>(undefined);
  const [devLogin, setDevLogin] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    api<{ user: Viewer | null; devLogin?: boolean }>("/me", { signal: ctl.signal })
      .then((r) => { setViewer(r.user); setDevLogin(Boolean(r.devLogin)); })
      .catch(() => setViewer(null));
    return () => ctl.abort();
  }, [pathname]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  }

  /** CHỈ DEV: backend bật DEV_LOGIN=1 thì mới có các nút này. */
  async function loginDev(role: "admin" | "user", name: string) {
    await api("/auth/dev-login", { method: "POST", body: { role, name } });
    window.location.reload();
  }

  // "Lịch thi đấu": giải đang xem (nếu đang ở /t/<slug>/...) hoặc giải nổi bật (đang diễn ra → sắp diễn ra → mới nhất).
  const [featuredSlug, setFeaturedSlug] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    api<TournamentSummary[]>("/tournaments", { signal: ctl.signal })
      .then((ts) => setFeaturedSlug((ts.find((t) => t.status === "ongoing") ?? ts.find((t) => t.status === "published") ?? ts[0])?.slug ?? null))
      .catch(() => {});
    return () => ctl.abort();
  }, []);
  const slug = pathname.match(/^\/t\/([^/]+)/)?.[1] ?? featuredSlug;
  // Cùng URL với tab trên trang giải → bấm ở thanh điều hướng hay trong trang giải đều ra MỘT giao diện.
  const scheduleHref = slug ? `/t/${slug}` : null;
  const groupsHref = slug ? `/t/${slug}/groups` : null;
  const onSchedule = Boolean(slug) && (pathname === `/t/${slug}` || pathname === `/t/${slug}/schedule`);
  const onGroups = Boolean(slug) && pathname === `/t/${slug}/groups`;

  const links = [
    { href: "/", label: "Giải đấu", active: pathname === "/" },
    ...(scheduleHref ? [{ href: scheduleHref, label: "Lịch thi đấu", active: onSchedule }] : []),
    ...(groupsHref ? [{ href: groupsHref, label: "Bảng đấu", active: onGroups }] : []),
    ...(viewer ? [{ href: "/ref", label: "Trọng tài", active: pathname.startsWith("/ref") }] : []),
    ...(viewer?.role === "admin" ? [{ href: "/new", label: "Tạo giải", active: pathname === "/new" }] : []),
  ];

  return (
    <div className="fixed top-0 left-0 w-full z-50 flex justify-center px-4 pt-4 pt-safe">
      <nav aria-label="Điều hướng chính"
        className="w-full max-w-[1120px] flex items-center justify-between gap-4 rounded-full bg-white/80 backdrop-blur-md border border-black/5 shadow-[0_2px_16px_rgba(0,0,0,0.06)] pl-3 pr-2 py-2 sm:pl-5">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span aria-hidden className="headline grid h-8 w-8 place-items-center rounded-xl bg-primary text-sm text-white">ST</span>
          <span className="hidden sm:inline font-bold text-[17px] tracking-tight">Smash <span className="text-primary">Open Cup</span></span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-[15px] font-medium text-black/70">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.active ? "page" : undefined}
              className={`hover:text-black transition-colors ${l.active ? "text-black font-semibold" : ""}`}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 min-h-11 justify-end">
          {/* Màn hình hẹp: menu chữ bị ẩn → giữ lối vào lịch thi đấu bằng nút icon có nhãn */}
          {scheduleHref && (
            <Link href={scheduleHref} aria-label="Lịch thi đấu" title="Lịch thi đấu" aria-current={onSchedule ? "page" : undefined}
              className={`md:hidden grid h-11 w-11 place-items-center rounded-full ${onSchedule ? "bg-black text-white" : "bg-slate-100 text-slate-700"}`}>
              <CalendarClock className="w-5 h-5" aria-hidden />
            </Link>
          )}
          {groupsHref && (
            <Link href={groupsHref} aria-label="Bảng đấu" title="Bảng đấu" aria-current={onGroups ? "page" : undefined}
              className={`md:hidden grid h-11 w-11 place-items-center rounded-full ${onGroups ? "bg-black text-white" : "bg-slate-100 text-slate-700"}`}>
              <LayoutGrid className="w-5 h-5" aria-hidden />
            </Link>
          )}
          {viewer === undefined ? (
            <span className="h-11 w-[140px] rounded-full bg-black/5 animate-pulse" aria-hidden />
          ) : viewer ? (
            <>
              <Link href="/accounts" title="Tài khoản" className="hidden lg:inline text-sm text-slate-500 hover:text-black">
                Xin chào, <strong className="text-slate-900">{viewer.full_name}</strong>
              </Link>
              <Link href="/ref" aria-label="Trọng tài" title="Trọng tài" aria-current={pathname.startsWith("/ref") ? "page" : undefined}
                className={`md:hidden grid h-11 w-11 place-items-center rounded-full ${pathname.startsWith("/ref") ? "bg-black text-white" : "bg-slate-100 text-slate-700"}`}>
                <ClipboardList className="w-5 h-5" aria-hidden />
              </Link>
              <button type="button" onClick={logout} aria-label="Đăng xuất"
                className="flex items-center gap-2 min-h-11 pl-1.5 sm:pl-4 pr-1.5 rounded-full bg-black text-white text-sm font-semibold hover:bg-black/85 transition-colors cursor-pointer">
                <span className="hidden sm:inline">Đăng xuất</span>
                <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center"><LogOut className="w-4 h-4" aria-hidden /></span>
              </button>
            </>
          ) : (
            <>
              {devLogin && (
                <>
                  <button type="button" onClick={() => loginDev("admin", "Admin Dev")}
                    className="min-h-11 rounded-full border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 cursor-pointer">Dev: Admin</button>
                  <button type="button" onClick={() => loginDev("user", "Trọng tài Dev")}
                    className="hidden sm:block min-h-11 rounded-full border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 cursor-pointer">Dev: Trọng tài</button>
                </>
              )}
              <Link href={loginUrl(pathname)}
                className="flex items-center gap-2 min-h-11 pl-4 pr-1.5 rounded-full bg-black text-white text-xs sm:text-sm font-semibold hover:bg-black/85 transition-colors whitespace-nowrap">
                Đăng nhập
                <span className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shrink-0"><ArrowUpRight className="w-4 h-4" aria-hidden /></span>
              </Link>
            </>
          )}
        </div>
      </nav>
    </div>
  );
}

export default memo(SiteNav);

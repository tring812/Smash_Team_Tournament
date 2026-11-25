"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock, CalendarDays, ChevronRight, Eye, Home, LayoutDashboard, Loader2, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ScrollText, ShieldCheck, Swords, Users, X, UserCog, MonitorPlay, IdCard,
} from "lucide-react";
import { api, loginUrl } from "../../../lib/api";
import type { Tournament } from "../../../lib/types";
import { Notice } from "../../../components/ui";
import { RedLineBrand } from "../../../components/RedLineBrand";
import { AdminContext, type ActFn, type AdminCtx } from "./AdminContext";

/**
 * Khung quản trị Red Line:
 * sidebar đen cố định bên trái (ngăn kéo trên mobile), thanh tiêu đề trắng, chỉ cột nội dung được cuộn.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const base = `/t/${slug}/admin`;
  const [t, setT] = useState<Tournament | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [pathname]);

  useEffect(() => {
    if (!open || desktop) return;
    const returnFocus = menuButton.current;
    const links = () => Array.from(sidebar.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)") ?? []).filter((el) => el.getClientRects().length > 0);
    links()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
      if (e.key !== "Tab") return;
      const items = links();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); returnFocus?.focus(); };
  }, [open, desktop]);

  const loadTournament = useCallback(async () => {
    try {
      setT(await api<Tournament>(`/tournaments/${encodeURIComponent(slug)}`));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [slug]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- tải giải từ API (hệ thống ngoài) khi đổi slug / sau mỗi thao tác
  useEffect(() => { void loadTournament(); }, [loadTournament, version]);

  const act: ActFn = useCallback(async (fn, ok) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ kind: "ok", text: typeof ok === "function" ? ok(r) : ok });
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const ctx = useMemo<AdminCtx | null>(
    () => (t ? { t, version, busy, act, setError: (text) => setMsg({ kind: "error", text }) } : null),
    [t, version, busy, act],
  );

  const navGroups = [
    { label: "Điều hành", items: [
      { name: "Tổng quan", href: base, icon: LayoutDashboard },
      { name: "Điều phối sân", href: `${base}/courts`, icon: MonitorPlay },
      { name: "Trận đấu & trọng tài", href: `${base}/matches`, icon: Swords },
    ] },
    { label: "Chuẩn bị giải", items: [
      { name: "Nội dung & VĐV", href: `${base}/categories`, icon: Users },
      { name: "Vận động viên", href: `${base}/athletes`, icon: IdCard },
      { name: "Xếp lịch sân", href: `${base}/schedule`, icon: CalendarClock },
    ] },
    { label: "Quản trị", items: [
      { name: "Ban tổ chức", href: `${base}/staff`, icon: ShieldCheck },
      { name: "Nhật ký thao tác", href: `${base}/log`, icon: ScrollText },
    ] },
  ];
  const current = navGroups.flatMap((g) => g.items).find((n) => n.href === pathname);

  if (loadError) return <Centered><p role="alert" className="text-red-700">{loadError}</p><Link href="/" className="underline">Về trang chủ</Link></Centered>;
  if (!t || !ctx) return <Centered><Loader2 className="w-8 h-8 animate-spin text-primary" aria-label="Đang tải" /></Centered>;
  if (t.viewerRole !== "admin" && t.viewerRole !== "organizer") {
    return (
      <Centered>
        <p role="alert" className="font-bold text-slate-800">Bạn không phải Ban tổ chức của giải này.</p>
        <div className="flex gap-2">
          <Link href={`/t/${slug}`} className="min-h-11 content-center rounded-full bg-slate-100 px-5 text-sm font-bold">Xem trang giải</Link>
          <a href={loginUrl(base)} className="min-h-11 content-center rounded-full bg-black px-5 text-sm font-bold text-white">Đăng nhập</a>
        </div>
      </Centered>
    );
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/"); // SiteNav đọc lại /me khi đổi trang → hiện trạng thái đã đăng xuất
  }

  const sideLink = `min-h-11 flex items-center gap-3 border-l-2 border-transparent px-3 py-2.5 rounded-r-lg text-sm transition-colors ${collapsed ? "lg:justify-center lg:px-2" : ""}`;
  const labelClass = collapsed ? "lg:hidden" : "";
  return (
    <div className="admin-workspace relative h-dvh bg-background flex overflow-hidden">
      {open && <div className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden />}

      <aside ref={sidebar} id="admin-sidebar" inert={!desktop && !open} aria-label="Menu quản trị" role={!desktop && open ? "dialog" : undefined} aria-modal={!desktop && open ? true : undefined}
        className={`theme-fixed fixed lg:static inset-y-0 left-0 w-72 ${collapsed ? "lg:w-20" : "lg:w-64"} shrink-0 bg-secondary text-slate-300 z-50 transform ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 transition-[transform,width] duration-200 flex flex-col border-r border-white/10`}>
        <div className={`flex min-h-20 items-center justify-between gap-2 border-t-4 border-t-primary border-b border-b-white/10 px-5 py-4 pt-safe ${collapsed ? "lg:justify-center lg:px-2" : ""}`}>
          <div className="flex items-center gap-3 min-w-0">
            <RedLineBrand compact />
            <div className={`min-w-0 ${labelClass}`}>
              <span className="headline text-2xl text-white block leading-tight">Red Line <span className="text-red-500">/ BTC</span></span>
              <span className="block truncate text-[10px] text-red-300 uppercase tracking-wider font-bold">{t.name}</span>
            </div>
          </div>
          <button type="button" className="lg:hidden rounded-lg text-slate-400 hover:text-white hover:bg-white/10 min-h-11 min-w-11 flex items-center justify-center cursor-pointer"
            onClick={() => setOpen(false)} aria-label="Đóng menu quản trị">
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <nav aria-label="Điều hướng quản trị giải" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {navGroups.map((group) => <div key={group.label}>
            <p className={`mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 ${collapsed ? "lg:sr-only" : ""}`}>{group.label}</p>
            <ul className="space-y-1">{group.items.map(({ name, href, icon: Icon }) => {
            const active = pathname === href;
            return (
              <li key={href}><Link href={href} aria-label={name} title={collapsed ? name : undefined} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}
                className={`${sideLink} font-medium ${active ? "border-l-primary bg-white/10 text-white font-bold" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
                <Icon className={`w-5 h-5 shrink-0 ${active ? "text-red-400" : "text-slate-400"}`} aria-hidden />
                <span className={labelClass}>{name}</span>
                {active && <ChevronRight className={`ml-auto h-3.5 w-3.5 text-red-400 ${labelClass}`} aria-hidden />}
              </Link></li>
            );
          })}</ul></div>)}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-3 pb-safe">
          <div className={`grid grid-cols-2 gap-1 ${collapsed ? "lg:grid-cols-1" : ""}`}>
            {[{ href: `/t/${slug}`, name: "Trang công khai", icon: Eye }, { href: `/t/${slug}/groups`, name: "Bảng đấu", icon: CalendarDays }, { href: "/accounts", name: "Tài khoản", icon: UserCog }, { href: "/", name: "Trang chủ", icon: Home }].map(({ href, name, icon: Icon }) => <Link key={href} href={href} aria-label={name} title={name} className={`flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-medium text-slate-300 hover:bg-white/5 hover:text-white ${collapsed ? "lg:justify-center" : ""}`}><Icon className="h-4 w-4 shrink-0" aria-hidden /><span className={labelClass}>{name}</span></Link>)}
          </div>
          <div className={`mt-2 flex items-center gap-1 border-t border-white/10 pt-2 ${collapsed ? "lg:flex-col" : ""}`}>
            <button type="button" onClick={logout} aria-label="Đăng xuất" title="Đăng xuất" className={`flex min-h-11 min-w-11 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 ${collapsed ? "lg:justify-center" : ""}`}><LogOut className="h-4 w-4 shrink-0" aria-hidden /><span className={labelClass}>Đăng xuất</span></button>
            <button type="button" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"} aria-expanded={!collapsed} aria-controls="admin-sidebar" title={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"} className="hidden min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white lg:flex">{collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}</button>
          </div>
        </div>
      </aside>

      <main id="main" inert={open && !desktop} className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-white border-b-2 border-slate-200 flex items-center gap-3 px-4 lg:px-8 justify-between shrink-0 z-30 pt-safe"
          style={{ height: "calc(4.5rem + env(safe-area-inset-top, 0px))" }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <button ref={menuButton} type="button" onClick={() => setOpen(true)} aria-label="Mở menu quản trị" aria-expanded={open} aria-controls="admin-sidebar"
              className="lg:hidden text-slate-700 hover:bg-slate-100 rounded-xl min-h-11 min-w-11 flex items-center justify-center cursor-pointer">
              <Menu className="w-6 h-6" aria-hidden />
            </button>
            <span aria-hidden className="h-6 w-1 shrink-0 -skew-x-12 bg-primary" />
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Điều hành giải <span className="text-primary">/ {current?.name ?? "Quản trị"}</span></p><p className="mt-1 truncate text-sm font-bold text-secondary">{t.name}</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-2"><Link href={`/t/${slug}`} title="Xem trang công khai" aria-label="Xem trang công khai" className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"><Eye className="h-4 w-4" aria-hidden /></Link><span className={`hidden sm:inline-flex rounded-md px-3 py-1.5 text-xs font-bold ${t.status === "ongoing" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>
            {{ draft: "Nháp", published: "Đã công bố", ongoing: "Đang diễn ra", completed: "Đã kết thúc" }[t.status]}
          </span></div>
        </header>

        {/* relative: phần tử absolute bên trong (sr-only…) bám vào vùng cuộn này — nếu không chúng thoát ra, kéo dài cả trang và sidebar trôi mất khi cuộn */}
        <div ref={content} className="relative flex-1 overflow-y-auto p-4 sm:p-6 lg:p-7">
          <div className="mx-auto max-w-[1440px] space-y-5">
            {msg && <div className="sticky top-0 z-20" aria-live="polite"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
            <AdminContext.Provider value={ctx}>{children}</AdminContext.Provider>
          </div>
        </div>
      </main>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">{children}</div>;
}

"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarClock, CalendarDays, Eye, Home, LayoutDashboard, Loader2, LogOut, Menu, ScrollText, ShieldCheck, Swords, Users, X, UserCog, MonitorPlay, IdCard,
} from "lucide-react";
import { api, loginUrl } from "../../../lib/api";
import type { Tournament } from "../../../lib/types";
import { Notice } from "../../../components/ui";
import { AdminContext, type ActFn, type AdminCtx } from "./AdminContext";

/**
 * Khung quản trị giải — cùng cấu trúc với admin/layout.tsx của web CLB:
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

  const loadTournament = useCallback(async () => {
    try {
      setT(await api<Tournament>(`/tournaments/${encodeURIComponent(slug)}`));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [slug]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- tải giải từ API (hệ thống ngoài) khi đổi slug / sau mỗi thao tác
  useEffect(() => { void loadTournament(); }, [loadTournament, version]);

  const act: ActFn = useCallback(async (fn, ok, opts) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ kind: "ok", text: typeof ok === "function" ? ok(r) : ok });
      if (opts?.local) opts.local(r);
      else setVersion((v) => v + 1);
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

  const nav = [
    { name: "Tổng quan", href: base, icon: LayoutDashboard },
    { name: "Nội dung & VĐV", href: `${base}/categories`, icon: Users },
    { name: "Vận động viên", href: `${base}/athletes`, icon: IdCard },
    { name: "Điều phối sân", href: `${base}/courts`, icon: MonitorPlay },
    { name: "Xếp lịch sân", href: `${base}/schedule`, icon: CalendarClock },
    { name: "Trận đấu & trọng tài", href: `${base}/matches`, icon: Swords },
    { name: "Ban tổ chức", href: `${base}/staff`, icon: ShieldCheck },
    { name: "Nhật ký thao tác", href: `${base}/log`, icon: ScrollText },
  ];
  const current = nav.find((n) => n.href === pathname);

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

  const sideLink = "min-h-11 flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-colors";
  return (
    <div className="relative h-dvh bg-background flex overflow-hidden">
      {open && <div className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden />}

      <aside className={`theme-fixed fixed lg:static inset-y-0 left-0 w-64 shrink-0 bg-secondary text-slate-300 z-50 transform ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 transition-transform duration-300 flex flex-col border-r border-white/5 shadow-xl`}>
        <div className="p-6 flex items-center justify-between border-b border-white/5 pt-safe">
          <div className="flex items-center gap-3 min-w-0">
            <div className="headline w-9 h-9 bg-primary rounded-xl flex items-center justify-center text-white shadow-[0_0_15px_rgba(220,38,38,0.5)] shrink-0">ST</div>
            <div className="min-w-0">
              <span className="font-black text-lg text-white block leading-tight">BTC Hub</span>
              <span className="block truncate text-[10px] text-red-300 uppercase tracking-wider font-bold">{t.name}</span>
            </div>
          </div>
          <button type="button" className="lg:hidden rounded-lg text-slate-400 hover:text-white hover:bg-white/10 min-h-11 min-w-11 flex items-center justify-center cursor-pointer"
            onClick={() => setOpen(false)} aria-label="Đóng menu quản trị">
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <nav aria-label="Điều hướng quản trị giải" className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {nav.map(({ name, href, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}
                className={`${sideLink} font-medium ${active ? "bg-primary text-white font-bold shadow-md shadow-primary/35" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
                <Icon className={`w-5 h-5 shrink-0 ${active ? "text-white" : "text-slate-400"}`} aria-hidden />
                <span>{name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/5 space-y-1 pb-safe">
          <Link href={`/t/${slug}`} className={`${sideLink} text-slate-300 hover:bg-white/5 hover:text-white`}>
            <Eye className="w-5 h-5 text-slate-400" aria-hidden /><span>Trang công khai</span>
          </Link>
          <Link href={`/t/${slug}/groups`} className={`${sideLink} text-slate-300 hover:bg-white/5 hover:text-white`}>
            <CalendarDays className="w-5 h-5 text-slate-400" aria-hidden /><span>Bảng đấu (công khai)</span>
          </Link>
          <Link href="/accounts" className={`${sideLink} text-slate-300 hover:bg-white/5 hover:text-white`}>
            <UserCog className="w-5 h-5 text-slate-400" aria-hidden /><span>Tài khoản</span>
          </Link>
          <Link href="/" className={`${sideLink} text-slate-300 hover:bg-white/5 hover:text-white`}>
            <Home className="w-5 h-5 text-slate-400" aria-hidden /><span>Trang chủ</span>
          </Link>
          <button type="button" onClick={logout} className={`${sideLink} w-full text-red-400 hover:bg-red-500/10 hover:text-red-300 cursor-pointer`}>
            <LogOut className="w-5 h-5" aria-hidden /><span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      <main id="main" className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-white border-b border-slate-100 flex items-center px-4 lg:px-8 justify-between shrink-0 z-30 pt-safe"
          style={{ height: "calc(4rem + env(safe-area-inset-top, 0px))" }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <button type="button" onClick={() => setOpen(true)} aria-label="Mở menu quản trị"
              className="lg:hidden text-slate-700 hover:bg-slate-100 rounded-xl min-h-11 min-w-11 flex items-center justify-center cursor-pointer">
              <Menu className="w-6 h-6" aria-hidden />
            </button>
            <div className="headline w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-sm text-white shrink-0">ST</div>
            <span className="font-bold text-secondary text-sm truncate">{t.name}</span>
            {current && <span className="hidden sm:inline text-sm text-slate-400">/ {current.name}</span>}
          </div>
          <span className={`hidden sm:inline-flex rounded-full px-3 py-1 text-xs font-bold ${t.status === "ongoing" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>
            {{ draft: "Nháp", published: "Đã công bố", ongoing: "Đang diễn ra", completed: "Đã kết thúc" }[t.status]}
          </span>
        </header>

        {/* relative: phần tử absolute bên trong (sr-only…) bám vào vùng cuộn này — nếu không chúng thoát ra, kéo dài cả trang và sidebar trôi mất khi cuộn */}
        <div className="relative flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-6xl mx-auto space-y-6">
            <div aria-live="polite">{msg && <Notice kind={msg.kind}>{msg.text}</Notice>}</div>
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

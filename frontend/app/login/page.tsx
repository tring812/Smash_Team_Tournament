"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { api, ApiError, safeNext } from "../lib/api";
import type { Viewer } from "../lib/types";
import { CardSkeleton, Notice, textInputClass } from "../components/ui";
import { RedLineBrand } from "../components/RedLineBrand";

/**
 * Đăng nhập bằng tài khoản của web giải (do quản trị viên cấp). Không có đăng ký công khai:
 * BTC/trọng tài được admin tạo tài khoản ở "Tài khoản".
 */
export default function LoginPage() {
  return <Suspense fallback={<CardSkeleton rows={3} />}><LoginInner /></Suspense>;
}

function LoginInner() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devLogin, setDevLogin] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    api<{ user: Viewer | null; devLogin?: boolean }>("/me", { signal: ctl.signal })
      .then((r) => { if (r.user) router.replace(next); else setDevLogin(Boolean(r.devLogin)); })
      .catch(() => {});
    return () => ctl.abort();
  }, [next, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", body: { username: username.trim(), password } });
      window.location.assign(next); // tải lại toàn trang để thanh điều hướng đọc phiên mới
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "Thử quá nhiều lần, vui lòng đợi vài phút." : err instanceof Error ? err.message : "Có lỗi xảy ra");
      setBusy(false);
    }
  }

  async function dev(role: "admin" | "user", name: string) {
    await api("/auth/dev-login", { method: "POST", body: { role, name } });
    window.location.assign(next);
  }

  return (
    <div className="mx-auto grid max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:grid-cols-2">
      <aside className="theme-fixed redline-panel flex flex-col justify-between gap-8 p-6 text-white sm:p-10">
        <RedLineBrand />
        <div><p className="redline-kicker mb-5 text-neutral-300">Sẵn sàng vào sân</p><h2 className="headline text-5xl leading-none sm:text-6xl">Điểm khởi đầu.<br /><span className="text-red-500">Của mọi trận đấu.</span></h2><p className="mt-5 text-sm leading-7 text-neutral-300">Không gian điều hành dành cho Ban tổ chức và trọng tài. Cùng giữ nhịp giải đấu, từ lúc nhận sân đến điểm cuối cùng.</p></div>
        <span aria-hidden className="redline-checker h-5 w-28 text-white/50" />
      </aside>
      <div className="p-6 sm:p-10">
        <p className="redline-kicker mb-4 text-primary">Ban tổ chức · Trọng tài</p>
        <h1 className="headline text-3xl text-slate-900">Đăng nhập</h1>
        <p className="mt-1 text-sm text-slate-500">Dành cho Ban tổ chức và trọng tài. Khán giả xem lịch, bảng đấu không cần đăng nhập.</p>

        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          {error && <Notice kind="error">{error}</Notice>}
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-slate-700">Tên đăng nhập</span>
            <input className={textInputClass} value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-slate-700">Mật khẩu</span>
            <span className="relative block">
              <input className={`${textInputClass} pr-12`} type={show ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500 hover:text-black cursor-pointer">
                {show ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
              </button>
            </span>
          </label>
          <button type="submit" disabled={busy || !username.trim() || !password}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-white transition-colors hover:bg-primary-hover disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed">
            <LogIn className="w-4 h-4" aria-hidden />{busy ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
          <p className="text-center text-xs text-slate-500">Quên mật khẩu? Liên hệ quản trị viên để đặt lại.</p>
        </form>

        {devLogin && (
          <div className="mt-6 border-t border-dashed border-amber-300 pt-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-700">Chỉ môi trường dev</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => dev("admin", "Admin Dev")}
                className="min-h-11 rounded-full border border-amber-300 bg-amber-50 px-4 text-xs font-bold text-amber-800 cursor-pointer">Dev: Admin</button>
              <button type="button" onClick={() => dev("user", "Trọng tài Dev")}
                className="min-h-11 rounded-full border border-amber-300 bg-amber-50 px-4 text-xs font-bold text-amber-800 cursor-pointer">Dev: Trọng tài</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

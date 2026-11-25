"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import SiteNav from "./SiteNav";
import { RedLineBrand } from "./RedLineBrand";
import Link from "next/link";

/**
 * Khung Red Line: điều hướng nổi, nội dung sáng, chân trang đen và vạch xuất phát.
 * Trang quản trị (/t/[slug]/admin/*) dùng layout riêng có sidebar nên không bọc ở đây.
 */
export default function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  // Quản trị có sidebar riêng; màn hình TV (/t/<slug>/tv) chiếu toàn màn hình, không thanh điều hướng.
  if (/^\/t\/[^/]+\/(admin|tv)(\/|$)/.test(pathname)) return <>{children}</>;
  if (pathname === "/") return (
    <>
      <SiteNav />
      <main id="main" className="w-full flex-1 pt-[calc(6.25rem+env(safe-area-inset-top,0px))]">{children}</main>
      <footer className="bg-background pb-safe">
        <div className="mx-auto w-full max-w-[1200px] px-4 pt-12 sm:px-6 sm:pt-16 lg:px-8">
          <div className="grid gap-7 pb-8 sm:grid-cols-[1fr_auto] sm:items-start">
            <div>
              <Link href="/" aria-label="Red Line — Trang chủ" className="inline-flex min-h-11 items-center rounded-lg"><RedLineBrand /></Link>
              <p className="mt-3 max-w-xs text-sm leading-6 text-slate-600">Theo dõi giải cầu lông Smash Team từ vòng bảng đến chung kết.</p>
            </div>
            <nav aria-label="Liên kết chân trang" className="flex flex-wrap gap-x-2 text-sm font-semibold sm:justify-end">
              <Link href="#tournaments" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 hover:text-primary">Danh sách giải<ArrowUpRight className="size-3.5" aria-hidden /></Link>
              <Link href="#features" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 hover:text-primary">Cách theo dõi<ArrowUpRight className="size-3.5" aria-hidden /></Link>
              <Link href="#faq" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 hover:text-primary">Hỏi đáp<ArrowUpRight className="size-3.5" aria-hidden /></Link>
            </nav>
          </div>
          <div className="border-t border-slate-300 py-4 text-xs text-slate-600">Red Line · Smash Team Tournament</div>
          <p aria-hidden className="athlonix-title athlonix-wordmark pb-3 text-center text-secondary">Smash Team</p>
        </div>
      </footer>
    </>
  );
  return (
    <>
      <SiteNav />
      {/* pt bù chiều cao thanh điều hướng cố định để không che nội dung đầu trang */}
      <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-16 pt-28 sm:px-6">{children}</main>
      <footer className="theme-fixed border-t border-red-900/60 bg-secondary text-sm text-neutral-300 pb-safe">
        <div className="mx-auto grid max-w-[1280px] gap-x-8 gap-y-7 px-6 py-10 sm:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr]">
          <div>
            <Link href="/" aria-label="Red Line — Trang chủ" className="inline-flex min-h-11 items-center rounded-lg text-white"><RedLineBrand /></Link>
            <p className="mt-3 max-w-xs leading-6">Theo dõi giải cầu lông Smash Team từ vòng bảng đến chung kết.</p>
          </div>
          <nav aria-label="Liên kết chân trang" className="flex flex-col items-start">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">Khám phá</p>
            <Link href="/#tournaments" className="inline-flex min-h-11 items-center gap-2 rounded-full font-semibold text-white hover:text-red-300">Danh sách giải<ArrowUpRight className="size-3.5" aria-hidden /></Link>
            <Link href="/#features" className="inline-flex min-h-11 items-center gap-2 rounded-full font-semibold text-white hover:text-red-300">Cách theo dõi<ArrowUpRight className="size-3.5" aria-hidden /></Link>
          </nav>
          <div className="hidden lg:block lg:text-right">
            <p className="headline text-3xl text-white">Bắt đầu từ <span className="text-red-400">vạch đỏ.</span></p>
            <span aria-hidden className="redline-checker mt-4 inline-block h-4 w-24 text-white/40" />
          </div>
        </div>
        <div className="border-t border-white/10 px-6 py-4 text-center text-xs tracking-wide">Red Line · Smash Team Tournament</div>
      </footer>
    </>
  );
}

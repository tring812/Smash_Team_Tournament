"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
  return (
    <>
      <SiteNav />
      {/* pt bù chiều cao thanh điều hướng cố định để không che nội dung đầu trang */}
      <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-16 pt-28 sm:px-6">{children}</main>
      <footer className="theme-fixed border-t-4 border-primary bg-secondary text-sm text-neutral-400 pb-safe">
        <div className="mx-auto grid max-w-[1280px] gap-8 px-6 py-10 sm:grid-cols-2 sm:items-end">
          <div><Link href="/" aria-label="Red Line — Trang chủ" className="inline-block rounded-lg text-white"><RedLineBrand /></Link><p className="mt-4 max-w-sm text-sm leading-6">Giải cầu lông Smash Team.<br />Mỗi trận đấu là một điểm khởi đầu.</p></div>
          <div className="sm:text-right"><p className="headline text-3xl text-white">Bắt đầu từ <span className="text-red-500">vạch đỏ.</span></p><span aria-hidden className="redline-checker mt-4 inline-block h-4 w-32 text-white/40" /></div>
        </div>
        <div className="border-t border-white/10 px-6 py-4 text-center text-xs tracking-wide">Red Line · Smash Team Tournament</div>
      </footer>
    </>
  );
}

"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import SiteNav from "./SiteNav";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Khung trang công khai: thanh điều hướng nổi + nội dung + chân trang (giống trang chủ web CLB).
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
      <main id="main" className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-16 pt-28">{children}</main>
      <footer className="theme-fixed bg-black py-8 text-center text-sm text-slate-400 pb-safe">
        <p><span className="headline text-base text-white">Smash <span className="text-red-500">Open Cup</span></span></p>
        <p className="mt-1">Giải cầu lông mở rộng do Smash Team tổ chức</p>
        <div className="mt-4 flex items-center justify-center gap-3"><span>Giao diện</span><ThemeToggle tone="onDark" /></div>
      </footer>
    </>
  );
}

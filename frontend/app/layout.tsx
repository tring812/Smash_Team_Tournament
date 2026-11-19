import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";
import SiteShell from "./components/SiteShell";
import { THEME_BOOT_SCRIPT } from "./components/ThemeToggle";

// Cùng bộ font với web CLB: Inter cho nội dung, Barlow Condensed cho tiêu đề thể thao (đều có tiếng Việt).
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "vietnamese"], display: "swap" });
const barlow = Barlow_Condensed({ variable: "--font-barlow", subsets: ["latin", "vietnamese"], weight: ["700", "800"], style: ["italic", "normal"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Smash Open Cup", template: "%s · Smash Open Cup" },
  description: "Giải cầu lông mở rộng Smash Team: lịch thi đấu theo sân, bảng đấu, nhánh loại trực tiếp và nhập điểm trọng tài.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: script đầu trang có thể đặt data-theme trước khi React nhận trang.
    <html lang="vi" className={`${inter.variable} ${barlow.variable} font-sans h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Đặt giao diện đã chọn TRƯỚC khi vẽ → không loé trắng ở chế độ Tối. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:shadow">
          Bỏ qua tới nội dung
        </a>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}

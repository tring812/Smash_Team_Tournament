import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SiteShell from "./components/SiteShell";

// Gộp Latin/tiếng Việt trong từng WOFF2 để tránh tải thêm Latin mở rộng do dải ký tự chồng nhau.
const inter = localFont({
  src: [{ path: "./fonts/Inter-latin-vietnamese.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  fallback: ["Red Line Inter Fallback", "Arial", "sans-serif"],
});
const barlow = localFont({
  src: [
    { path: "./fonts/BarlowCondensed-Bold-latin-vietnamese.woff2", weight: "700", style: "normal" },
    { path: "./fonts/BarlowCondensed-ExtraBold-latin-vietnamese.woff2", weight: "800", style: "normal" },
    { path: "./fonts/BarlowCondensed-BoldItalic-latin-vietnamese.woff2", weight: "700", style: "italic" },
    { path: "./fonts/BarlowCondensed-ExtraBoldItalic-latin-vietnamese.woff2", weight: "800", style: "italic" },
  ],
  variable: "--font-barlow",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  fallback: ["Red Line Barlow Fallback", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: { default: "Red Line · Smash Team", template: "%s · Red Line" },
  description: "Red Line — giải cầu lông Smash Team. Từ vạch xuất phát đến điểm quyết định: lịch thi đấu, bảng đấu, nhánh loại trực tiếp và bàn trọng tài.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${inter.variable} ${barlow.variable} font-sans h-full antialiased`}>
      <head>
        {/* Web chỉ còn giao diện sáng: xoá lựa chọn Sáng/Tối cũ còn lưu trên máy (khoá "st-theme"). */}
        <script dangerouslySetInnerHTML={{ __html: 'try{localStorage.removeItem("st-theme")}catch(e){}' }} />
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

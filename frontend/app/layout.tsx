import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";
import SiteShell from "./components/SiteShell";

// Red Line: Inter cho dữ liệu, Barlow Condensed cho tiêu đề thể thao (đều hỗ trợ tiếng Việt).
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "vietnamese"], display: "swap" });
const barlow = Barlow_Condensed({ variable: "--font-barlow", subsets: ["latin", "vietnamese"], weight: ["700", "800"], style: ["italic", "normal"], display: "swap" });

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

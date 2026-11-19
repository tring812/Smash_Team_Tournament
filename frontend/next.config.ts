import type { NextConfig } from "next";

// Backend chạy riêng; Next proxy /api → backend để trình duyệt chỉ thấy MỘT origin
// (cookie phiên SameSite=Lax + kiểm tra Origin hoạt động, không cần CORS).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5100";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    // TODO(Tier 2): chuyển sang CSP nonce (proxy.ts) để bỏ 'unsafe-inline' cho script.
    value: [
      "default-src 'self'",
      // React dev cần eval để dựng lại call stack; production KHÔNG có 'unsafe-eval'.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

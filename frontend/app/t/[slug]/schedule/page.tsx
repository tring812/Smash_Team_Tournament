import { redirect } from "next/navigation";

/**
 * Đường dẫn cũ /t/<slug>/schedule (đã chia sẻ trước đây) → trang giải, tab Lịch thi đấu.
 * `?view=tree` cũ → tab Loại trực tiếp. Chỉ giữ tham số hợp lệ để không phản chiếu dữ liệu tuỳ ý vào URL đích.
 */
export default async function LegacyScheduleRedirect({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const out = new URLSearchParams();
  if (/^[A-Z0-9]{1,10}$/.test(one("cat"))) out.set("cat", one("cat"));
  const base = `/t/${encodeURIComponent(slug)}`;
  if (one("view") === "tree") {
    const qs = out.toString();
    redirect(`${base}/bracket${qs ? `?${qs}` : ""}`);
  }
  if (["court", "table"].includes(one("view"))) out.set("view", one("view"));
  if (/^\d{4}-\d{2}-\d{2}$/.test(one("day"))) out.set("day", one("day"));
  if (/^\d{1,2}$/.test(one("court"))) out.set("court", one("court"));
  const qs = out.toString();
  redirect(`${base}${qs ? `?${qs}` : ""}`);
}

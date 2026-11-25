"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, CalendarClock, Flag, MapPin, Shuffle, Smartphone, Trophy } from "lucide-react";
import { api } from "./lib/api";
import type { TournamentSummary } from "./lib/types";
import { sortTournaments } from "./lib/tournamentOrder";
import { CardSkeleton, EmptyState } from "./components/ui";
import { DeletedTournaments } from "./components/DeletedTournaments";
import { StartingCourt } from "./components/RedLineBrand";

const STATUS_LABEL: Record<TournamentSummary["status"], string> = {
  draft: "Nháp", published: "Sắp diễn ra", ongoing: "Đang diễn ra", completed: "Đã kết thúc",
};
const dateFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "full" });

const FEATURES = [
  { icon: Shuffle, t: "Bốc thăm ngẫu nhiên", d: "Mỗi lần bốc ra một kết quả khác, tự tách VĐV cùng CLB ra các bảng." },
  { icon: CalendarClock, t: "Lịch theo sân", d: "Vòng bảng và loại trực tiếp xếp riêng ngày giờ, không VĐV nào đánh 2 sân cùng lúc." },
  { icon: Smartphone, t: "Trọng tài trên điện thoại", d: "Chạm để ghi điểm từng quả, kết quả lên bảng ngay." },
];

export default function HomePage() {
  const [items, setItems] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = () => api<TournamentSummary[]>("/tournaments").then((ts) => setItems(sortTournaments(ts))).catch((e: Error) => setError(e.message));
  useEffect(() => { void loadList(); }, []);

  const featured = items?.find((t) => t.status === "ongoing") ?? items?.find((t) => t.status === "published") ?? items?.[0];

  return (
    <div className="space-y-12 sm:space-y-16">
      <section aria-labelledby="hero-title" className="theme-fixed redline-panel relative isolate overflow-hidden rounded-xl text-white">
        <div className="relative z-10 flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4 sm:px-10">
          <p className="redline-kicker text-neutral-300">Smash Team · Giải cầu lông</p>
          <span aria-hidden className="redline-checker h-4 w-16 shrink-0 text-white/70" />
        </div>
        <div className="grid items-center lg:grid-cols-[1.05fr_1fr]">
          <div className="relative z-10 px-6 pt-8 sm:px-10 sm:pt-12 lg:pb-12">
            <p className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-red-400"><Flag className="h-4 w-4" aria-hidden />Từ vạch xuất phát</p>
            <h1 id="hero-title" className="headline redline-hero-title">Mỗi trận đấu.<br />Một <span className="text-red-500">khởi đầu.</span></h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-neutral-300">Bước qua vạch đỏ. Mang tinh thần đồng đội vào sân. Theo dõi lịch đấu, từng pha cầu và hành trình đến điểm số cuối cùng.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={featured ? `/t/${featured.slug}` : "#tournaments"} className="inline-flex min-h-12 items-center justify-center gap-5 rounded-lg bg-primary px-5 text-sm font-bold text-white transition-colors hover:bg-primary-hover">
                {featured ? "Vào giải đấu" : "Khám phá giải đấu"}<ArrowUpRight className="h-5 w-5" aria-hidden />
              </Link>
              <a href="#tournaments" className="inline-flex min-h-12 items-center gap-3 rounded-lg border border-white/25 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10">Lịch thi đấu<ArrowDown className="h-4 w-4" aria-hidden /></a>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-xl px-2 lg:-ml-5 lg:w-[calc(100%+1.25rem)]">
            <span aria-hidden className="headline absolute left-7 top-5 text-7xl text-white/5 sm:text-9xl">Red Line</span>
            <StartingCourt />
          </div>
        </div>
        <div className="relative z-10 grid grid-cols-3 border-t border-white/15">
          {[{ n: "01", t: "Sẵn sàng vào sân", d: "Tra lịch · Tìm sân · Theo dõi trận" }, { n: "02", t: "Từng điểm số", d: "Bàn trọng tài trên điện thoại" }, { n: "03", t: "Chung một tinh thần", d: "Hết mình trong từng pha cầu" }].map(({ n, t, d }) => (
            <div key={n} className="flex flex-col items-start gap-2 border-r border-white/10 px-3 py-4 last:border-r-0 sm:flex-row sm:items-center sm:gap-4 sm:px-6 sm:py-5">
              <span className="font-display text-3xl font-bold italic text-red-400">{n}</span>
              <div><p className="text-xs font-bold sm:text-sm">{t}</p><p className="mt-1 hidden text-xs text-neutral-400 sm:block">{d}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section id="tournaments" aria-labelledby="list-h" className="scroll-mt-28">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-300 pb-5">
          <div>
            <p className="redline-kicker mb-3 text-primary">Theo dõi hành trình</p>
            <h2 id="list-h" className="headline text-4xl text-slate-900 sm:text-5xl">Đường cầu <span className="text-primary">đang mở.</span></h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">Chọn giải để xem lịch thi đấu, bảng xếp hạng và nhánh loại trực tiếp.</p>
          </div>
          <span className="font-display text-2xl font-bold italic text-slate-500">{items ? `${String(items.length).padStart(2, "0")} giải đấu` : "Đang tải…"}</span>
        </div>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {items === null && !error && <CardSkeleton rows={2} />}
        {items?.length === 0 && <EmptyState icon={<Trophy className="w-10 h-10" />} title="Chưa có giải nào được công bố" />}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items?.map((t, index) => (
            <li key={t.id}>
              <Link href={`/t/${t.slug}`} className="redline-card group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-1 hover:shadow-lg motion-reduce:transform-none">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <span aria-hidden className="font-display text-3xl font-bold italic text-slate-300">{String(index + 1).padStart(2, "0")}</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${t.status === "ongoing" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                  {t.status === "ongoing" && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />}
                  {STATUS_LABEL[t.status]}
                </span>
                </div>
                <h3 className="headline text-3xl leading-tight text-slate-900 group-hover:text-primary">{t.name}</h3>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-500"><CalendarClock className="w-4 h-4 shrink-0" aria-hidden />{dateFmt.format(new Date(t.starts_at))}</p>
                {t.venue && <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500"><MapPin className="w-4 h-4 shrink-0" aria-hidden />{t.venue}</p>}
                <span className="mt-auto flex items-center justify-between gap-3 pt-6 text-xs font-bold uppercase tracking-wider text-primary">Xem giải đấu<ArrowUpRight className="h-5 w-5" aria-hidden /></span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <DeletedTournaments onRestored={() => void loadList()} />

      <section className="theme-fixed rounded-xl bg-secondary p-6 text-white sm:p-10" aria-labelledby="features-title">
        <div className="flex flex-wrap items-center justify-between gap-5 border-b border-white/15 pb-6">
          <div><p className="redline-kicker mb-3 text-neutral-400">Tập trung vào trận đấu</p><h2 id="features-title" className="headline text-4xl">Từ lượt bốc thăm.<br /><span className="text-red-500">Đến điểm quyết định.</span></h2></div>
          <span aria-hidden className="redline-checker h-8 w-24 text-white/30" />
        </div>
        <ul className="mt-7 grid gap-7 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, t, d }) => (
            <li key={t} className="border-l border-white/20 pl-5">
              <Icon className="mb-4 h-6 w-6 text-red-400" aria-hidden />
              <h3 className="headline text-2xl">{t}</h3>
              <p className="mt-2 text-sm leading-6 text-neutral-400">{d}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

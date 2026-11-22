"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarClock, MapPin, Shuffle, Smartphone, Trophy } from "lucide-react";
import { api } from "./lib/api";
import type { TournamentSummary } from "./lib/types";
import { sortTournaments } from "./lib/tournamentOrder";
import { CardSkeleton, EmptyState } from "./components/ui";
import { DeletedTournaments } from "./components/DeletedTournaments";

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
    <div className="space-y-10">
      <section className="theme-fixed overflow-hidden rounded-3xl bg-black shadow-xl">
        <Image src="/smash-open-cup-2026.webp" alt="Smash Open Cup 2026 — giải cầu lông mở rộng của Smash Team"
          width={1640} height={924} priority
          // Cắt gọn banner (giữ logo + tựa giải) để danh sách giải hiện ngay màn hình đầu.
          className="h-48 w-full object-cover object-[50%_30%] sm:h-64 lg:h-80" />
        <div className="flex flex-wrap items-center justify-between gap-4 border-t-4 border-primary px-5 py-5 sm:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-red-400">Smash Team · 2026</p>
            <p className="headline text-2xl text-white sm:text-3xl">Giải cầu lông <span className="text-red-500">mở rộng</span></p>
          </div>
          {featured && (
            <Link href={`/t/${featured.slug}`}
              className="flex items-center gap-2 min-h-11 pl-5 pr-1.5 rounded-full bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors">
              Xem giải {STATUS_LABEL[featured.status].toLowerCase()}
              <span className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center"><ArrowUpRight className="w-4 h-4" aria-hidden /></span>
            </Link>
          )}
        </div>
      </section>

      <section aria-labelledby="list-h">
        <div className="mb-5 flex items-end justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 id="list-h" className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Các giải</h2>
            <p className="text-slate-500 mt-1">Lịch thi đấu, bảng đấu và nhánh loại trực tiếp cập nhật theo thời gian thực.</p>
          </div>
        </div>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {items === null && !error && <CardSkeleton rows={2} />}
        {items?.length === 0 && <EmptyState icon={<Trophy className="w-10 h-10" />} title="Chưa có giải nào được công bố" />}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items?.map((t) => (
            <li key={t.id}>
              <Link href={`/t/${t.slug}`} className="group block h-full bg-white rounded-2xl border border-slate-100 shadow-sm p-5 transition-all hover:shadow-md hover:border-red-200">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${t.status === "ongoing" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                  {t.status === "ongoing" && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />}
                  {STATUS_LABEL[t.status]}
                </span>
                <h3 className="mt-3 text-lg font-bold tracking-tight text-slate-900 group-hover:text-primary">{t.name}</h3>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-500"><CalendarClock className="w-4 h-4 shrink-0" aria-hidden />{dateFmt.format(new Date(t.starts_at))}</p>
                {t.venue && <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500"><MapPin className="w-4 h-4 shrink-0" aria-hidden />{t.venue}</p>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <DeletedTournaments onRestored={() => void loadList()} />

      <ul className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, t, d }) => (
          <li key={t} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center mb-3" aria-hidden>
              <Icon className="w-5 h-5 text-white" />
            </div>
            <h2 className="font-bold text-slate-900">{t}</h2>
            <p className="mt-1 text-sm text-slate-500">{d}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, CalendarClock, Flag, MapPin, Plus, Shuffle, Smartphone } from "lucide-react";
import { api } from "./lib/api";
import type { TournamentSummary } from "./lib/types";
import { homeTournamentView, sortTournaments, type TournamentFilter } from "./lib/tournamentOrder";
import { CardSkeleton, EmptyState, Notice } from "./components/ui";
import { DeletedTournaments } from "./components/DeletedTournaments";
import { StartingCourt } from "./components/RedLineBrand";

const STATUS = {
  draft: { label: "Nháp", color: "bg-amber-50 text-amber-800" },
  published: { label: "Sắp diễn ra", color: "bg-slate-100 text-slate-700" },
  ongoing: { label: "Đang diễn ra", color: "bg-red-50 text-red-700" },
  completed: { label: "Đã kết thúc", color: "bg-slate-100 text-slate-600" },
} satisfies Record<TournamentSummary["status"], { label: string; color: string }>;
const dateFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "full" });
const FILTERS: TournamentFilter[] = ["all", "ongoing", "published", "completed", "draft"];

const FEATURES = [
  { icon: CalendarClock, title: "Lịch theo sân", desc: "Xem giờ thi đấu, sân và đối thủ từ vòng bảng đến chung kết." },
  { icon: Shuffle, title: "Bốc thăm ngẫu nhiên", desc: "Chia bảng tự động và ưu tiên tách VĐV cùng CLB để mỗi bảng cân bằng hơn." },
  { icon: Smartphone, title: "Ghi điểm trực tiếp", desc: "Trọng tài ghi điểm từng pha trên điện thoại để khán giả theo dõi diễn biến." },
];

const FAQ = [
  { title: "Xem giờ và sân thi đấu ở đâu?", answer: "Chọn giải trong Danh sách giải, rồi mở tab Lịch thi đấu. Bạn có thể xem theo giờ, theo sân hoặc dạng bảng." },
  { title: "Làm sao để tìm lịch của một VĐV?", answer: "Mở giải, nhập tên vào ô tìm VĐV và chọn đúng người. Hồ sơ VĐV hiển thị các trận và bảng đấu liên quan." },
  { title: "Có cần đăng nhập để xem giải không?", answer: "Không. Khán giả có thể xem lịch, bảng đấu, nhánh loại trực tiếp và tỉ số của các giải đã công bố." },
];

const sectionWrap = "mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8";
const sectionSpace = "py-14 sm:py-20";
const action = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md border px-4 text-xs font-bold uppercase tracking-wide transition-colors sm:px-5";
const primaryLink = `${action} border-secondary bg-secondary text-white hover:border-primary-hover hover:bg-primary-hover`;
const outlineLink = `${action} border-slate-400 text-foreground hover:border-secondary hover:bg-slate-100`;
const lightLink = `${action} border-white bg-white text-foreground hover:border-slate-200 hover:bg-slate-200`;
const outlineDarkLink = `${action} border-white/35 text-white hover:border-white hover:bg-white/10`;

function TournamentBadge({ status }: { status: TournamentSummary["status"] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${STATUS[status].color}`}>
      {status === "ongoing" && <span aria-hidden className="size-1.5 rounded-full bg-primary" />}
      {STATUS[status].label}
    </span>
  );
}

function TournamentDetails({ tournament, className }: { tournament: TournamentSummary; className: string }) {
  return (
    <div className={`space-y-2 text-sm ${className}`}>
      <p className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <time dateTime={tournament.starts_at}>{dateFmt.format(new Date(tournament.starts_at))}</time>
      </p>
      {tournament.venue && <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{tournament.venue}</span></p>}
    </div>
  );
}

export default function HomePage() {
  const [items, setItems] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TournamentFilter>("all");

  const loadList = () => api<TournamentSummary[]>("/tournaments")
    .then((ts) => { setItems(sortTournaments(ts)); setError(null); })
    .catch((e: Error) => setError(e.message));
  useEffect(() => { void loadList(); }, []);

  const { featured, visible, showDraft } = homeTournamentView(items ?? [], filter);
  const filters = FILTERS.filter((key) => key !== "draft" || showDraft);

  return (
    <>
      <section aria-labelledby="hero-title" className="py-10 sm:py-16 lg:py-20">
        <div className={`${sectionWrap} grid items-center gap-8 min-[900px]:grid-cols-2 lg:gap-14`}>
          <div className="min-w-0">
            <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[.12em] text-slate-600">
              <Flag className="size-4 shrink-0 text-primary" aria-hidden /> Smash Team · Giải cầu lông
            </p>
            <h1 id="hero-title" className="athlonix-title athlonix-hero-title">
              Cú đập.<br />Pha cầu.<br /><span className="text-primary min-[900px]:whitespace-nowrap min-[900px]:text-[.84em]">Khoảnh khắc.</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-slate-600">
              Xem lịch, bảng đấu và tỉ số trực tiếp của các giải cầu lông Smash Team, từ vòng bảng đến chung kết.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={featured ? `/t/${featured.slug}` : "#tournaments"} className={primaryLink}>
                {featured ? "Vào giải đấu" : "Xem các giải đấu"}<ArrowUpRight className="size-4" aria-hidden />
              </Link>
              <a href={featured ? "#tournaments" : "#features"} className={outlineLink}>
                {featured ? "Danh sách giải" : "Cách theo dõi"}<ArrowDown className="size-4" aria-hidden />
              </a>
            </div>
          </div>
          <figure className="athlonix-court theme-fixed relative grid aspect-[5/4] min-w-0 place-items-center overflow-hidden rounded-[.875rem] text-white min-[900px]:aspect-square">
            <span aria-hidden className="athlonix-title pointer-events-none absolute right-4 top-4 text-5xl text-white/10 sm:text-7xl">Red Line</span>
            <div className="relative w-[92%]"><StartingCourt /></div>
            <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-4 pb-4 text-[10px] font-bold uppercase tracking-[.12em] text-white sm:px-6 sm:pb-6 sm:text-xs">
              <span>Vạch xuất phát</span><span aria-hidden className="redline-checker h-2 w-16 shrink-0 text-white/55" />
            </figcaption>
          </figure>
        </div>
      </section>

      <section id="features" aria-labelledby="features-title" className={`${sectionSpace} theme-fixed scroll-mt-36 bg-secondary text-white`}>
        <div className={sectionWrap}>
          <div className="grid items-center gap-8 min-[900px]:grid-cols-[1fr_1.1fr] lg:gap-14">
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-[.12em] text-red-300">Theo dõi giải đấu</p>
              <h2 id="features-title" className="athlonix-title athlonix-section-title text-balance">Từ bốc thăm đến chung kết.</h2>
              <p className="mt-4 max-w-md text-sm leading-7 text-neutral-300 sm:text-base">
                Tra giờ thi đấu, tìm sân và theo dõi kết quả ngay trên điện thoại, dù bạn đang ở nhà hay tại sân.
              </p>
            </div>
            {featured ? (
              <article aria-labelledby="featured-title" className="athlonix-featured min-w-0 rounded-xl border border-white/15 p-5 sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-[.12em] text-red-200">Giải nổi bật</p>
                  <TournamentBadge status={featured.status} />
                </div>
                <h3 id="featured-title" className="athlonix-title mt-4 break-words text-3xl sm:text-4xl">{featured.name}</h3>
                <TournamentDetails tournament={featured} className="mt-4 text-neutral-200" />
                <Link href={`/t/${featured.slug}`} className={`${lightLink} mt-5`}>Xem lịch thi đấu<ArrowUpRight className="size-4" aria-hidden /></Link>
              </article>
            ) : (
              <div aria-hidden className="athlonix-featured grid min-h-40 place-items-center rounded-xl border border-white/15 px-4">
                <span className="athlonix-title text-center text-5xl text-white/70 sm:text-6xl">Smash Team</span>
              </div>
            )}
          </div>
          <ul className="mt-8 grid gap-3 sm:mt-10 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }, index) => (
              <li key={title} className="flex min-h-36 flex-col items-start rounded-xl border border-white/10 bg-white/[.06] p-4 sm:p-5">
                <span className="mb-5 grid size-8 place-items-center rounded-md bg-primary text-xs font-bold text-white" aria-hidden>0{index + 1}</span>
                <h3 className="athlonix-title mt-auto flex items-center gap-2 text-2xl"><Icon className="size-4 shrink-0 text-red-300" aria-hidden />{title}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-300">{desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="tournaments" aria-labelledby="list-h" className={`${sectionSpace} scroll-mt-36`}>
        <div className={sectionWrap}>
          <div className="mb-7">
            <p className="mb-3 text-xs font-bold uppercase tracking-[.12em] text-slate-600">Lịch thi đấu Smash Team</p>
            <h2 id="list-h" className="athlonix-title athlonix-section-title">Các giải đấu.</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 sm:text-base">Chọn một giải để xem lịch, bảng đấu và nhánh loại trực tiếp.</p>
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          {items === null && !error && <><p role="status" className="sr-only">Đang tải danh sách giải</p><CardSkeleton rows={2} /></>}
          {items?.length === 0 && <EmptyState icon={<CalendarClock className="size-10" />} title="Chưa có giải nào được công bố" />}
          {items && items.length > 0 && (
            <>
              <div role="group" aria-label="Lọc giải theo trạng thái" className="mb-6 flex flex-wrap gap-2">
                {filters.map((key) => (
                  <button key={key} type="button" aria-pressed={filter === key} aria-controls="tournament-results" onClick={() => setFilter(key)}
                    className={`min-h-11 cursor-pointer rounded-md border px-3.5 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${filter === key ? "border-secondary bg-secondary text-white" : "border-slate-300 text-slate-700 hover:border-slate-600 hover:bg-white"}`}>
                    {key === "all" ? "Tất cả" : STATUS[key].label}
                  </button>
                ))}
              </div>
              <p role="status" className="sr-only">{visible.length} giải đấu</p>
              <div id="tournament-results">
                {visible.length === 0 ? <EmptyState title="Không có giải ở trạng thái này" desc="Chọn trạng thái khác để xem thêm giải." /> : (
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {visible.map((tournament) => (
                      <li key={tournament.id} className="min-w-0">
                        <Link href={`/t/${tournament.slug}`} className="group flex h-full flex-col rounded-xl border border-transparent bg-slate-100 p-5 transition-colors hover:border-red-300 sm:p-6">
                          <div className="mb-5 flex items-center justify-between gap-2">
                            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-white"><CalendarClock className="size-4" /></span>
                            <TournamentBadge status={tournament.status} />
                          </div>
                          <h3 className="athlonix-title break-words text-2xl group-hover:text-primary sm:text-3xl">{tournament.name}</h3>
                          <TournamentDetails tournament={tournament} className="mt-3 text-slate-600" />
                          <span className="mt-auto flex items-center justify-between gap-2 pt-5 text-sm font-semibold text-red-700">Xem giải đấu<ArrowUpRight className="size-4 shrink-0" aria-hidden /></span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          <div className="not-empty:mt-8"><DeletedTournaments onRestored={() => void loadList()} /></div>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-title" className={`${sectionSpace} scroll-mt-36 border-t border-slate-200`}>
        <div className={`${sectionWrap} grid gap-6 min-[900px]:grid-cols-[.75fr_1.25fr] lg:gap-14`}>
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[.12em] text-slate-600">Hướng dẫn khán giả</p>
            <h2 id="faq-title" className="athlonix-title athlonix-section-title text-balance">Câu hỏi thường gặp.</h2>
          </div>
          <div className="space-y-2">
            {FAQ.map(({ title, answer }) => (
              <details key={title} className="group rounded-lg bg-slate-100">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-4 py-3.5 text-sm font-semibold [&::-webkit-details-marker]:hidden sm:px-5">
                  {title}<Plus className="size-5 shrink-0 text-primary group-open:rotate-45" aria-hidden />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-slate-600 sm:px-5">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-title" className={`${sectionSpace} athlonix-cta theme-fixed text-center text-white`}>
        <div className={sectionWrap}>
          <h2 id="cta-title" className="athlonix-title athlonix-section-title text-balance">Bắt đầu từ vạch đỏ.</h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-neutral-200 sm:text-base">Chọn giải để biết trận tiếp theo diễn ra ở đâu và lúc nào.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href="#tournaments" className={lightLink}>Xem các giải đấu<ArrowUpRight className="size-4" aria-hidden /></a>
            <a href="#faq" className={outlineDarkLink}>Hướng dẫn<ArrowUpRight className="size-4" aria-hidden /></a>
          </div>
        </div>
      </section>
    </>
  );
}

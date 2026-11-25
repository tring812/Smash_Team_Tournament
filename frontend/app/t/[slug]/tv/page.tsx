"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Maximize, Megaphone } from "lucide-react";
import { api, fmtTime } from "../../../lib/api";
import { usePoll } from "../../../lib/usePoll";
import { useLive } from "../../../lib/useLive";
import type { Match, Tournament } from "../../../lib/types";
import { matchTitle } from "../../../components/MatchViews";

const clockFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

/**
 * MÀN HÌNH CHIẾU TẠI NHÀ THI ĐẤU (TV / máy chiếu) — công khai, không cần đăng nhập.
 * Mỗi sân một ô chữ lớn: đang đánh (tỉ số game hiện tại + các game đã xong) hoặc "MỜI RA SÂN" nhấp nháy;
 * dải dưới: các trận sắp tới. Cập nhật tức thì qua SSE, polling 15s dự phòng. Nền tối cố định (dễ đọc từ xa,
 * không chói), độ tương phản chữ ≥ 7:1.
 */
export default function TvPage() {
  const { slug } = useParams<{ slug: string }>();
  const t = usePoll((s) => api<Tournament>(`/tournaments/${encodeURIComponent(slug)}`, { signal: s }), [slug], 300_000);
  const { tick, live } = useLive(t.data?.id);
  const matches = usePoll(
    (s) => (t.data ? api<Match[]>(`/tournaments/${t.data.id}/matches`, { signal: s }) : Promise.resolve([])),
    [t.data?.id, tick], live ? 30_000 : 15_000,
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(i); }, []);

  const { courts, upcoming } = useMemo(() => {
    const all = (matches.data ?? []).filter((m) => m.status !== "bye" && m.status !== "cancelled");
    const n = Math.max(t.data?.courts ?? 0, ...all.map((m) => m.court ?? 0));
    const onCourt = (c: number) => all.find((m) => m.court === c && (m.status === "live" || m.calledAt));
    const waiting = all.filter((m) => (m.status === "scheduled" || m.status === "pending") && !m.calledAt && m.a && m.b)
      .sort((a, b) => (a.scheduledAt ?? "~").localeCompare(b.scheduledAt ?? "~"));
    return { courts: Array.from({ length: n }, (_, i) => ({ court: i + 1, m: onCourt(i + 1) })), upcoming: waiting.slice(0, 8) };
  }, [matches.data, t.data?.courts]);

  if (t.error) return <div className="grid min-h-dvh place-items-center bg-neutral-950 text-xl text-white"><p role="alert">{t.error}</p></div>;
  const cols = courts.length <= 2 ? "lg:grid-cols-2" : courts.length <= 4 ? "lg:grid-cols-2" : courts.length <= 6 ? "lg:grid-cols-3" : "lg:grid-cols-4";

  return (
    <div className="theme-fixed min-h-dvh bg-neutral-950 text-white" style={{ colorScheme: "dark" }}>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-4 border-red-600 px-6 py-4">
        <div className="min-w-0 flex-1"><p className="redline-kicker mb-2 text-neutral-400">Red Line · Smash Team</p><h1 className="headline truncate text-3xl lg:text-5xl">{t.data?.name ?? "…"}</h1></div>
        <div className="flex flex-wrap items-center gap-4">
          <span className={`flex items-center gap-2 text-sm font-semibold ${live ? "text-emerald-400" : "text-neutral-400"}`}>
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${live ? "animate-pulse bg-emerald-400" : "bg-neutral-500"}`} />
            {live ? "Trực tiếp" : "Đang kết nối…"}
          </span>
          <time className="tabular text-3xl font-bold lg:text-5xl">{clockFmt.format(now)}</time>
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}
            aria-label="Toàn màn hình" className="grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">
            <Maximize className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      <main className={`grid gap-4 p-4 sm:grid-cols-2 ${cols}`} aria-live="polite">
        {courts.map(({ court, m }) => {
          const called = Boolean(m && m.status !== "live");
          const last = m?.games[m.games.length - 1];
          return (
            <section key={court} aria-label={`Sân ${court}`}
              className={`flex min-h-56 min-w-0 flex-col rounded-xl border-2 border-t-4 p-5 ${!m ? "border-white/10 bg-white/[0.03]" : called ? "border-amber-400 bg-amber-400/10" : "border-red-500 bg-red-600/10"}`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="headline text-4xl">Sân {court}</h2>
                {m && (called
                  ? <span className="flex animate-pulse items-center gap-2 rounded-full bg-amber-400 px-4 py-1.5 text-lg font-black text-black"><Megaphone className="h-5 w-5" aria-hidden />MỜI RA SÂN</span>
                  : <span className="rounded-full bg-red-600 px-4 py-1.5 text-lg font-black">ĐANG ĐÁNH</span>)}
              </div>
              {!m ? <p className="mt-auto text-2xl text-neutral-400">Sân trống</p> : (
                <>
                  <p className="text-lg text-neutral-300">{matchTitle(m)}</p>
                  {(["a", "b"] as const).map((side, i) => (
                    <div key={side} className="mt-2 flex items-center justify-between gap-4">
                      <span className={`min-w-0 truncate text-2xl font-bold lg:text-3xl ${m.winner === side ? "text-emerald-400" : ""}`}>{m[side]?.name}</span>
                      {!called && (
                        <span className="flex shrink-0 items-baseline gap-3 tabular">
                          {m.games.slice(0, -1).map((g, k) => <span key={k} className="text-xl text-neutral-400">{g[i]}</span>)}
                          <span className="w-16 text-right text-5xl font-black lg:text-6xl">{last?.[i] ?? 0}</span>
                        </span>
                      )}
                    </div>
                  ))}
                </>
              )}
            </section>
          );
        })}
      </main>

      {upcoming.length > 0 && (
        <footer className="border-t border-white/10 px-6 py-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">Trận sắp tới</h2>
          <ol className="grid gap-x-8 gap-y-2 text-lg md:grid-cols-2">
            {upcoming.map((m) => (
              <li key={m.id} className="flex min-w-0 gap-3">
                <span className="tabular shrink-0 text-neutral-400">{m.scheduledAt ? fmtTime(m.scheduledAt) : "—"}</span>
                <span className="shrink-0 font-bold text-red-400">{m.category.code}</span>
                <span className="truncate">{m.a?.name} <span className="text-neutral-400">vs</span> {m.b?.name}</span>
              </li>
            ))}
          </ol>
        </footer>
      )}
    </div>
  );
}

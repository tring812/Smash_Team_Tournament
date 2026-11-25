"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { api, fmtTime } from "../../lib/api";
import { usePoll } from "../../lib/usePoll";
import { useLive } from "../../lib/useLive";
import { replay } from "../../lib/rally";
import type { Match, Rally, TournamentSummary } from "../../lib/types";
import { matchTitle, StatusBadge } from "../../components/MatchViews";
import { isDoublesMatch, RallySheet } from "../../components/RallySheet";
import { setTally } from "../../lib/scoring";

type MatchWithRallies = Match & { rallies: Rally[] };

/**
 * Biên bản diễn biến điểm — CHỈ XEM (khán giả, BTC). Trận đang đánh tự làm mới NGAY khi trọng tài ghi điểm (kênh trực tiếp
 * của giải báo đúng trận này), polling chỉ dự phòng khi mất kết nối; trận đã xong thì không tải lại nữa.
 * "In / Tải PDF": khổ A4 ngang theo mẫu giấy (tên giải, nội dung, sân, trọng tài, giờ bắt đầu / kết thúc, chỗ ký).
 * Không có MSSV / SĐT — chỉ tên VĐV như các trang công khai khác.
 */
export default function ScoreSheetPage() {
  const { matchId } = useParams<{ matchId: string }>();
  // Biết giải của trận sau lần tải đầu → mở kênh trực tiếp. Giữ id trong state để không mở lại kênh mỗi lần tải.
  const [tid, setTid] = useState<string | undefined>(undefined);
  const { tick, matchEvent, live } = useLive(tid);
  const mine = matchEvent?.ids.includes(matchId) ? matchEvent : null;
  const [over, setOver] = useState(false);
  const m = usePoll(async (s) => {
    const r = await api<MatchWithRallies>(`/matches/${matchId}`, { signal: s });
    setTid(r.tournamentId);
    setOver(["finished", "walkover", "cancelled", "bye"].includes(r.status));
    return r;
  }, [matchId, tick, mine], over ? 0 : live ? 60_000 : 5_000);
  const ts = usePoll((s) => api<TournamentSummary[]>("/tournaments", { signal: s }), [], 0);
  const match = m.data;
  const tournament = ts.data?.find((t) => t.id === match?.tournamentId);
  const state = useMemo(() => {
    if (!match) return null;
    try { return replay(match.rallies, match.rules, isDoublesMatch(match)); } catch { return null; }
  }, [match]);

  if (!match) return <p className="text-slate-500" aria-live="polite">{m.error ?? "Đang tải biên bản…"}</p>;
  const startedAt = match.rallies[0]?.at ?? null;
  // Số set mỗi đội đã thắng (chỉ tính game đã xong) — đội thắng mỗi game được +1.
  const sets = setTally(match.games, match.rules).reduce<[number, number]>((acc, x) => (x ? x.tally : acc), [0, 0]);
  const endedAt = ["finished", "walkover"].includes(match.status) ? match.rallies[match.rallies.length - 1]?.at ?? match.updatedAt : null;

  return (
    <div data-print-sheet className="mx-auto max-w-5xl space-y-4 print:max-w-none print:space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-500">{tournament?.name ?? "Biên bản trận đấu"}</p>
          <h1 className="text-2xl font-extrabold text-slate-900 print:text-xl">Biên bản: {match.a?.name ?? "?"} — {match.b?.name ?? "?"}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {match.category.name} · {matchTitle(match)}{match.court ? ` · Sân ${match.court}` : ""}
            {match.referee ? ` · Trọng tài: ${match.referee.name}` : ""}
          </p>
          <p className="text-sm text-slate-600">
            Bắt đầu: <span className="tabular">{startedAt ? fmtTime(startedAt) : "—"}</span> · Kết thúc: <span className="tabular">{endedAt ? fmtTime(endedAt) : "—"}</span>
            {match.games.length > 0 && <> · Set: <strong className="tabular">{sets[0]}–{sets[1]}</strong>
              {" "}(<span className="tabular">{match.games.map((g) => `${g[0]}–${g[1]}`).join(", ")}</span>)</>}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <StatusBadge status={match.status} called={Boolean(match.calledAt)} />
          <button type="button" onClick={() => window.print()}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-black px-4 text-sm font-bold text-white hover:bg-black/85">
            <Printer className="h-4 w-4" aria-hidden />In / Tải PDF
          </button>
        </div>
      </div>

      {state ? <RallySheet match={match} state={state} autoScroll={false} /> : (
        <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">Biên bản chưa đọc được.</p>
      )}
      {match.status === "walkover" && <p className="text-sm font-semibold text-amber-800">Kết thúc do bỏ cuộc — {match.winner ? `${match[match.winner]?.name} thắng` : ""}.</p>}

      {/* Chỗ ký — chỉ hiện khi in. */}
      <div className="hidden grid-cols-3 gap-8 pt-6 text-center text-sm print:grid">
        {["Trọng tài", "Đại diện đội 1", "Đại diện đội 2"].map((who) => (
          <div key={who}><p className="font-semibold">{who}</p><p className="mt-14 border-t border-slate-400 pt-1 text-xs text-slate-500">(ký, ghi rõ họ tên)</p></div>
        ))}
      </div>

      <p className="text-xs text-slate-500 print:hidden">
        Mỗi cột là một pha cầu; số ghi ở hàng người giao pha kế tiếp. Số 0 ở cột đầu = người giao / nhận đầu game; cột Set = số set đã thắng (đội thắng game +1); ✎ = sửa người giao / BTC sửa tỉ số.
        {tournament && <> · <Link href={`/t/${tournament.slug}`} className="underline">Về trang giải</Link></>}
      </p>
    </div>
  );
}

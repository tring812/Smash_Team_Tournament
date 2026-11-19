"use client";

import { Check, GitBranch, MapPin, Table2, Trophy } from "lucide-react";
import { fmtTime } from "../lib/api";
import type { Bracket, Match, Side } from "../lib/types";
import { StatusBadge } from "./MatchViews";
import { DqBadge, EmptyState } from "./ui";

export type BracketView = "tree" | "table";

/* Kích thước cây (px). Thẻ trận cao cố định để tính vị trí & đường nối chính xác. */
const W = 284;
const H = 104;
const GAP_Y = 20;
const COL_GAP = 56;
const HEAD = 40;

/** Số thứ tự trận (bỏ trận miễn đấu) + nhãn chỗ trống "Thắng trận X" cho trận chưa biết đội. */
function numbering(b: Bracket) {
  const no = new Map<string, number>();
  let n = 0;
  for (const r of b.rounds) for (const m of r.matches) if (m.status !== "bye") no.set(m.id, ++n);
  const feeder = (ri: number, pos: number, slot: "a" | "b"): string => {
    const prev = b.rounds[ri - 1]?.matches[pos * 2 + (slot === "a" ? 0 : 1)];
    if (!prev) return "Chờ đội thắng";
    const k = no.get(prev.id);
    return k ? `Thắng trận ${k}` : "Chờ đội thắng";
  };
  return { no, feeder };
}

const scoreLine = (m: Match) => m.games.map((g) => `${g[0]}-${g[1]}`).join(", ");
const sideName = (s: Side | null, fallback: string) => s?.name ?? fallback;

/** Chọn chế độ xem: cây ↔ bảng (nút bật/tắt dạng viên thuốc giống web CLB). */
export function BracketViewToggle({ view, onChange }: { view: BracketView; onChange: (v: BracketView) => void }) {
  const opt = (v: BracketView, label: string, Icon: typeof GitBranch) => (
    <button type="button" aria-pressed={view === v} onClick={() => onChange(v)}
      className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors cursor-pointer ${view === v ? "bg-black text-white shadow" : "text-slate-600 hover:text-black"}`}>
      <Icon className="w-4 h-4" aria-hidden />{label}
    </button>
  );
  return (
    <div role="group" aria-label="Kiểu hiển thị cây thi đấu" className="flex gap-1 rounded-full bg-slate-100 p-1">
      {opt("tree", "Dạng cây", GitBranch)}
      {opt("table", "Dạng bảng", Table2)}
    </div>
  );
}

export function BracketExplorer({ bracket, view }: { bracket: Bracket; view: BracketView }) {
  if (!bracket.rounds.length) {
    return <EmptyState icon={<GitBranch className="w-10 h-10" />} title="Chưa có cây thi đấu" desc="Cây loại trực tiếp sẽ xuất hiện khi Ban tổ chức tạo nhánh sau vòng bảng." />;
  }
  return view === "tree" ? <Tree bracket={bracket} /> : <TableView bracket={bracket} />;
}

/* ───────────────────────────── Dạng cây ───────────────────────────── */

function Tree({ bracket }: { bracket: Bracket }) {
  const { no, feeder } = numbering(bracket);
  const rounds = bracket.rounds;
  const n1 = rounds[0]?.matches.length ?? 0;
  const slot = H + GAP_Y;
  const height = n1 * slot;
  const colX = (ri: number) => ri * (W + COL_GAP);
  const top = (ri: number, i: number) => (i + 0.5) * 2 ** ri * slot - H / 2;
  const final = rounds[rounds.length - 1]?.matches[0];
  const champion = final?.winner ? final[final.winner] : null;
  const width = colX(rounds.length) + W;

  // Đường nối: từ mép phải trận → giữa cột → mép trái trận vòng sau. Nhánh của đội thắng: đỏ + nét dày.
  const paths: { d: string; won: boolean }[] = [];
  rounds.forEach((r, ri) => r.matches.forEach((m, i) => {
    const x1 = colX(ri) + W;
    const y1 = top(ri, i) + H / 2;
    const x2 = ri + 1 < rounds.length ? colX(ri + 1) : colX(rounds.length);
    const y2 = ri + 1 < rounds.length ? top(ri + 1, Math.floor(i / 2)) + H / 2 : y1;
    const xm = x1 + COL_GAP / 2;
    paths.push({ d: `M${x1} ${y1} H${xm} V${y2} H${x2}`, won: Boolean(m.winner) });
  }));

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4" tabIndex={0} role="region" aria-label="Cây thi đấu loại trực tiếp, cuộn ngang để xem hết các vòng">
      <div className="relative" style={{ width, height: height + HEAD }}>
        {rounds.map((r, ri) => (
          <h3 key={r.round} className="headline absolute text-lg text-slate-900" style={{ left: colX(ri), top: 0, width: W }}>
            <span className="text-primary">/</span> {r.label}
          </h3>
        ))}
        <h3 className="headline absolute text-lg text-slate-900" style={{ left: colX(rounds.length), top: 0, width: W }}>
          <span className="text-primary">/</span> Vô địch
        </h3>

        <svg className="pointer-events-none absolute left-0" style={{ top: HEAD }} width={width} height={height} aria-hidden>
          {paths.filter((p) => !p.won).map((p, k) => <path key={`n${k}`} d={p.d} fill="none" stroke="#cbd5e1" strokeWidth={2} />)}
          {paths.filter((p) => p.won).map((p, k) => <path key={`w${k}`} d={p.d} fill="none" stroke="#dc2626" strokeWidth={3} />)}
        </svg>

        <ol>
          {rounds.map((r, ri) => r.matches.map((m, i) => (
            <li key={m.id} className="absolute" style={{ left: colX(ri), top: HEAD + top(ri, i), width: W, height: H }}>
              <TreeCard m={m} no={no.get(m.id)} roundLabel={r.label}
                tbdA={feeder(ri, i, "a")} tbdB={feeder(ri, i, "b")} />
            </li>
          )))}
          <li className="absolute" style={{ left: colX(rounds.length), top: HEAD + top(rounds.length - 1, 0), width: W, height: H }}>
            <div className={`flex h-full items-center gap-3 rounded-2xl p-4 ${champion ? "bg-black text-white" : "border-2 border-dashed border-slate-200 bg-white text-slate-400"}`}>
              <Trophy className={`w-8 h-8 shrink-0 ${champion ? "text-red-500" : ""}`} aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider">{champion ? "Nhà vô địch" : "Chưa xác định"}</p>
                {champion && <p className="truncate font-bold">{champion.name}</p>}
                {champion?.club && <p className="truncate text-xs text-slate-400">{champion.club}</p>}
              </div>
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}

function TreeCard({ m, no, roundLabel, tbdA, tbdB }: { m: Match; no?: number; roundLabel: string; tbdA: string; tbdB: string }) {
  const bye = m.status === "bye";
  const live = m.status === "live";
  const row = (side: "a" | "b", tbd: string) => {
    const s = m[side];
    const won = m.winner === side;
    return (
      <div className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${won ? "bg-red-50 font-bold text-slate-900" : "text-slate-700"}`}>
        <span className="flex min-w-0 items-center gap-1.5">
          {won ? <Check className="w-3.5 h-3.5 shrink-0 text-red-600" aria-label="Thắng" /> : <span className="w-3.5 shrink-0" aria-hidden />}
          <span className={`truncate ${s ? "" : "italic text-slate-400"}`}>{sideName(s, bye ? "—" : tbd)}</span>
          {s?.disqualified && <DqBadge />}
        </span>
        <span className="tabular flex shrink-0 gap-1.5 text-sm">
          {m.games.map((g, k) => <span key={k} className="w-5 text-right">{g[side === "a" ? 0 : 1]}</span>)}
        </span>
      </div>
    );
  };
  const label = bye
    ? `${roundLabel}: ${m.a?.name ?? m.b?.name ?? ""} miễn đấu`
    : `${roundLabel}, trận ${no}: ${sideName(m.a, tbdA)} gặp ${sideName(m.b, tbdB)}. ${m.court ? `Sân ${m.court}. ` : ""}${m.scheduledAt ? `${fmtTime(m.scheduledAt)}. ` : ""}${m.games.length ? `Tỉ số ${scoreLine(m)}.` : ""}`;
  return (
    <article aria-label={label}
      className={`flex h-full flex-col justify-between rounded-2xl border bg-white p-2 shadow-sm ${live ? "border-red-400 ring-2 ring-red-100" : "border-slate-200"} ${bye ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-500">
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {!bye && <span className="font-bold text-slate-900">Trận {no}</span>}
          {m.court ? <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-900 px-1.5 py-px font-bold text-white"><MapPin className="w-3 h-3" aria-hidden />Sân {m.court}</span> : null}
          {m.scheduledAt && <span className="tabular truncate">{fmtTime(m.scheduledAt)}</span>}
        </span>
        <StatusBadge status={m.status} called={Boolean(m.calledAt)} />
      </div>
      <div className="space-y-0.5 text-sm">{row("a", tbdA)}{row("b", tbdB)}</div>
    </article>
  );
}

/* ───────────────────────────── Dạng bảng ───────────────────────────── */

function TableView({ bracket }: { bracket: Bracket }) {
  const { no, feeder } = numbering(bracket);
  const rows = bracket.rounds.flatMap((r, ri) => r.matches.map((m, i) => ({ r, m, ri, i }))).filter((x) => x.m.status !== "bye");
  const team = (m: Match, side: "a" | "b", tbd: string) => {
    const s = m[side];
    const won = m.winner === side;
    return (
      <span className={`inline-flex items-center gap-1.5 ${won ? "font-bold text-slate-900" : s ? "text-slate-700" : "italic text-slate-400"}`}>
        {won && <Check className="w-4 h-4 text-red-600" aria-label="Thắng" />}
        {sideName(s, tbd)}{s?.disqualified && <DqBadge />}
      </span>
    );
  };

  return (
    <>
      {/* Màn hình rộng: bảng */}
      <div className="hidden overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Các trận loại trực tiếp: sân, giờ, tỉ số</caption>
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3">Trận</th>
              <th scope="col" className="py-3 pr-3">Vòng</th>
              <th scope="col" className="py-3 pr-3">Đội 1</th>
              <th scope="col" className="py-3 pr-3 text-center">Tỉ số</th>
              <th scope="col" className="py-3 pr-3">Đội 2</th>
              <th scope="col" className="py-3 pr-3">Sân</th>
              <th scope="col" className="py-3 pr-3">Giờ</th>
              <th scope="col" className="py-3 pr-4">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, m, ri, i }) => (
              <tr key={m.id} className={`border-t border-slate-100 ${m.status === "live" ? "bg-red-50/60" : ""}`}>
                <th scope="row" className="px-4 py-3 text-left font-bold text-slate-900">{no.get(m.id)}</th>
                <td className="py-3 pr-3 text-slate-600">{r.label}</td>
                <td className="py-3 pr-3">{team(m, "a", feeder(ri, i, "a"))}</td>
                <td className="tabular py-3 pr-3 text-center font-semibold">{scoreLine(m) || "—"}</td>
                <td className="py-3 pr-3">{team(m, "b", feeder(ri, i, "b"))}</td>
                <td className="py-3 pr-3">{m.court ? <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-bold text-white">Sân {m.court}</span> : <span className="text-slate-400">—</span>}</td>
                <td className="tabular py-3 pr-3 text-slate-600">{m.scheduledAt ? fmtTime(m.scheduledAt) : "—"}</td>
                <td className="py-3 pr-4"><StatusBadge status={m.status} called={Boolean(m.calledAt)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Màn hình hẹp: thẻ (không cuộn ngang) */}
      <ol className="space-y-3 md:hidden">
        {rows.map(({ r, m, ri, i }) => (
          <li key={m.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${m.status === "live" ? "border-red-300 ring-2 ring-red-100" : "border-slate-100"}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span><strong className="text-slate-900">Trận {no.get(m.id)}</strong> · {r.label}</span>
              <StatusBadge status={m.status} called={Boolean(m.calledAt)} />
            </div>
            <div className="space-y-1 text-sm">
              <div>{team(m, "a", feeder(ri, i, "a"))}</div>
              <div>{team(m, "b", feeder(ri, i, "b"))}</div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs">
              <div><dt className="text-slate-500">Sân</dt><dd className="font-bold text-slate-900">{m.court ?? "—"}</dd></div>
              <div><dt className="text-slate-500">Giờ</dt><dd className="tabular font-bold text-slate-900">{m.scheduledAt ? fmtTime(m.scheduledAt) : "—"}</dd></div>
              <div><dt className="text-slate-500">Tỉ số</dt><dd className="tabular font-bold text-slate-900">{scoreLine(m) || "—"}</dd></div>
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
}

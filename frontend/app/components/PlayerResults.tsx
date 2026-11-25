"use client";

import Link from "next/link";
import { ChevronRight, LayoutGrid, MapPin, X } from "lucide-react";
import type { Category, GroupStanding, Match, StandingRow } from "../lib/types";
import { nextMatch, peopleOf, type Appearance, type Person } from "../lib/playerSearch";
import { StandingsTables, StatusBadge } from "./MatchViews";

const hhmm = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
const ddmm = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" });

const initials = (name: string) => {
  const w = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  return ((w.length > 1 ? (w[w.length - 2]?.[0] ?? "") : "") + (w[w.length - 1]?.[0] ?? "")).toUpperCase() || "?";
};

/** Bên của VĐV trong trận ("a" | "b"), để đọc tỉ số / thắng thua theo góc nhìn của họ. */
const sideOf = (m: Match, key: string): "a" | "b" | null =>
  m.a && peopleOf(m.a).some((p) => p.key === key) ? "a"
    : m.b && peopleOf(m.b).some((p) => p.key === key) ? "b" : null;

function MatchRow({ m, personKey }: { m: Match; personKey: string }) {
  const me = sideOf(m, personKey);
  const opp = me === "a" ? m.b : m.a;
  const done = m.status === "finished" || m.status === "walkover";
  const won = done && m.winner ? m.winner === me : null;
  const score = m.games.map((g) => (me === "b" ? `${g[1]}-${g[0]}` : `${g[0]}-${g[1]}`)).join(", ");
  return (
    <li className="grid grid-cols-[3.75rem_1fr_auto] items-center gap-3 py-2.5">
      <span className="tabular leading-tight">
        <span className="block text-base font-bold text-slate-900">{m.scheduledAt ? hhmm.format(new Date(m.scheduledAt)) : "--:--"}</span>
        <span className="block text-xs text-slate-500">{m.scheduledAt ? ddmm.format(new Date(m.scheduledAt)) : "Chưa xếp"}</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-slate-800">
          gặp <span className="font-semibold">{opp ? opp.name : "Chờ đối thủ"}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span>{m.roundLabel}</span>
          <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{m.court ? `Sân ${m.court}` : "Chưa xếp sân"}</span>
          {done && score && (
            <span className={`tabular font-semibold ${won ? "text-emerald-700" : "text-slate-600"}`}>
              {won === null ? "" : won ? "Thắng " : "Thua "}{score}
            </span>
          )}
          {(done || m.status === "live") && (
            <Link href={`/bien-ban/${m.id}`} className="font-semibold text-slate-700 underline underline-offset-2 hover:text-black">Biên bản</Link>
          )}
        </span>
      </span>
      <StatusBadge status={m.status} called={Boolean(m.calledAt)} />
    </li>
  );
}

function AppearanceBlock({ a, personKey }: { a: Appearance; personKey: string }) {
  return (
    <section className="rounded-xl bg-slate-50 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-bold text-slate-900">
          {a.category.name}
          <span className="ml-1.5 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">{a.category.code}</span>
        </h4>
        {a.group && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />Bảng {a.group}{a.rank ? ` · đang hạng ${a.rank}` : ""}
          </span>
        )}
      </header>
      {a.partner && <p className="mt-0.5 text-xs text-slate-500">Đánh cặp với <span className="font-semibold text-slate-700">{a.partner}</span></p>}
      {a.matches.length ? (
        <ol className="mt-1 divide-y divide-slate-200">
          {a.matches.map((m) => <MatchRow key={m.id} m={m} personKey={personKey} />)}
        </ol>
      ) : <p className="mt-2 text-xs text-slate-500">Chưa có lịch thi đấu cho nội dung này.</p>}
    </section>
  );
}

const timeOf = (m: Match | null) => (m?.scheduledAt ? hhmm.format(new Date(m.scheduledAt)) : "--:--");

/** Một dòng trong danh sách tên: họ tên + CLB + các nội dung — đủ để VĐV nhận ra đúng mình (kể cả khi trùng tên). */
function PersonOption({ p, onPick }: { p: Person; onPick: () => void }) {
  const cats = p.appearances.map((a) => a.category.name).join(" · ");
  return (
    <li>
      <button type="button" onClick={onPick}
        className="flex w-full min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-white px-3 py-2 text-left ring-1 ring-amber-200 transition-colors hover:ring-amber-500 focus-visible:ring-2 focus-visible:ring-amber-600">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-xs font-bold text-amber-900">{initials(p.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-slate-900">{p.name}</span>
          <span className="block truncate text-xs text-slate-500">
            {p.club || "Chưa có CLB"}{cats && ` · ${cats}`}{p.viaClub && " · khớp CLB"}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>
    </li>
  );
}

const MAX = 12;

/**
 * Bước 1 của tìm VĐV: CHỈ hiện danh sách tên khớp để VĐV bấm chọn đúng mình (mỗi NGƯỜI một dòng, gộp mọi nội dung).
 * Chưa hiện lịch của ai — bấm 1 lần vào tên là hiện hồ sơ (PlayerProfile).
 */
export function PersonPicker({ people, onPick, approx = null }: {
  people: Person[];
  onPick: (p: Person) => void;
  /** Từ khoá có dấu không khớp ai đúng dấu → đang hiện kết quả bỏ dấu (báo rõ để khỏi hiểu nhầm). */
  approx?: string | null;
}) {
  const viaClub = people.length > 0 && people.every((p) => p.viaClub);
  return (
    <div>
      <p className="font-bold">
        {people.length} VĐV khớp — bấm vào <span className="underline decoration-2 underline-offset-2">đúng tên của bạn</span> để xem lịch thi đấu và bảng đấu
        {viaClub && <span className="font-normal"> (không có tên nào khớp, đang hiện theo CLB / trường)</span>}
      </p>
      {approx && <p className="mt-0.5 text-xs">Không có ai đúng dấu “{approx}” — đang hiện tên gần giống (bỏ dấu).</p>}
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {people.slice(0, MAX).map((p) => <PersonOption key={p.key} p={p} onPick={() => onPick(p)} />)}
      </ul>
      {people.length > MAX && <p className="mt-2 text-xs">và {people.length - MAX} người nữa — gõ thêm họ tên để lọc.</p>}
    </div>
  );
}

/**
 * Bước 2 — hồ sơ VĐV đã chọn (giống nhau ở tab Lịch thi đấu và Bảng đấu):
 *  - đầu: tên, CLB, số nội dung / số trận, trận tới (hoặc đang đánh), nút Đổi VĐV;
 *  - trái: MỌI trận của người đó theo từng nội dung (giờ, sân, đối thủ, tỉ số, trạng thái, biên bản);
 *  - phải (màn rộng; màn hẹp xếp dưới): bảng đấu có người đó, dòng của họ tô nổi.
 */
export function PlayerProfile({ p, standings, highlight, onClear }: {
  p: Person;
  /** Chỉ các bảng có VĐV này (mọi nội dung). */
  standings: { category: Pick<Category, "id" | "code" | "name">; groups: GroupStanding[] }[];
  highlight?: (r: StandingRow) => boolean;
  onClear: () => void;
}) {
  const next = nextMatch(p);
  const total = p.appearances.reduce((n, a) => n + a.matches.length, 0);
  return (
    <section aria-label={`Hồ sơ VĐV ${p.name}`} className="overflow-hidden rounded-2xl bg-white shadow-md ring-2 ring-amber-500">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3 sm:p-4">
        <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-amber-500 text-sm font-bold text-black">{initials(p.name)}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold text-slate-900">{p.name}</h2>
          <p className="truncate text-xs text-slate-500">
            {p.club || "Chưa có CLB"} · {p.appearances.length} nội dung · {total} trận
            {p.sameNameAsOther && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-px font-semibold text-slate-600">trùng tên — xem CLB</span>}
          </p>
        </div>
        {next && (
          <div className="shrink-0 rounded-xl bg-slate-900 px-3 py-1.5 text-right text-white">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-white/70">{next.status === "live" ? "Đang đánh" : "Trận tới"}</span>
            <span className="tabular block text-base font-bold">{timeOf(next)}</span>
            <span className="block text-xs text-white/70">{next.court ? `Sân ${next.court}` : "Chưa xếp sân"} · {next.category.code}</span>
          </div>
        )}
        <button type="button" onClick={onClear}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:border-slate-400">
          <X className="h-4 w-4" aria-hidden />Đổi VĐV
        </button>
      </header>
      <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-labelledby="pp-matches" className="space-y-2">
          <h3 id="pp-matches" className="text-sm font-bold uppercase tracking-wide text-slate-500">Các trận ({total})</h3>
          {p.appearances.map((a) => <AppearanceBlock key={a.category.id} a={a} personKey={p.key} />)}
        </section>
        <section aria-labelledby="pp-groups" className="space-y-2">
          <h3 id="pp-groups" className="text-sm font-bold uppercase tracking-wide text-slate-500">Bảng đấu</h3>
          {standings.length ? standings.map(({ category, groups }) => (
            <div key={category.id} className="space-y-2">
              {standings.length > 1 && <p className="text-sm font-bold text-slate-900">{category.code} · {category.name}</p>}
              <StandingsTables groups={groups} highlight={highlight} single />
            </div>
          )) : (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
              {p.name} chưa có trong bảng nào — bảng đấu có sau khi BTC bốc thăm; nội dung loại trực tiếp xem ở tab Loại trực tiếp.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Clock, LayoutGrid, MapPin } from "lucide-react";
import type { Match } from "../lib/types";
import { nextMatch, peopleOf, type Appearance, type Person } from "../lib/playerSearch";
import { StatusBadge } from "./MatchViews";

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
        </span>
      </span>
      <StatusBadge status={m.status} called={Boolean(m.calledAt)} />
    </li>
  );
}

function AppearanceBlock({ a, personKey, groupsHref }: { a: Appearance; personKey: string; groupsHref: string }) {
  return (
    <section className="rounded-xl bg-slate-50 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-bold text-slate-900">
          {a.category.name}
          <span className="ml-1.5 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">{a.category.code}</span>
        </h4>
        {a.group && (
          <Link href={groupsHref} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 underline-offset-2 hover:underline">
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />Bảng {a.group}{a.rank ? ` · đang hạng ${a.rank}` : ""}
          </Link>
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

function PersonCard({ p, defaultOpen, groupsHref }: { p: Person; defaultOpen: boolean; groupsHref: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const next = nextMatch(p);
  const panelId = `person-${p.key.replace(/\W+/g, "-")}`;
  return (
    <li className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition-shadow ${open ? "ring-amber-500" : "ring-amber-200 hover:ring-amber-400"}`}>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}
        className="flex w-full min-h-16 cursor-pointer items-center gap-3 p-3 text-left">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-800">{initials(p.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold text-slate-900">{p.name}</span>
          <span className="block truncate text-xs text-slate-500">
            {p.club || "Chưa có CLB"}
            {p.sameNameAsOther && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-px font-semibold text-slate-600">trùng tên — xem CLB</span>}
            {p.viaClub && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-px font-semibold text-amber-800">khớp CLB / trường</span>}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {p.appearances.map((a) => (
              <span key={a.category.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {a.category.name}{a.group ? ` · Bảng ${a.group}` : ""}
              </span>
            ))}
          </span>
        </span>
        {next && (
          <span className="hidden shrink-0 text-right sm:block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{next.status === "live" ? "Đang đánh" : "Trận tới"}</span>
            <span className="tabular block text-base font-bold text-slate-900">{next.scheduledAt ? hhmm.format(new Date(next.scheduledAt)) : "--:--"}</span>
            <span className="block text-xs text-slate-500">{next.court ? `Sân ${next.court}` : next.category.code}</span>
          </span>
        )}
        <ChevronDown aria-hidden className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {next && !open && (
        <p className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-1.5 text-xs text-slate-600 sm:hidden">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {next.status === "live" ? "Đang đánh" : "Trận tới"}{" "}
          <span className="tabular font-bold text-slate-900">{next.scheduledAt ? hhmm.format(new Date(next.scheduledAt)) : "--:--"}</span>
          {next.court ? ` · Sân ${next.court}` : ""} · {next.category.code}
        </p>
      )}
      {open && (
        <div id={panelId} className="space-y-2 border-t border-slate-100 p-3">
          {p.appearances.map((a) => <AppearanceBlock key={a.category.id} a={a} personKey={p.key} groupsHref={groupsHref} />)}
        </div>
      )}
    </li>
  );
}

const MAX = 12;

/**
 * Kết quả ô tìm VĐV: mỗi NGƯỜI một thẻ (gộp mọi nội dung họ đánh), bấm vào để xem
 * giờ – sân – đối thủ – kết quả của từng trận, chia theo nội dung.
 */
export function PlayerResults({ people, matchCount, groupsHref, approx = null }: {
  people: Person[]; matchCount: number; groupsHref: string;
  /** Từ khoá có dấu không khớp ai đúng dấu → đang hiện kết quả bỏ dấu (báo rõ để khỏi hiểu nhầm). */
  approx?: string | null;
}) {
  const viaClub = people.length > 0 && people.every((p) => p.viaClub);
  return (
    <div>
      <p className="font-bold">
        {people.length} VĐV · {matchCount} trận
        {viaClub && <span className="font-normal"> — không có tên nào khớp, đang hiện theo CLB / trường</span>}
      </p>
      {approx && <p className="mt-0.5 text-xs">Không có ai đúng dấu “{approx}” — đang hiện tên gần giống (bỏ dấu).</p>}
      <ul className="mt-2 grid gap-2 lg:grid-cols-2">
        {people.slice(0, MAX).map((p) => <PersonCard key={p.key} p={p} defaultOpen={people.length === 1} groupsHref={groupsHref} />)}
      </ul>
      {people.length > MAX && <p className="mt-2 text-xs">và {people.length - MAX} người nữa — gõ thêm họ tên để lọc.</p>}
    </div>
  );
}

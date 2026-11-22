"use client";

import { CalendarClock, Check, Clock, LayoutGrid, MapPin, Table2 } from "lucide-react";
import type { ComponentType } from "react";
import { fmtTime } from "../lib/api";
import type { Match, Side } from "../lib/types";
import { MatchCard, StatusBadge, matchTitle } from "./MatchViews";
import { DqBadge, EmptyState } from "./ui";

export type ScheduleView = "time" | "court" | "table";

export const SCHEDULE_VIEWS: { id: ScheduleView; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "time", label: "Theo giờ", icon: Clock },
  { id: "court", label: "Theo sân", icon: LayoutGrid },
  { id: "table", label: "Dạng bảng", icon: Table2 },
];

/** Bộ chọn kiểu xem lịch dạng viên thuốc. */
export function ScheduleViewToggle({ view, onChange }: { view: ScheduleView; onChange: (v: ScheduleView) => void }) {
  return (
    <div role="group" aria-label="Kiểu hiển thị lịch thi đấu" className="flex flex-wrap gap-1 rounded-3xl bg-slate-100 p-1 sm:rounded-full">
      {SCHEDULE_VIEWS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-pressed={view === id} onClick={() => onChange(id)}
          className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-bold transition-colors cursor-pointer ${view === id ? "bg-black text-white shadow" : "text-slate-600 hover:text-black"}`}>
          <Icon className="w-4 h-4" aria-hidden />{label}
        </button>
      ))}
    </div>
  );
}

const vnDate = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit" });
const vnTime = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
/** Khoá ngày theo giờ Việt Nam, dùng để lọc theo ngày thi đấu. */
export const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
export const dayLabel = (iso: string) => vnDate.format(new Date(iso));

const scoreLine = (m: Match) => m.games.map((g) => `${g[0]}-${g[1]}`).join(", ");

function groupBySlot(matches: Match[]) {
  const map = new Map<string, Match[]>();
  for (const m of matches) {
    if (!m.scheduledAt) continue;
    map.set(m.scheduledAt, [...(map.get(m.scheduledAt) ?? []), m]);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function Unscheduled({ matches }: { matches: Match[] }) {
  const list = matches.filter((m) => !m.scheduledAt);
  if (!list.length) return null;
  return (
    <section className="mt-8">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Chưa xếp lịch ({list.length})</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((m) => <MatchCard key={m.id} m={m} />)}</div>
    </section>
  );
}

/** Theo giờ: mỗi khung giờ một hàng thẻ trận. */
export function TimeView({ matches }: { matches: Match[] }) {
  const slots = groupBySlot(matches);
  if (!matches.length) return <EmptyState icon={<CalendarClock className="w-10 h-10" />} title="Chưa có trận nào" />;
  return (
    <>
      <ol className="space-y-8">
        {slots.map(([time, ms]) => (
          <li key={time}>
            <h3 className="mb-3 flex items-center gap-3">
              <span className="tabular rounded-full bg-black px-3 py-1 text-sm font-bold text-white">{fmtTime(time)}</span>
              <span className="h-px flex-1 bg-slate-200" aria-hidden />
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...ms].sort((a, b) => (a.court ?? 99) - (b.court ?? 99)).map((m) => <MatchCard key={m.id} m={m} />)}
            </div>
          </li>
        ))}
      </ol>
      <Unscheduled matches={matches} />
    </>
  );
}

/** Theo sân: cột = sân, hàng = khung giờ — đọc như bảng phân sân dán tại nhà thi đấu. */
export function CourtView({ matches, courts }: { matches: Match[]; courts: number }) {
  const slots = groupBySlot(matches);
  const maxCourt = Math.max(courts, ...matches.map((m) => m.court ?? 0));
  const cols = Array.from({ length: maxCourt }, (_, i) => i + 1);
  if (!slots.length) return <EmptyState icon={<LayoutGrid className="w-10 h-10" />} title="Chưa có trận nào được xếp sân" />;
  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-2" tabIndex={0} role="region" aria-label="Lịch theo sân, cuộn ngang để xem các sân">
        <table className="w-full min-w-max border-separate border-spacing-2 text-sm">
          <caption className="sr-only">Lịch thi đấu theo sân và khung giờ</caption>
          <thead>
            <tr>
              <th scope="col" className="w-20 text-left text-xs font-bold uppercase text-slate-500">Giờ</th>
              {cols.map((c) => (
                <th key={c} scope="col" className="min-w-56 rounded-xl bg-black px-3 py-2 text-left text-white">
                  <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4 text-red-500" aria-hidden />Sân {c}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map(([time, ms]) => (
              <tr key={time}>
                <th scope="row" className="tabular align-top pt-3 text-left font-bold text-slate-900">
                  {vnTime.format(new Date(time))}
                  <span className="block text-[11px] font-normal text-slate-400">{dayKey(time).slice(5).split("-").reverse().join("/")}</span>
                </th>
                {cols.map((c) => {
                  const m = ms.find((x) => x.court === c);
                  return (
                    <td key={c} className="align-top">
                      {m ? <MatchCard m={m} /> : <div className="h-full min-h-20 rounded-2xl border border-dashed border-slate-200" aria-label="Sân trống" />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Unscheduled matches={matches} />
    </>
  );
}

function Team({ m, side }: { m: Match; side: "a" | "b" }) {
  const s: Side | null = m[side];
  const won = m.winner === side;
  return (
    <span className={`inline-flex items-center gap-1.5 ${won ? "font-bold text-slate-900" : s ? "text-slate-700" : "italic text-slate-400"}`}>
      {won && <Check className="w-4 h-4 text-red-600" aria-label="Thắng" />}
      {s?.name ?? "Chờ đội thắng"}{s?.disqualified && <DqBadge />}
    </span>
  );
}

/** Dạng bảng: mọi trận (vòng bảng + loại trực tiếp); màn hẹp chuyển sang thẻ. */
export function AllMatchesTable({ matches }: { matches: Match[] }) {
  if (!matches.length) return <EmptyState icon={<Table2 className="w-10 h-10" />} title="Chưa có trận nào" />;
  // Trận chưa xếp lịch xuống cuối. So chuỗi ISO bằng < / > (localeCompare xếp ký tự đặc biệt trước chữ số).
  const rows = [...matches].sort((a, b) => {
    if (!a.scheduledAt || !b.scheduledAt) return Number(!a.scheduledAt) - Number(!b.scheduledAt);
    return (a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0) || (a.court ?? 99) - (b.court ?? 99);
  });
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Toàn bộ trận đấu: giờ, sân, nội dung, đội, tỉ số, trạng thái</caption>
          <thead className="whitespace-nowrap bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3">Giờ</th>
              <th scope="col" className="py-3 pr-3">Sân</th>
              <th scope="col" className="py-3 pr-3">Trận</th>
              <th scope="col" className="py-3 pr-3">Đội 1</th>
              <th scope="col" className="py-3 pr-3 text-center">Tỉ số</th>
              <th scope="col" className="py-3 pr-3">Đội 2</th>
              <th scope="col" className="py-3 pr-4">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={`border-t border-slate-100 ${m.status === "live" ? "bg-red-50/60" : ""}`}>
                <td className="tabular whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{m.scheduledAt ? fmtTime(m.scheduledAt) : "—"}</td>
                <td className="whitespace-nowrap py-3 pr-3">{m.court ? <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-bold text-white">Sân {m.court}</span> : <span className="text-slate-400">—</span>}</td>
                <td className="py-3 pr-3 text-xs text-slate-500">{matchTitle(m)}</td>
                <td className="py-3 pr-3"><Team m={m} side="a" /></td>
                <td className="tabular py-3 pr-3 text-center font-semibold">{scoreLine(m) || "—"}</td>
                <td className="py-3 pr-3"><Team m={m} side="b" /></td>
                <td className="py-3 pr-4"><StatusBadge status={m.status} called={Boolean(m.calledAt)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="space-y-3 md:hidden">
        {rows.map((m) => (
          <li key={m.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${m.status === "live" ? "border-red-300 ring-2 ring-red-100" : "border-slate-100"}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>{matchTitle(m)}</span>
              <StatusBadge status={m.status} called={Boolean(m.calledAt)} />
            </div>
            <div className="space-y-1 text-sm"><div><Team m={m} side="a" /></div><div><Team m={m} side="b" /></div></div>
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

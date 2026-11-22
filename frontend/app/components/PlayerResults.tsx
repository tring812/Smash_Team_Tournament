"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Clock, LayoutGrid, MapPin, X } from "lucide-react";
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

const timeOf = (m: Match | null) => (m?.scheduledAt ? hhmm.format(new Date(m.scheduledAt)) : "--:--");

/** Thẻ VĐV tối giản trong danh sách kết quả: chỉ họ tên + các nội dung. Bấm → cuộn xuống khung đầy đủ. */
function PersonChip({ p, selected, onSelect, panelId }: { p: Person; selected: boolean; onSelect: () => void; panelId: string }) {
  const cats = p.appearances.map((a) => a.category.name).join(" · ");
  return (
    <li>
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-controls={panelId} title={`${p.name} — ${cats}`}
        className={`block w-full min-h-12 cursor-pointer rounded-xl px-3 py-2 text-left ring-1 transition-colors ${selected ? "bg-amber-100 ring-2 ring-amber-500" : "bg-white ring-amber-200 hover:ring-amber-400"}`}>
        <span className="block truncate text-sm font-bold text-slate-900">
          {p.name}
          {/* Hai người trùng tên: thêm CLB để không thành 2 thẻ giống hệt nhau. */}
          {p.sameNameAsOther && <span className="font-normal text-slate-500"> · {p.club || "chưa có CLB"}</span>}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {cats}
          {p.viaClub && " · khớp CLB"}
        </span>
      </button>
    </li>
  );
}

/** Khung chi tiết của VĐV đang chọn: tách riêng dưới danh sách, có nút đóng. */
function PlayerDetail({ p, groupsHref, onClose, id }: { p: Person; groupsHref: string; onClose: () => void; id: string }) {
  const next = nextMatch(p);
  const total = p.appearances.reduce((n, a) => n + a.matches.length, 0);
  return (
    <section id={id} aria-label={`Lịch thi đấu của ${p.name}`} tabIndex={-1}
      className="mt-3 scroll-mt-20 overflow-hidden rounded-2xl bg-white shadow-md ring-2 ring-amber-500 outline-none">
      <header className="flex items-center gap-3 border-b border-slate-100 p-3 sm:p-4">
        <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-amber-500 text-sm font-bold text-black">{initials(p.name)}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold text-slate-900">{p.name}</h3>
          <p className="truncate text-xs text-slate-500">
            {p.club || "Chưa có CLB"} · {p.appearances.length} nội dung · {total} trận
            {p.sameNameAsOther && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-px font-semibold text-slate-600">trùng tên — xem CLB</span>}
            {p.viaClub && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-px font-semibold text-amber-800">khớp CLB / trường</span>}
          </p>
        </div>
        {next && (
          <div className="hidden shrink-0 rounded-xl bg-slate-900 px-3 py-1.5 text-right text-white sm:block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-white/70">{next.status === "live" ? "Đang đánh" : "Trận tới"}</span>
            <span className="tabular block text-base font-bold">{timeOf(next)}</span>
            <span className="block text-xs text-white/70">{next.court ? `Sân ${next.court}` : "Chưa xếp sân"} · {next.category.code}</span>
          </div>
        )}
        <button type="button" onClick={onClose} aria-label="Đóng lịch VĐV"
          className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-slate-500 hover:bg-slate-100">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>
      {next && (
        <p className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:hidden">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {next.status === "live" ? "Đang đánh" : "Trận tới"}{" "}
          <span className="tabular font-bold text-slate-900">{timeOf(next)}</span>
          {next.court ? ` · Sân ${next.court}` : ""} · {next.category.code}
        </p>
      )}
      <div className="grid gap-2 p-3 sm:p-4 lg:grid-cols-2">
        {p.appearances.map((a) => <AppearanceBlock key={a.category.id} a={a} personKey={p.key} groupsHref={groupsHref} />)}
      </div>
    </section>
  );
}

const MAX = 12;
const PANEL_ID = "player-detail";

/**
 * Kết quả ô tìm VĐV: danh sách thẻ VĐV thu gọn (mỗi NGƯỜI một thẻ, gộp mọi nội dung).
 * Bấm một VĐV → trang cuộn xuống khung riêng dưới danh sách, hiện đầy đủ thông tin + lịch thi đấu,
 * không bung thẻ ra giữa danh sách. Chỉ có 1 kết quả thì tự chọn sẵn.
 */
export function PlayerResults({ people, matchCount, groupsHref, approx = null }: {
  people: Person[]; matchCount: number; groupsHref: string;
  /** Từ khoá có dấu không khớp ai đúng dấu → đang hiện kết quả bỏ dấu (báo rõ để khỏi hiểu nhầm). */
  approx?: string | null;
}) {
  const viaClub = people.length > 0 && people.every((p) => p.viaClub);
  // Lựa chọn gắn với BỘ KẾT QUẢ hiện tại (sig): tìm từ khoá khác thì lựa chọn cũ — kể cả "đã đóng khung" — hết hiệu lực,
  // nên tìm ra đúng 1 người là khung tự mở lại (trước đây đóng một lần thì không tự mở nữa).
  const sig = people.map((p) => p.key).join("|");
  // key = VĐV người dùng chọn · "" = người dùng đã đóng khung · null = chưa chọn.
  const [pick, setPick] = useState<{ sig: string; key: string } | null>(null);
  const picked = pick && (pick.sig === sig || people.some((p) => p.key === pick.key)) ? pick.key : null;
  const selectedKey = picked && people.some((p) => p.key === picked) ? picked
    : picked !== "" && people.length === 1 ? (people[0]?.key ?? null) : null;
  const selected = people.find((p) => p.key === selectedKey) ?? null;
  const boxRef = useRef<HTMLDivElement>(null);
  /** Tăng mỗi lần NGƯỜI DÙNG bấm chọn → chỉ cuộn khi họ bấm, không cuộn khi tự mở lúc đang gõ. */
  const [scrollTick, setScrollTick] = useState(0);

  const select = (key: string) => {
    setPick({ sig, key: selectedKey === key ? "" : key });
    if (selectedKey !== key) setScrollTick((n) => n + 1);
  };
  // Chọn xong: đưa khung chi tiết lên đầu màn hình + chuyển focus cho người dùng bàn phím / trình đọc màn hình.
  useEffect(() => {
    if (!scrollTick) return;
    const el = boxRef.current?.querySelector<HTMLElement>(`#${PANEL_ID}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, [scrollTick]);

  return (
    <div ref={boxRef}>
      <p className="font-bold">
        {people.length} VĐV · {matchCount} trận
        {viaClub && <span className="font-normal"> — không có tên nào khớp, đang hiện theo CLB / trường</span>}
        {!selected && people.length > 1 && <span className="font-normal"> · bấm vào VĐV để xem lịch</span>}
      </p>
      {approx && <p className="mt-0.5 text-xs">Không có ai đúng dấu “{approx}” — đang hiện tên gần giống (bỏ dấu).</p>}
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {people.slice(0, MAX).map((p) => (
          <PersonChip key={p.key} p={p} selected={p.key === selectedKey} onSelect={() => select(p.key)} panelId={PANEL_ID} />
        ))}
      </ul>
      {people.length > MAX && <p className="mt-2 text-xs">và {people.length - MAX} người nữa — gõ thêm họ tên để lọc.</p>}
      {selected && <PlayerDetail key={selected.key} p={selected} groupsHref={groupsHref} id={PANEL_ID} onClose={() => setPick({ sig, key: "" })} />}
    </div>
  );
}

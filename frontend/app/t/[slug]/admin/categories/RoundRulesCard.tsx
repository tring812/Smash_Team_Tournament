"use client";

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { api } from "../../../../lib/api";
import type { Category, Match, ScoringRules } from "../../../../lib/types";
import { Button, Card, Notice } from "../../../../components/ui";
import { useAdmin } from "../AdminContext";

/** Khoá phạm vi: "group" | "ko:*" | "ko:1" (chung kết) | "ko:2" (bán kết)… */
type Scope = string;
type Mode = "default" | "21" | "15" | "11" | "custom";
interface Row { scope: Scope; label: string; hint: string }
interface Draft { mode: Mode; points: number; cap: number; games: number }

const PRESET: Record<Exclude<Mode, "default" | "custom">, [number, number]> = { 21: [21, 30], 15: [15, 21], 11: [11, 15] };
const fromEndLabel = (n: number) => (n === 1 ? "Chung kết" : n === 2 ? "Bán kết" : n === 3 ? "Tứ kết" : `Vòng 1/${2 ** (n - 1)}`);
const fromEndOf = (m: Match, rounds: number) => (m.isThirdPlace ? 2 : rounds - m.round + 1);
export const rulesText = (r: ScoringRules) => `${r.pointsToWin} điểm${r.maxPoints > r.pointsToWin ? `, trần ${r.maxPoints}` : ""} · ${r.gamesToWin === 1 ? "1 game" : `thắng ${r.gamesToWin}/${r.gamesToWin * 2 - 1} game`}`;

function draftOf(r: ScoringRules | undefined): Draft {
  if (!r) return { mode: "default", points: 21, cap: 30, games: 2 };
  const preset = (Object.entries(PRESET).find(([, [p, c]]) => p === r.pointsToWin && c === r.maxPoints)?.[0] ?? "custom") as Mode;
  return { mode: preset, points: r.pointsToWin, cap: r.maxPoints, games: r.gamesToWin };
}

/**
 * LUẬT ĐIỂM THEO VÒNG — vd vòng bảng 11 điểm 1 game cho nhanh, loại trực tiếp 15 điểm, chung kết đủ 21 điểm BWF.
 * Vòng không đặt riêng dùng luật mặc định của nội dung. Vòng đã có trận bắt đầu bị khoá (server kiểm tra lại).
 */
export function RoundRulesCard({ cat, matches }: { cat: Category; matches: Match[] }) {
  const { busy, act } = useAdmin();
  const def: ScoringRules = { pointsToWin: cat.points_to_win, maxPoints: cat.max_points, gamesToWin: cat.games_to_win };
  const ko = matches.filter((m) => m.stage === "knockout");
  const koRounds = ko.reduce((mx, m) => Math.max(mx, m.round), 0);

  // Các hàng: vòng bảng, "mọi vòng loại", rồi từng vòng (theo nhánh thật nếu đã có, không thì Tứ kết → Chung kết).
  const rows: Row[] = useMemo(() => {
    const ends = koRounds ? Array.from({ length: koRounds }, (_, i) => koRounds - i) : [3, 2, 1];
    return [
      { scope: "group", label: "Vòng bảng", hint: "Mọi trận vòng bảng" },
      { scope: "ko:*", label: "Loại trực tiếp", hint: "Mọi vòng loại trực tiếp không đặt riêng bên dưới" },
      ...ends.map((n) => ({
        scope: `ko:${n}`, label: fromEndLabel(n),
        hint: n === 2 && cat.third_place ? "Áp dụng cả trận tranh hạng Ba–Tư"
          : koRounds ? `${ko.filter((m) => fromEndOf(m, koRounds) === n).length} trận` : "Áp dụng khi tạo nhánh",
      })),
    ];
  }, [koRounds, ko, cat.third_place]);

  const saved = (scope: Scope): ScoringRules | undefined => {
    const rr = cat.round_rules ?? {};
    if (scope === "group") return rr.group;
    return rr.knockout?.[scope.slice(3)];
  };
  const [draft, setDraft] = useState<Record<Scope, Draft>>(() => Object.fromEntries(rows.map((r) => [r.scope, draftOf(saved(r.scope))])));
  const [err, setErr] = useState<string | null>(null);

  // Phạm vi bị khoá: có trận đã bắt đầu đang dùng luật của phạm vi đó.
  const started = (m: Match) => !["bye", "cancelled"].includes(m.status) && (["live", "finished", "walkover"].includes(m.status) || m.games.length > 0);
  const locked = (scope: Scope) => {
    if (scope === "group") return matches.some((m) => m.stage === "group" && started(m));
    if (scope === "ko:*") return ko.some((m) => started(m) && (draft[`ko:${fromEndOf(m, koRounds)}`]?.mode ?? "default") === "default");
    return ko.some((m) => started(m) && `ko:${fromEndOf(m, koRounds)}` === scope);
  };

  const rulesOf = (d: Draft): ScoringRules | null => {
    if (d.mode === "default") return null;
    const [p, c] = d.mode === "custom" ? [d.points, d.cap] : PRESET[d.mode];
    return { pointsToWin: p, maxPoints: c, gamesToWin: d.games };
  };
  const effective = (scope: Scope): ScoringRules => {
    const own = draft[scope] ? rulesOf(draft[scope]!) : null;
    if (own) return own;
    if (scope.startsWith("ko:") && scope !== "ko:*") return rulesOf(draft["ko:*"]!) ?? def;
    return def;
  };

  async function save() {
    setErr(null);
    type Out = ScoringRules & { stage: "group" | "knockout"; fromEnd?: number | null };
    const rules: Out[] = [];
    for (const r of rows) {
      const x = rulesOf(draft[r.scope]!);
      if (!x) continue;
      if (x.maxPoints < x.pointsToWin) { setErr(`${r.label}: trần điểm phải ≥ điểm thắng game`); return; }
      rules.push(r.scope === "group" ? { stage: "group", ...x } : { stage: "knockout", fromEnd: r.scope === "ko:*" ? null : Number(r.scope.slice(3)), ...x });
    }
    try {
      await api(`/categories/${cat.id}/round-rules`, { method: "PUT", body: { rules } });
      await act(async () => undefined, `Đã lưu luật điểm theo vòng cho ${cat.code}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const sel = "min-h-11 w-full rounded-xl bg-slate-100 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <Card title={`Luật điểm theo vòng — ${cat.code}`}>
      <p className="-mt-2 mb-4 text-sm text-slate-500">
        Mặc định của nội dung: <strong className="text-slate-700">{rulesText(def)}</strong>. Đặt riêng cho vòng muốn đánh nhanh hơn (vd vòng bảng 11 điểm 1 game) hoặc đủ luật hơn (chung kết).
      </p>
      {err && <div className="mb-4"><Notice kind="error">{err}</Notice></div>}
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const d = draft[r.scope]!;
          const lock = locked(r.scope);
          const set = (p: Partial<Draft>) => setDraft({ ...draft, [r.scope]: { ...d, ...p } });
          return (
            <li key={r.scope} className={`grid gap-3 py-3 sm:grid-cols-[minmax(0,10rem)_1fr_auto] sm:items-center ${r.scope.startsWith("ko:") && r.scope !== "ko:*" ? "sm:pl-6" : ""}`}>
              <div>
                <p className="flex items-center gap-1.5 font-semibold text-slate-900">{r.label}{lock && <Lock className="h-3.5 w-3.5 text-slate-400" aria-label="Đã khoá — có trận đã bắt đầu" />}</p>
                <p className="text-xs text-slate-500">{lock ? "Đã có trận bắt đầu — khoá" : r.hint}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="sr-only" htmlFor={`rr-${r.scope}`}>Luật điểm {r.label}</label>
                <select id={`rr-${r.scope}`} className={sel} value={d.mode} disabled={lock || busy} onChange={(e) => set({ mode: e.target.value as Mode })}>
                  <option value="default">{r.scope.startsWith("ko:") && r.scope !== "ko:*" ? "Theo dòng Loại trực tiếp" : "Theo mặc định nội dung"}</option>
                  <option value="21">21 điểm, trần 30 (BWF)</option>
                  <option value="15">15 điểm, trần 21</option>
                  <option value="11">11 điểm, trần 15</option>
                  <option value="custom">Tuỳ chỉnh…</option>
                </select>
                {d.mode !== "default" && (
                  <>
                    <label className="sr-only" htmlFor={`rg-${r.scope}`}>Số game {r.label}</label>
                    <select id={`rg-${r.scope}`} className={sel} value={d.games} disabled={lock || busy} onChange={(e) => set({ games: Number(e.target.value) })}>
                      <option value={1}>1 game</option><option value={2}>Thắng 2/3 game</option><option value={3}>Thắng 3/5 game</option>
                    </select>
                  </>
                )}
                {d.mode === "custom" && (
                  <div className="flex gap-2 sm:col-span-2">
                    <label className="flex flex-1 items-center gap-2 text-xs font-bold text-slate-600">Điểm thắng
                      <input type="number" inputMode="numeric" min={5} max={50} value={d.points} disabled={lock || busy} onChange={(e) => set({ points: Number(e.target.value) })} className={`${sel} cursor-text`} />
                    </label>
                    <label className="flex flex-1 items-center gap-2 text-xs font-bold text-slate-600">Trần
                      <input type="number" inputMode="numeric" min={5} max={60} value={d.cap} disabled={lock || busy} onChange={(e) => set({ cap: Number(e.target.value) })} className={`${sel} cursor-text`} />
                    </label>
                  </div>
                )}
              </div>
              <p className="text-xs font-semibold text-slate-600 sm:w-44 sm:text-right" aria-live="polite">→ {rulesText(effective(r.scope))}</p>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={busy} onClick={() => void save()}>Lưu luật theo vòng</Button></div>
    </Card>
  );
}

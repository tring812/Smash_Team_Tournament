"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { gameState, matchProgress } from "../../lib/scoring";
import { reminderAfterPoint, serviceCourt, type Reminder } from "../../lib/serve";
import { emptyState, otherSide, replay, sideOf, slotName, type RallyInput, type RallyState, type Side } from "../../lib/rally";
import type { Game, Match, Rally, Slot, StartMatchInput } from "../../lib/types";
import { matchControls } from "../../lib/matchControls";
import { Button } from "../../components/ui";
import { matchTitle, StatusBadge } from "../../components/MatchViews";
import { isDoublesMatch, RallySheet } from "../../components/RallySheet";

type Sync = "idle" | "saving" | "saved" | "offline" | "error";
type MatchWithRallies = Match & { rallies: Rally[] };

/**
 * Hàng chờ gửi trên máy trọng tài (localStorage) — mất mạng / tải lại trang vẫn giữ các pha chưa gửi:
 *  - `ops`: thêm sự kiện (đã đánh số seq) hoặc hoàn tác sự kiện cuối, gửi lần lượt khi có mạng.
 *  - `serverSeq`: seq cuối của máy chủ lúc lưu; tải lại mà máy chủ đã khác (máy khác vừa bấm) → bỏ hàng chờ.
 */
type Op = { kind: "add"; ev: RallyInput } | { kind: "undo"; seq: number };
interface Saved { ops: Op[]; serverSeq: number }
const queueKey = (id: string) => `st-ref-q:${id}`;
function readQueue(id: string): Saved | null {
  try {
    const d = JSON.parse(window.localStorage.getItem(queueKey(id)) ?? "null") as Saved | null;
    return d && Array.isArray(d.ops) && Number.isInteger(d.serverSeq) ? d : null;
  } catch { return null; }
}
function writeQueue(id: string, ops: Op[], serverSeq: number) {
  try {
    if (ops.length) window.localStorage.setItem(queueKey(id), JSON.stringify({ ops, serverSeq }));
    else window.localStorage.removeItem(queueKey(id));
  } catch { /* bộ nhớ bị chặn: vẫn chạy, chỉ mất khả năng khôi phục */ }
}
/** Bản nháp kiểu cũ (gửi cả tỉ số) không còn dùng được với biên bản → xoá. */
function clearLegacy(id: string) {
  try { window.localStorage.removeItem(`st-ref:${id}`); window.localStorage.removeItem(`st-ref-serve:${id}`); } catch { /* bỏ qua */ }
}

const rulesLine = (r: Match["rules"]) => `${r.pointsToWin} điểm${r.maxPoints > r.pointsToWin ? `, trần ${r.maxPoints}` : ""} · ${r.gamesToWin === 1 ? "1 game" : `thắng ${r.gamesToWin}/${r.gamesToWin * 2 - 1}`}`;

/** Thẻ nhắc nghỉ / đổi sân có đếm ngược (rung máy nếu hỗ trợ). */
function ReminderBanner({ r, onClose }: { r: Reminder; onClose: () => void }) {
  const [endsAt] = useState(() => Date.now() + r.seconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* không hỗ trợ */ }
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <div role="alert" className={`mt-3 flex flex-wrap items-center gap-3 rounded-2xl border-2 p-4 ${r.changeEnds ? "border-amber-500 bg-amber-50" : "border-sky-500 bg-sky-50"}`}>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-slate-900">{r.title}</p>
        {r.changeEnds && <p className="text-sm text-slate-700">Màn hình đã tự đổi bên cho khớp vị trí mới.</p>}
      </div>
      <span className="tabular text-4xl font-black text-slate-900" aria-label={`Còn ${left} giây`}>{left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Hết giờ"}</span>
      <button type="button" onClick={onClose} className="min-h-11 rounded-full bg-black px-4 text-sm font-bold text-white">Tiếp tục</button>
    </div>
  );
}

/** Lỗi mạng / máy chủ tạm thời → giữ hàng chờ và thử lại; lỗi nghiệp vụ (4xx) → bỏ hàng chờ, trả về như máy chủ. */
const retriable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 429;

/** Áp hàng chờ lên sự kiện của máy chủ → sự kiện đang hiển thị. */
function withQueue(server: RallyInput[], ops: Op[]): RallyInput[] {
  const out = [...server];
  for (const op of ops) {
    if (op.kind === "add") out.push(op.ev);
    else if (out[out.length - 1]?.seq === op.seq) out.pop();
  }
  return out;
}

/**
 * Bàn điểm trọng tài, tối ưu điện thoại: chạm nửa màn hình của đội thắng pha cầu.
 * Mỗi pha là 1 sự kiện biên bản gửi lên máy chủ (POST /rallies, có expectedSeq chống 2 máy cùng bấm);
 * máy chủ tính tỉ số + người giao. Màn hình phản hồi ngay bằng cùng luật (lib/rally) và giữ hàng chờ khi mất mạng.
 */
export default function ScoringPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const [match, setMatch] = useState<MatchWithRallies | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const opsRef = useRef<Op[]>([]);
  const serverSeq = useRef(0);
  const [sync, setSync] = useState<Sync>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [confirmWo, setConfirmWo] = useState<"a" | "b" | null>(null);
  const [reminder, setReminder] = useState<(Reminder & { id: number }) | null>(null);
  const [fixing, setFixing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const actionLock = useRef(false);
  const reminderSeq = useRef(0);
  const sending = useRef<Promise<void> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(2_000);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const setQueue = useCallback((next: Op[]) => {
    opsRef.current = next;
    setOps(next);
    writeQueue(matchId, next, serverSeq.current);
  }, [matchId]);

  const adopt = useCallback((m: MatchWithRallies) => {
    setMatch(m);
    serverSeq.current = m.rallies[m.rallies.length - 1]?.seq ?? 0;
  }, []);

  const reload = useCallback(async () => {
    const fresh = await api<MatchWithRallies>(`/matches/${matchId}`);
    adopt(fresh);
    return fresh;
  }, [matchId, adopt]);

  /** Gửi lần lượt hàng chờ. Mất mạng → thử lại (2s → 15s, và ngay khi có mạng). Bị từ chối → bỏ hàng chờ, tải lại. */
  const flush = useCallback(async (): Promise<void> => {
    if (sending.current) return sending.current;
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    const run = async () => {
      while (opsRef.current.length) {
        const op = opsRef.current[0]!;
        setSync("saving");
        try {
          const m = op.kind === "add"
            ? await api<MatchWithRallies>(`/matches/${matchId}/rallies`, {
              method: "POST",
              body: {
                type: op.ev.type, expectedSeq: op.ev.seq,
                ...(op.ev.side ? { side: op.ev.side } : {}), ...(op.ev.server ? { server: op.ev.server } : {}), ...(op.ev.receiver ? { receiver: op.ev.receiver } : {}),
              },
            })
            : await api<MatchWithRallies>(`/matches/${matchId}/rallies/last?expectedSeq=${op.seq}`, { method: "DELETE" });
          adopt(m);
          setQueue(opsRef.current.slice(1));
          retryDelay.current = 2_000;
        } catch (e) {
          if (retriable(e)) {
            setSync("offline");
            const wait = retryDelay.current;
            retryDelay.current = Math.min(wait * 2, 15_000);
            retryTimer.current = setTimeout(() => { void flushRef.current(); }, wait);
            return;
          }
          setQueue([]);
          try { await reload(); } catch { /* giữ màn hình */ }
          setSync("error");
          setMessage(e instanceof ApiError && e.code === "RALLY_CONFLICT"
            ? "Biên bản vừa được cập nhật từ thiết bị khác — đã tải lại."
            : `${(e as Error).message} — đã trả điểm về như trước.`);
          return;
        }
      }
      setSync("saved");
    };
    sending.current = run().finally(() => { sending.current = null; });
    return sending.current;
  }, [matchId, adopt, reload, setQueue]);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  // Tải trận + biên bản, khôi phục hàng chờ trên máy (nếu máy chủ chưa đổi).
  useEffect(() => {
    let alive = true;
    clearLegacy(matchId);
    api<MatchWithRallies>(`/matches/${matchId}`).then((m) => {
      if (!alive) return;
      adopt(m);
      const saved = readQueue(matchId);
      if (!saved) return;
      const last = m.rallies[m.rallies.length - 1]?.seq ?? 0;
      const closed = ["finished", "walkover", "bye", "cancelled"].includes(m.status) || m.tournamentStatus === "completed";
      if (closed || m.status !== "live" || saved.serverSeq !== last) {
        writeQueue(matchId, [], 0);
        if (!closed) setMessage("Biên bản trên máy chủ đã thay đổi từ thiết bị khác — đã bỏ các pha chưa gửi trên máy này.");
        return;
      }
      opsRef.current = saved.ops;
      setOps(saved.ops);
      setMessage("Đã khôi phục các pha chưa gửi trên máy này — đang gửi lại…");
      void flushRef.current();
    }).catch((e: Error) => { if (alive) setMessage(e.message); });
    return () => { alive = false; };
  }, [matchId, adopt]);

  useEffect(() => {
    const online = () => { if (opsRef.current.length) { retryDelay.current = 2_000; void flush(); } };
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [flush]);

  const doubles = match ? isDoublesMatch(match) : false;
  const events = useMemo(() => (match ? withQueue(match.rallies, ops) : []), [match, ops]);
  const state: RallyState = useMemo(() => {
    if (!match) return emptyState();
    try { return replay(events, match.rules, doubles); } catch { return replay(match.rallies, match.rules, doubles); }
  }, [match, events, doubles]);
  const pending = useMemo(() => new Set(ops.flatMap((o) => (o.kind === "add" ? [o.ev.seq] : []))), [ops]);

  if (!match) return <p className="text-muted" aria-live="polite">{message ?? "Đang tải trận…"}</p>;

  const rules = match.rules;
  const games: Game[] = state.games.length ? state.games : match.games;
  const prog = matchProgress(games, rules);
  const controls = matchControls(match, games, ops.length, actionBusy, sync);
  const closed = controls.closed;
  const locked = match.tournamentStatus === "completed";
  const ready = controls.started;
  const canScore = controls.canScore;
  const last = games[games.length - 1];
  // Đang đánh: game hiện tại; đã xong (kể cả sau khi xác nhận): tỉ số game cuối — không về 0–0.
  const current: Game = last && (gameState(last, rules) === "in_progress" || closed || prog.winner) ? last : [0, 0];
  const nextSeq = (events[events.length - 1]?.seq ?? 0) + 1;
  const needStart = canScore && !state.active;
  const prevWinner: Side | null = last && gameState(last, rules) !== "in_progress" ? (gameState(last, rules) as Side) : null;
  const pickerShown = needStart && (doubles || !prevWinner);

  function enqueue(evs: Omit<RallyInput, "seq">[]) {
    if (!ready || actionLock.current) return;
    let seq = nextSeq;
    const added: Op[] = evs.map((e) => ({ kind: "add", ev: { ...e, seq: seq++ } as RallyInput }));
    setMessage(null);
    setQueue([...opsRef.current, ...added]);
    void flush();
  }

  function point(side: Side) {
    if (!canScore || pickerShown) return;
    const evs: Omit<RallyInput, "seq">[] = [];
    if (!state.active) {
      // Đánh đơn từ game 2: bên thắng game trước giao trước — tự mở game.
      if (!prevWinner) return;
      evs.push({ type: "start", server: `${prevWinner}1` as Slot });
    }
    evs.push({ type: "point", side });
    let after: Game[];
    try { after = replay([...events, ...evs.map((e, i) => ({ ...e, seq: nextSeq + i }) as RallyInput)], rules, doubles).games; } catch { return; }
    const r = reminderAfterPoint(games, after, rules);
    if (r) {
      reminderSeq.current += 1;
      setReminder({ ...r, id: reminderSeq.current });
      if (r.changeEnds) setSwapped((v) => !v);
    }
    enqueue(evs);
  }

  function undo() {
    if (!ready || actionLock.current) return;
    const lastEv = events[events.length - 1];
    if (!lastEv) return;
    setReminder(null);
    const lastOp = opsRef.current[opsRef.current.length - 1];
    if (lastOp?.kind === "add" && lastOp.ev.seq === lastEv.seq) {
      setQueue(opsRef.current.slice(0, -1)); // chưa gửi → chỉ bỏ trên máy
      return;
    }
    setQueue([...opsRef.current, { kind: "undo", seq: lastEv.seq }]);
    void flush();
  }

  async function start() {
    if (!match || !controls.canStart || actionLock.current) return;
    actionLock.current = true;
    setActionBusy(true);
    setMessage(null);
    try {
      const body: StartMatchInput = { version: match.version };
      adopt(await api<MatchWithRallies>(`/matches/${matchId}/start`, { method: "POST", body }));
      setSync("saved");
      setMessage("Đã bắt đầu trận — sân và VĐV đã được nhận cho trận này.");
    } catch (e) {
      setMessage((e as Error).message);
      setSync("error");
      try { await reload(); } catch { /* giữ thông báo và thử lại khi có mạng */ }
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }

  async function finish(action: "finish" | "walkover", walkoverWinner?: "a" | "b") {
    if (locked || closed || !match || actionLock.current || (action === "finish" && !controls.canFinish)) return;
    actionLock.current = true;
    setActionBusy(true);
    try {
      await flush();
      if (opsRef.current.length) {
        setMessage("Còn pha chưa gửi được (mất mạng). Chờ có mạng rồi xác nhận lại.");
        return;
      }
      // flush có thể đổi phiên bản trong lúc chờ; lấy lại bản máy chủ và không ghi đè điểm máy khác.
      const fresh = await reload();
      if (JSON.stringify(fresh.games) !== JSON.stringify(games)) {
        setMessage("Tỉ số vừa thay đổi — đã tải lại, hãy kiểm tra trước khi xác nhận.");
        return;
      }
      const m = await api<Match>(`/matches/${matchId}/score`, {
        method: "PUT", body: { action, version: fresh.version, games: fresh.games, ...(walkoverWinner ? { walkoverWinner } : {}) },
      });
      adopt({ ...m, rallies: fresh.rallies });
      setConfirmWo(null);
      setSync("saved");
      setMessage(action === "finish" ? "Đã hoàn thành trận — sân và VĐV đã được giải phóng." : "Đã ghi nhận bỏ cuộc.");
      void reload().catch(() => {});
    } catch (e) {
      if (retriable(e)) { setMessage((e as Error).message); return; }
      try { await reload(); } catch { /* giữ */ }
      setSync("error");
      setMessage(`${(e as Error).message} — đã trả điểm về như trước.`);
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }

  const sides: Side[] = swapped ? ["b", "a"] : ["a", "b"];
  const deuce = current[0] >= rules.pointsToWin - 1 && current[1] >= rules.pointsToWin - 1 && current[0] === current[1];
  const name = (s: Slot) => (doubles ? slotName(match, s) : match[sideOf(s)]?.name ?? s);
  const serverCourt = state.server ? serviceCourt(current[sideOf(state.server) === "a" ? 0 : 1]) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href="/ref" className="min-h-11 content-center font-semibold underline-offset-4 hover:underline">← Hàng đợi</Link>
        <span className="text-muted">{matchTitle(match)}{match.court ? ` · Sân ${match.court}` : ""} · <span className="font-semibold">{rulesLine(rules)}</span></span>
        <StatusBadge status={match.status} called={Boolean(match.calledAt)} />
      </div>

      <p className="sr-only" aria-live="assertive">
        {`${match.a?.name}: ${current[0]}, ${match.b?.name}: ${current[1]}. Game ${prog.gamesA}-${prog.gamesB}.`}
      </p>

      {locked && (
        <div role="status" className="mb-3 rounded-2xl border-2 border-slate-300 bg-slate-100 p-3 text-center font-bold text-slate-800">
          Giải đã kết thúc — khoá nhập điểm
        </div>
      )}

      {!closed && !locked && !ready && (
        <div className="mb-3 rounded-2xl border-2 border-sky-500 bg-sky-50 p-4 text-center text-slate-900">
          <p className="font-bold">Chưa bắt đầu trận</p>
          <p className="mt-1 text-sm">{match.court
            ? `Bắt đầu trên sân ${match.court}. Hệ thống sẽ kiểm tra sân và tất cả VĐV trước khi mở ghi điểm.`
            : "Trận chưa có sân — liên hệ BTC để gán sân trước khi bắt đầu."}</p>
          <Button variant="primary" className="mt-3" disabled={!controls.canStart} loading={actionBusy} onClick={() => void start()}>
            Bắt đầu trận
          </Button>
        </div>
      )}

      {pickerShown && (
        <ServePicker key={games.length} match={match} doubles={doubles} defaultSide={prevWinner}
          gameNo={prevWinner ? games.length + 1 : Math.max(games.length, 1)}
          onPick={(server, receiver) => enqueue([{ type: "start", server, ...(receiver ? { receiver } : {}) }])} />
      )}

      <div className="grid grid-cols-2 gap-3">
        {sides.map((s) => {
          const team = match[s];
          const pts = current[s === "a" ? 0 : 1];
          const gw = s === "a" ? prog.gamesA : prog.gamesB;
          const serving = canScore && state.active && state.server !== null && sideOf(state.server) === s;
          const receiving = canScore && state.active && doubles && state.receiver !== null && sideOf(state.receiver) === s;
          return (
            <button key={s} type="button" disabled={!canScore || pickerShown} onClick={() => point(s)}
              aria-label={`Cộng 1 điểm cho ${team?.name ?? s}`}
              className="flex min-h-[42dvh] flex-col items-center justify-between rounded-3xl border-2 border-line bg-surface p-4 text-center active:bg-surface-2 disabled:opacity-60">
              <span className="w-full truncate text-base font-extrabold sm:text-lg">{team?.name ?? "—"}</span>
              {serving && state.server ? (
                <span className="max-w-full truncate rounded-full bg-sky-700 px-3 py-1 text-sm font-bold text-white">
                  Giao · ô {serverCourt === "right" ? "PHẢI" : "TRÁI"}{doubles ? ` · ${name(state.server)}` : ""}
                </span>
              ) : receiving && state.receiver ? (
                <span className="max-w-full truncate rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">Nhận · {name(state.receiver)}</span>
              ) : <span className="h-7" aria-hidden />}
              <span className="tabular text-8xl font-extrabold leading-none sm:text-9xl">{pts}</span>
              <span className="text-sm text-muted">Game thắng: <strong className="text-fg">{gw}</strong></span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm">
        {games.map((g, i) => (
          <span key={i} className="tabular rounded-full bg-surface-2 px-3 py-1">G{i + 1}: {g[0]}-{g[1]}</span>
        ))}
        {deuce && canScore && <span className="rounded-full border border-live px-3 py-1 font-semibold text-live">Deuce</span>}
        {canScore && state.active && (
          <button type="button" onClick={() => setFixing((v) => !v)} aria-expanded={fixing}
            className="min-h-11 rounded-full border border-line px-3 text-xs font-semibold">Sửa người giao</button>
        )}
      </div>

      {fixing && canScore && state.active && (
        <fieldset className="mt-3 rounded-2xl border-2 border-sky-500 bg-sky-50 p-3">
          <legend className="px-1 font-bold text-slate-900">Ai đang giao cầu?</legend>
          <div className="flex flex-wrap justify-center gap-2">
            {(doubles ? (["a1", "a2", "b1", "b2"] as Slot[]) : (["a1", "b1"] as Slot[])).map((s) => (
              <button key={s} type="button" disabled={s === state.server}
                onClick={() => { setFixing(false); enqueue([{ type: "fix_server", server: s }]); }}
                className="min-h-11 rounded-full bg-black px-4 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-600">
                {name(s)}{s === state.server ? " (đang giao)" : ""}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {reminder && <ReminderBanner key={reminder.id} r={reminder} onClose={() => setReminder(null)} />}

      {!closed && !locked && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button type="button" onClick={undo} disabled={!ready || !events.length || actionBusy} className="min-h-12 rounded-2xl border border-line font-semibold disabled:opacity-50">
            Hoàn tác
          </button>
          <button type="button" onClick={() => setSwapped((v) => !v)} className="min-h-12 rounded-2xl border border-line font-semibold">
            Đổi sân
          </button>
          <button type="button" disabled={actionBusy} onClick={() => setConfirmWo(confirmWo ? null : "a")} className="min-h-12 rounded-2xl border border-line font-semibold disabled:opacity-50">
            Bỏ cuộc…
          </button>
        </div>
      )}

      <section aria-labelledby="sheet-h" className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <h3 id="sheet-h" className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><FileText className="h-4 w-4" aria-hidden />Biên bản</h3>
          <button type="button" onClick={() => setSheetOpen((v) => !v)} aria-expanded={sheetOpen} aria-controls="sheet-body"
            className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-semibold text-slate-600">
            {sheetOpen ? "Thu gọn" : "Mở"}<ChevronDown className={`h-4 w-4 transition-transform ${sheetOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </div>
        {sheetOpen && <div id="sheet-body" className="mt-1"><RallySheet match={match} state={state} pending={pending} /></div>}
      </section>

      {ready && (
        <div className="mt-4 rounded-2xl border-2 border-success p-4 text-center">
          <p className="font-semibold">{prog.winner
            ? `${match[prog.winner]?.name} thắng ${prog.gamesA}-${prog.gamesB}. Hoàn thành để cập nhật bảng/nhánh và giải phóng sân.`
            : "Nhập đủ tỉ số hợp lệ và lưu hết các pha cầu để hoàn thành trận."}</p>
          {ops.length > 0 && <p className="mt-1 text-sm text-amber-700">Còn {ops.length} thao tác chưa lưu — chưa thể hoàn thành.</p>}
          <Button variant="primary" onClick={() => void finish("finish")} disabled={!controls.canFinish} loading={actionBusy} className="mt-3 min-h-12">
            Hoàn thành trận
          </Button>
        </div>
      )}

      {confirmWo && !closed && !locked && (
        <fieldset className="mt-4 rounded-2xl border border-live p-4">
          <legend className="px-1 font-semibold text-live">Xử thắng do đối phương bỏ cuộc</legend>
          <div className="flex flex-wrap gap-4">
            {(["a", "b"] as const).map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-2">
                <input type="radio" name="wo" checked={confirmWo === s} onChange={() => setConfirmWo(s)} />
                {match[s]?.name} thắng
              </label>
            ))}
          </div>
          <button type="button" disabled={actionBusy || ops.length > 0} onClick={() => finish("walkover", confirmWo)} className="mt-3 min-h-11 rounded-full bg-live px-5 font-semibold text-on-primary disabled:opacity-50">
            Xác nhận bỏ cuộc
          </button>
        </fieldset>
      )}

      <p className="mt-4 text-center text-sm" aria-live="polite">
        {message ? <span className={sync === "error" ? "text-live" : "text-muted"}>{message}</span> :
          sync === "offline" ? <span className="font-semibold text-amber-700">Mất kết nối — {ops.length} thao tác đã lưu trên máy này, sẽ tự gửi khi có mạng</span> :
          sync === "saving" ? <span className="text-muted">Đang lưu…</span> :
          sync === "saved" ? <span className="text-success">Đã lưu</span> : null}
      </p>
    </div>
  );
}

/**
 * Chọn người giao / người nhận đầu game. Đánh đôi: đội giao → ai giao → ai nhận (mỗi game hỏi lại;
 * game sau mặc định đội thắng game trước giao). Đánh đơn: chỉ cần chọn bên giao.
 */
function ServePicker({ match, doubles, defaultSide, gameNo, onPick }: {
  match: Match; doubles: boolean; defaultSide: Side | null; gameNo: number;
  onPick: (server: Slot, receiver: Slot | null) => void;
}) {
  const [side, setSide] = useState<Side | null>(defaultSide);
  const [server, setServer] = useState<Slot | null>(null);
  const label = (s: Slot) => slotName(match, s);
  const btn = "min-h-11 rounded-full px-4 text-sm font-bold";
  if (!doubles) {
    return (
      <div className="mb-3 rounded-2xl border-2 border-sky-500 bg-sky-50 p-3 text-center">
        <p className="font-bold text-slate-900">Bên nào giao cầu trước? (bốc thăm / tung cầu)</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {(["a", "b"] as const).map((s) => (
            <button key={s} type="button" onClick={() => onPick(`${s}1` as Slot, null)} className={`${btn} bg-black text-white`}>{match[s]?.name ?? s} giao</button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="mb-3 space-y-2 rounded-2xl border-2 border-sky-500 bg-sky-50 p-3 text-center">
      <p className="font-bold text-slate-900">Game {gameNo}: chọn người giao và người nhận</p>
      <div>
        <p className="text-sm font-semibold text-slate-700">Đội giao{defaultSide ? " (đội thắng game trước giao trước)" : ""}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Đội giao">
          {(["a", "b"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={side === s} onClick={() => { setSide(s); setServer(null); }}
              className={`${btn} ${side === s ? "bg-black text-white" : "border border-slate-300 bg-white text-slate-800"}`}>{match[s]?.name ?? s}</button>
          ))}
        </div>
      </div>
      {side && (
        <div>
          <p className="text-sm font-semibold text-slate-700">Ai giao?</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Người giao">
            {([`${side}1`, `${side}2`] as Slot[]).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={server === s} onClick={() => setServer(s)}
                className={`${btn} ${server === s ? "bg-sky-700 text-white" : "border border-slate-300 bg-white text-slate-800"}`}>{label(s)}</button>
            ))}
          </div>
        </div>
      )}
      {side && server && (
        <div>
          <p className="text-sm font-semibold text-slate-700">Ai nhận?</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            {([`${otherSide(side)}1`, `${otherSide(side)}2`] as Slot[]).map((s) => (
              <button key={s} type="button" onClick={() => onPick(server, s)} className={`${btn} bg-black text-white`}>{label(s)} nhận</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

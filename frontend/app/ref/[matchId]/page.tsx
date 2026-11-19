"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { gameState, matchProgress } from "../../lib/scoring";
import { reminderAfterPoint, serviceCourt, type Reminder, type Side } from "../../lib/serve";
import type { Game, Match } from "../../lib/types";
import { matchTitle, StatusBadge } from "../../components/MatchViews";

type Sync = "idle" | "saving" | "saved" | "offline" | "error";

/**
 * Bản nháp trên máy trọng tài (localStorage) — để mất mạng / tải lại trang / hết pin vẫn không mất điểm:
 *  - `baseVersion`: version máy chủ mà `games` được xây lên; chỉ khôi phục khi máy chủ vẫn ở đúng version đó
 *    (máy khác đã sửa → bỏ nháp, không ghi đè).
 *  - `synced`: false = còn điểm CHƯA gửi được → tự gửi lại khi có mạng.
 *  - `history`: để "Hoàn tác" vẫn dùng được sau khi tải lại trang.
 */
interface Draft { baseVersion: number; games: Game[]; history: Game[][]; synced: boolean; savedAt: number }
const draftKey = (id: string) => `st-ref:${id}`;
function readDraft(id: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d && Array.isArray(d.games) && Number.isInteger(d.baseVersion) ? d : null;
  } catch {
    return null;
  }
}
function writeDraft(id: string, d: Omit<Draft, "savedAt">) {
  try { window.localStorage.setItem(draftKey(id), JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* bộ nhớ bị chặn: vẫn chạy, chỉ mất khả năng khôi phục */ }
}
function clearDraft(id: string) {
  try { window.localStorage.removeItem(draftKey(id)); } catch { /* bỏ qua */ }
}
/**
 * Bên giao cầu (chỉ trên máy trọng tài — không cần đồng bộ): bên thắng pha cầu giao pha tiếp theo.
 * `stack` song song với lịch sử Hoàn tác để hoàn tác cũng trả lại đúng bên giao.
 */
interface Serve { server: Side | null; stack: (Side | null)[] }
const serveKey = (id: string) => `st-ref-serve:${id}`;
function readServe(id: string): Serve {
  try {
    const d = JSON.parse(window.localStorage.getItem(serveKey(id)) ?? "null") as Serve | null;
    if (d && (d.server === "a" || d.server === "b" || d.server === null) && Array.isArray(d.stack)) return d;
  } catch { /* bỏ qua */ }
  return { server: null, stack: [] };
}
function writeServe(id: string, s: Serve) {
  try { window.localStorage.setItem(serveKey(id), JSON.stringify({ server: s.server, stack: s.stack.slice(-51) })); } catch { /* bỏ qua */ }
}

const rulesLine = (r: Match["rules"]) => `${r.pointsToWin} điểm${r.maxPoints > r.pointsToWin ? `, trần ${r.maxPoints}` : ""} · ${r.gamesToWin === 1 ? "1 game" : `thắng ${r.gamesToWin}/${r.gamesToWin * 2 - 1}`}`;

/** Thẻ nhắc nghỉ / đổi sân có đếm ngược (rung máy nếu hỗ trợ). */
function ReminderBanner({ r, onClose }: { r: Reminder; onClose: () => void }) {
  const [endsAt] = useState(() => Date.now() + r.seconds * 1000); // mốc kết thúc tính 1 lần khi thẻ hiện
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

/** Lỗi mạng / máy chủ tạm thời → giữ điểm và thử lại; lỗi nghiệp vụ (4xx) → dừng, báo người dùng. */
const retriable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 429;

/**
 * Bảng nhập điểm cho trọng tài, tối ưu điện thoại: chạm nửa màn hình của bên ghi điểm để +1.
 * Mỗi thay đổi được lưu ngay (gộp các lần chạm nhanh), có optimistic locking qua `version`:
 * nếu thiết bị khác vừa sửa, server trả 409 và màn hình tải lại tỉ số mới nhất.
 */
export default function ScoringPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const [match, setMatch] = useState<Match | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [history, setHistory] = useState<Game[][]>([]);
  const [sync, setSync] = useState<Sync>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [confirmWo, setConfirmWo] = useState<"a" | "b" | null>(null);
  const [serve, setServeState] = useState<Serve>({ server: null, stack: [] });
  const [reminder, setReminder] = useState<(Reminder & { id: number }) | null>(null);
  const reminderSeq = useRef(0);
  const setServe = useCallback((s: Serve) => { setServeState(s); writeServe(matchId, s); }, [matchId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc localStorage (hệ thống ngoài) 1 lần khi mở trận
  useEffect(() => { setServeState(readServe(matchId)); }, [matchId]);

  const version = useRef(0);
  const pending = useRef<Game[] | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(2_000);
  /** Hẹn giờ gửi lại gọi qua ref (flush không tự tham chiếu chính nó). */
  const flushRef = useRef<() => Promise<void>>(async () => {});
  // Bản mới nhất của state cho các callback bất đồng bộ (tránh closure cũ).
  const latest = useRef<{ games: Game[]; history: Game[][] }>({ games: [], history: [] });
  useEffect(() => { latest.current = { games, history }; }, [games, history]);

  const adopt = useCallback((m: Match) => {
    setMatch(m);
    setGames(m.games);
    version.current = m.version;
    if (["finished", "walkover", "bye", "cancelled"].includes(m.status)) clearDraft(m.id);
  }, []);

  /**
   * Gửi snapshot mới nhất; các lần chạm trong lúc đang gửi được gộp thành 1 request tiếp theo.
   * Mất mạng: điểm vẫn nằm trong bản nháp trên máy, tự gửi lại (lùi dần 2s → 15s, và ngay khi có mạng).
   */
  const flush = useCallback(async (): Promise<void> => {
    if (inflight.current) return inflight.current;
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    const run = async () => {
      while (pending.current) {
        const snap = pending.current;
        pending.current = null;
        setSync("saving");
        try {
          const m = await api<Match>(`/matches/${matchId}/score`, {
            method: "PUT", body: { action: "save", version: version.current, games: snap },
          });
          version.current = m.version;
          setMatch(m);
          retryDelay.current = 2_000;
          if (!pending.current) {
            writeDraft(matchId, { baseVersion: m.version, games: snap, history: latest.current.history, synced: true });
            setSync("saved");
            setMessage(null);
          }
        } catch (e) {
          if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
            pending.current = null;
            clearDraft(matchId);
            const fresh = await api<Match>(`/matches/${matchId}`);
            adopt(fresh);
            setHistory([]);
            setMessage("Tỉ số vừa được cập nhật từ thiết bị khác — đã tải lại.");
            setSync("saved");
          } else if (retriable(e)) {
            pending.current ??= snap; // giữ bản mới nhất (nếu đã chạm thêm thì bản mới hơn đang nằm sẵn)
            setSync("offline");
            setMessage(null);
            const wait = retryDelay.current;
            retryDelay.current = Math.min(wait * 2, 15_000);
            retryTimer.current = setTimeout(() => { void flushRef.current(); }, wait);
            return;
          } else {
            pending.current = null;
            setSync("error");
            setMessage((e as Error).message);
          }
        }
      }
    };
    inflight.current = run().finally(() => { inflight.current = null; });
    return inflight.current;
  }, [matchId, adopt]);

  useEffect(() => { flushRef.current = flush; }, [flush]);

  // Tải trận + khôi phục bản nháp trên máy (điểm chưa gửi, lịch sử hoàn tác).
  useEffect(() => {
    let alive = true;
    api<Match>(`/matches/${matchId}`).then((m) => {
      if (!alive) return;
      adopt(m);
      const d = readDraft(matchId);
      if (!d || ["finished", "walkover", "bye", "cancelled"].includes(m.status)) return;
      if (d.baseVersion !== m.version) {
        clearDraft(matchId);
        if (!d.synced) setMessage("Tỉ số trên máy chủ đã thay đổi từ thiết bị khác — đã bỏ bản nháp trên máy này.");
        return;
      }
      setHistory(d.history ?? []);
      if (!d.synced) {
        setGames(d.games);
        pending.current = d.games;
        setMessage("Đã khôi phục điểm chưa gửi trên máy này — đang gửi lại…");
        void flush();
      }
    }).catch((e: Error) => { if (alive) setMessage(e.message); });
    return () => { alive = false; };
  }, [matchId, adopt, flush]);

  // Có mạng trở lại → gửi ngay, không chờ hết thời gian lùi.
  useEffect(() => {
    const online = () => { if (pending.current) { retryDelay.current = 2_000; void flush(); } };
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [flush]);

  if (!match) return <p className="text-muted" aria-live="polite">{message ?? "Đang tải trận…"}</p>;

  const rules = match.rules;
  const prog = matchProgress(games, rules);
  const last = games[games.length - 1];
  const lastState = last ? gameState(last, rules) : "in_progress";
  const closed = ["finished", "walkover", "bye"].includes(match.status);
  const canScore = !closed && !prog.winner && match.a && match.b;
  const current: Game = last && lastState === "in_progress" ? last : [0, 0];

  function point(side: "a" | "b", delta: 1 | -1) {
    if (!canScore && delta === 1) return;
    const next = games.map((g) => [...g] as Game);
    if (delta === 1 && (next.length === 0 || gameState(next[next.length - 1]!, rules) !== "in_progress")) next.push([0, 0]);
    const g = next[next.length - 1];
    if (!g) return;
    g[side === "a" ? 0 : 1] += delta;
    if (g[0] < 0 || g[1] < 0 || gameState(g, rules) === "invalid") return;
    if (delta === -1 && g[0] === 0 && g[1] === 0) next.pop();
    const nextHistory = [...history.slice(-50), games];
    if (delta === 1) {
      // Bên thắng pha cầu giao pha tiếp theo; nhắc nghỉ / đổi sân theo luật của vòng.
      setServe({ server: side, stack: [...serve.stack.slice(-50), serve.server] });
      const r = reminderAfterPoint(games, next, rules);
      if (r) {
        reminderSeq.current += 1;
        setReminder({ ...r, id: reminderSeq.current });
        if (r.changeEnds) setSwapped((v) => !v);
      }
    }
    commit(next, nextHistory);
  }

  /** Ghi state mới: màn hình → bản nháp trên máy (TRƯỚC khi gửi) → hàng gửi. */
  function commit(next: Game[], nextHistory: Game[][]) {
    setHistory(nextHistory);
    setGames(next);
    setMessage(null);
    writeDraft(matchId, { baseVersion: version.current, games: next, history: nextHistory, synced: false });
    pending.current = next;
    void flush();
  }

  function undo() {
    const prev = history[history.length - 1];
    if (!prev || closed) return;
    if (serve.stack.length) setServe({ server: serve.stack[serve.stack.length - 1] ?? null, stack: serve.stack.slice(0, -1) });
    setReminder(null);
    commit(prev, history.slice(0, -1));
  }

  async function finish(action: "finish" | "walkover", walkoverWinner?: "a" | "b") {
    await flush();
    if (pending.current) {
      setMessage("Còn điểm chưa gửi được (mất mạng). Chờ có mạng rồi xác nhận lại.");
      return;
    }
    try {
      const m = await api<Match>(`/matches/${matchId}/score`, {
        method: "PUT", body: { action, version: version.current, games, ...(walkoverWinner ? { walkoverWinner } : {}) },
      });
      adopt(m);
      clearDraft(matchId);
      setConfirmWo(null);
      setMessage(action === "finish" ? "Đã xác nhận kết quả trận." : "Đã ghi nhận bỏ cuộc.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  const sides: ("a" | "b")[] = swapped ? ["b", "a"] : ["a", "b"];
  const deuce = current[0] >= rules.pointsToWin - 1 && current[1] >= rules.pointsToWin - 1 && current[0] === current[1];

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

      {canScore && !serve.server && (
        <div className="mb-3 rounded-2xl border-2 border-sky-500 bg-sky-50 p-3 text-center">
          <p className="font-bold text-slate-900">Bên nào giao cầu trước? (bốc thăm / tung cầu)</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {(["a", "b"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setServe({ server: s, stack: serve.stack })}
                className="min-h-11 rounded-full bg-black px-4 text-sm font-bold text-white">{match[s]?.name ?? s} giao</button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {sides.map((s) => {
          const team = match[s];
          const pts = current[s === "a" ? 0 : 1];
          const gw = s === "a" ? prog.gamesA : prog.gamesB;
          return (
            <button key={s} type="button" disabled={!canScore} onClick={() => point(s, 1)}
              aria-label={`Cộng 1 điểm cho ${team?.name ?? s}`}
              className="flex min-h-[46dvh] flex-col items-center justify-between rounded-3xl border-2 border-line bg-surface p-4 text-center active:bg-surface-2 disabled:opacity-60">
              <span className="w-full truncate text-base font-extrabold sm:text-lg">{team?.name ?? "—"}</span>
              {canScore && serve.server === s ? (
                <span className="rounded-full bg-sky-700 px-3 py-1 text-sm font-bold text-white">
                  Giao cầu · ô {serviceCourt(pts) === "right" ? "PHẢI" : "TRÁI"}
                </span>
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
        {canScore && serve.server && (
          <button type="button" onClick={() => setServe({ server: serve.server === "a" ? "b" : "a", stack: serve.stack })}
            className="min-h-11 rounded-full border border-line px-3 text-xs font-semibold">Sửa bên giao</button>
        )}
      </div>

      {reminder && <ReminderBanner key={reminder.id} r={reminder} onClose={() => setReminder(null)} />}

      {!closed && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button type="button" onClick={undo} disabled={!history.length} className="min-h-12 rounded-2xl border border-line font-semibold disabled:opacity-50">
            Hoàn tác
          </button>
          <button type="button" onClick={() => setSwapped((v) => !v)} className="min-h-12 rounded-2xl border border-line font-semibold">
            Đổi sân
          </button>
          <button type="button" onClick={() => setConfirmWo(confirmWo ? null : "a")} className="min-h-12 rounded-2xl border border-line font-semibold">
            Bỏ cuộc…
          </button>
        </div>
      )}

      {prog.winner && !closed && (
        <div className="mt-4 rounded-2xl border-2 border-success p-4 text-center">
          <p className="font-semibold">{match[prog.winner]?.name} thắng {prog.gamesA}-{prog.gamesB}. Xác nhận để cập nhật bảng/nhánh.</p>
          <button type="button" onClick={() => finish("finish")} className="mt-3 min-h-12 rounded-full bg-primary px-6 font-extrabold text-on-primary">
            Xác nhận kết quả
          </button>
        </div>
      )}

      {confirmWo && !closed && (
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
          <button type="button" onClick={() => finish("walkover", confirmWo)} className="mt-3 min-h-11 rounded-full bg-live px-5 font-semibold text-on-primary">
            Xác nhận bỏ cuộc
          </button>
        </fieldset>
      )}

      <p className="mt-4 text-center text-sm" aria-live="polite">
        {message ? <span className={sync === "error" ? "text-live" : "text-muted"}>{message}</span> :
          sync === "offline" ? <span className="font-semibold text-amber-700">Mất kết nối — điểm đã lưu trên máy này, sẽ tự gửi khi có mạng</span> :
          sync === "saving" ? <span className="text-muted">Đang lưu…</span> :
          sync === "saved" ? <span className="text-success">Đã lưu</span> : null}
        {sync === "error" && (
          <button type="button" onClick={() => { pending.current = games; void flush(); }} className="ml-2 underline">Thử lại</button>
        )}
      </p>
    </div>
  );
}

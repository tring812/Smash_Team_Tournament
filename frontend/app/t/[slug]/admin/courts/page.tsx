"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRightLeft, BellRing, Clock, Coffee, ListOrdered, MapPin, Megaphone, PenLine, Undo2, UserCheck } from "lucide-react";
import { api, fmtTime } from "../../../../lib/api";
import { usePoll } from "../../../../lib/usePoll";
import { useLive } from "../../../../lib/useLive";
import type { CourtBoard, Match, Staff } from "../../../../lib/types";
import { Button, Card, CardSkeleton, EmptyState, Modal, Notice, PageHeader, textInputClass } from "../../../../components/ui";
import { matchTitle } from "../../../../components/MatchViews";
import { useAdmin } from "../AdminContext";
import { MoveMatchModal } from "../MoveMatchModal";
import { NoRefereeHint, RefereeOptions } from "../RefereeOptions";

type QueueItem = CourtBoard["queue"][number];

/** "12 phút" kể từ `iso` (cập nhật theo `now`). */
function since(iso: string | null, now: number) {
  if (!iso) return "";
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "vừa xong" : `${m} phút`;
}

const scoreLine = (m: Match) => m.games.map((g) => `${g[0]}-${g[1]}`).join(", ");

/**
 * ĐIỀU PHỐI SÂN — màn hình BTC dùng suốt ngày thi đấu.
 * Mỗi sân một thẻ: trống → gợi ý trận kế tiếp (VĐV rảnh, đã nghỉ đủ) → "Gọi vào sân";
 * đã gọi / đang đánh → mở bàn điểm, chuyển sân, rút về hàng chờ. Tự cập nhật mỗi 5 giây.
 */
export default function CourtsPage() {
  const { t, version, busy, act, setError } = useAdmin();
  // Trọng tài nhập điểm / BTC khác gọi trận → bảng cập nhật ngay qua SSE (mọi thay đổi, kể cả từng điểm); polling chỉ dự phòng.
  const { anyTick: tick, live } = useLive(t.id);
  const board = usePoll((s) => api<CourtBoard>(`/tournaments/${t.id}/courts`, { signal: s }), [t.id, version, tick], live ? 20_000 : 5_000);
  const staff = usePoll((s) => api<Staff[]>(`/tournaments/${t.id}/staff`, { signal: s }), [t.id, version], 120_000);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [pickErr, setPickErr] = useState<string | null>(null);
  const [moving, setMoving] = useState<Match | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);

  const b = board.data;
  const byId = new Map((b?.queue ?? []).map((q) => [q.match.id, q]));
  const freeCourts = (b?.courts ?? []).filter((c) => !c.current).map((c) => c.court);
  // Gọi / rút / chuyển sân chỉ đổi bảng sân → tải lại riêng bảng sân (không tải lại thông tin giải + danh sách BTC).
  const boardOnly = { local: () => { void board.refresh(); } };
  const doCall = (m: Match, court: number) =>
    act(() => api(`/matches/${m.id}/call`, { method: "POST", body: { court } }), `Đã gọi ${m.a?.name} – ${m.b?.name} vào sân ${court}`, boardOnly);
  /** Trọng tài sân: đổi ngay trên thẻ sân, chỉ khoá ô của sân đó; lỗi → báo và tải lại bảng sân. */
  const [savingCourt, setSavingCourt] = useState<number | null>(null);
  async function setCourtReferee(court: number, refereeUserId: string) {
    const who = (staff.data ?? []).find((s) => s.user_id === refereeUserId);
    board.mutate((bd) => ({ ...bd, courts: bd.courts.map((c) => (c.court === court ? { ...c, referee: who ? { id: who.user_id, name: who.full_name } : null } : c)) }));
    setSavingCourt(court);
    try {
      await api(`/tournaments/${t.id}/courts/${court}/referee`, { method: "PUT", body: { refereeUserId: refereeUserId || null } });
    } catch (e) {
      setError(`Giao trọng tài sân ${court} thất bại: ${(e as Error).message}`);
      void board.refresh();
    } finally {
      setSavingCourt(null);
    }
  }
  /** Gọi trận TRƯỚC giờ khai mạc → hỏi lại (dễ bấm nhầm khi đang chuẩn bị). */
  const [early, setEarly] = useState<{ m: Match; court: number; run: () => Promise<unknown> } | null>(null);
  const beforeOpening = now < new Date(t.starts_at).getTime();
  const guard = (m: Match, court: number, run: () => Promise<unknown>) => {
    if (beforeOpening) { setEarly({ m, court, run }); return Promise.resolve(false); }
    return run().then(() => true);
  };
  const call = (m: Match, court: number) => guard(m, court, () => doCall(m, court));
  /** Rút về trận ĐÃ CÓ ĐIỂM → hỏi lại. */
  const [uncalling, setUncalling] = useState<{ m: Match; court: number } | null>(null);
  const uncall = (m: Match, court: number) =>
    act(() => api(`/matches/${m.id}/uncall`, { method: "POST" }), `Đã rút trận khỏi sân ${court}`, boardOnly);
  const busyCourts = (b?.courts ?? []).filter((c) => c.current).map((c) => c.court);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ngày thi đấu" title="Điều phối sân"
        desc="Sân trống → gọi trận kế tiếp. Hệ thống chỉ gợi ý trận mà cả hai đội đều rảnh và đã nghỉ đủ; lịch giờ chỉ là dự kiến." />

      <NoRefereeHint staff={staff.data} slug={t.slug} />
      {board.error && <p role="alert" className="text-red-700">{board.error}</p>}
      {!b ? <CardSkeleton rows={4} /> : (
        <>
          <section aria-label="Các sân" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {b.courts.map((c) => {
              const m = c.current;
              const sug = c.suggestionId ? byId.get(c.suggestionId) : undefined;
              const state = !m ? "free" : m.status === "live" ? "live" : "called";
              return (
                <article key={c.court} aria-labelledby={`court-${c.court}`}
                  className={`flex flex-col rounded-3xl border bg-white p-4 shadow-sm ${state === "live" ? "border-red-300 ring-2 ring-red-100" : state === "called" ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-100"}`}>
                  <header className="mb-3 flex items-center justify-between gap-2">
                    <h2 id={`court-${c.court}`} className="headline flex items-center gap-2 text-2xl">
                      <MapPin className="h-5 w-5 text-primary" aria-hidden />Sân {c.court}
                    </h2>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${state === "live" ? "bg-red-600 text-white" : state === "called" ? "bg-amber-400 text-black" : "bg-emerald-50 text-emerald-700"}`}>
                      {state === "live" ? "Đang đánh" : state === "called" ? "Đã gọi" : "Trống"}
                      {m?.courtSince && <> · {since(m.courtSince, now)}</>}
                    </span>
                  </header>

                  <label className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-500">
                    <UserCheck className="h-4 w-4 shrink-0" aria-hidden /><span className="sr-only">Trọng tài sân {c.court}</span>
                    <select value={c.referee?.id ?? ""} disabled={savingCourt === c.court} aria-busy={savingCourt === c.court}
                      onChange={(e) => void setCourtReferee(c.court, e.target.value)}
                      className={`${textInputClass} min-h-11 text-sm cursor-pointer`}>
                      <option value="">— Chưa có trọng tài sân —</option>
                      <RefereeOptions staff={staff.data ?? []} />
                    </select>
                  </label>

                  {m ? (
                    <div className="flex flex-1 flex-col">
                      <p className="text-xs text-slate-500">{matchTitle(m)}</p>
                      <p className="mt-1 font-bold text-slate-900">{m.a?.name}</p>
                      <p className="font-bold text-slate-900"><span className="font-normal text-slate-400">vs </span>{m.b?.name}</p>
                      {m.games.length > 0 && <p className="tabular mt-2 text-lg font-bold text-red-700">{scoreLine(m)}</p>}
                      <div className="mt-auto flex flex-wrap gap-2 pt-4">
                        <Link href={`/ref/${m.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-black px-4 text-sm font-bold text-white hover:bg-black/85">
                          <PenLine className="h-4 w-4" aria-hidden />Bàn điểm
                        </Link>
                        <Button variant="outline" className="px-3" disabled={busy} onClick={() => setMoving(m)} aria-label={`Chuyển trận ở sân ${c.court} sang sân khác`}>
                          <ArrowRightLeft className="h-4 w-4" aria-hidden />Chuyển sân
                        </Button>
                        {state === "called" && (
                          <Button variant="ghost" className="px-3" disabled={busy}
                            onClick={() => (m.games.some((g) => g[0] + g[1] > 0) ? setUncalling({ m, court: c.court }) : void uncall(m, c.court))}>
                            <Undo2 className="h-4 w-4" aria-hidden />Rút về
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : sug ? (
                    <div className="flex flex-1 flex-col">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><BellRing className="h-3.5 w-3.5" aria-hidden />Gợi ý trận kế tiếp</p>
                      <p className="mt-1 text-xs text-slate-500">{matchTitle(sug.match)}{sug.match.scheduledAt && <> · dự kiến {fmtTime(sug.match.scheduledAt)}</>}</p>
                      <p className="mt-1 font-semibold text-slate-900">{sug.match.a?.name} <span className="font-normal text-slate-400">vs</span> {sug.match.b?.name}</p>
                      {sug.restingMinutes > 0 && <p className="mt-1 text-xs text-amber-700">Có VĐV vừa đánh xong — nghỉ thêm ~{sug.restingMinutes} phút</p>}
                      <div className="mt-auto flex flex-wrap gap-2 pt-4">
                        <Button variant="primary" disabled={busy} onClick={() => call(sug.match, c.court)}>
                          <Megaphone className="h-4 w-4" aria-hidden />Gọi vào sân
                        </Button>
                        <Button variant="ghost" className="px-3" disabled={busy} onClick={() => setPickFor(c.court)}>
                          <ListOrdered className="h-4 w-4" aria-hidden />Trận khác
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-col justify-between gap-3">
                      <p className="text-sm text-slate-500">
                        {b.queue.length ? "Mọi trận còn lại đều có VĐV đang ở sân khác." : "Không còn trận nào chờ."}
                      </p>
                      {b.queue.length > 0 && (
                        <Button variant="ghost" className="self-start px-3" disabled={busy} onClick={() => setPickFor(c.court)}>
                          <ListOrdered className="h-4 w-4" aria-hidden />Xem hàng chờ
                        </Button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </section>

          <Card title={`Hàng chờ (${b.queue.length})`}>
            {b.queue.length === 0 ? (
              <EmptyState icon={<Clock className="h-10 w-10" />} title="Không còn trận chờ" desc="Trận chỉ vào hàng chờ khi đã đủ 2 đội (bốc thăm / nhánh loại trực tiếp)." />
            ) : (
              <ul className="-mx-5 divide-y divide-slate-100 sm:-mx-6">
                {b.queue.map((q) => (
                  <QueueRow key={q.match.id} q={q} freeCourts={freeCourts} busy={busy} onCall={call} onMove={setMoving} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <Modal open={pickFor !== null} onClose={() => { setPickFor(null); setPickErr(null); }} title={`Chọn trận cho sân ${pickFor ?? ""}`} maxWidth="max-w-xl">
        {pickErr && <Notice kind="error">{pickErr}</Notice>}
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
          {(b?.queue ?? []).map((q) => (
            <li key={q.match.id} className="flex items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">{matchTitle(q.match)}</p>
                <p className="font-semibold text-slate-900">{q.match.a?.name} <span className="font-normal text-slate-400">vs</span> {q.match.b?.name}</p>
                <Reasons q={q} />
              </div>
              <Button variant="primary" className="px-3" disabled={busy || q.busyWith.length > 0}
                onClick={() => {
                  if (!pickFor) return;
                  const court = pickFor;
                  setPickErr(null);
                  void guard(q.match, court, async () => {
                    try {
                      await api(`/matches/${q.match.id}/call`, { method: "POST", body: { court } });
                      await act(async () => undefined, `Đã gọi ${q.match.a?.name} – ${q.match.b?.name} vào sân ${court}`, boardOnly);
                      setPickFor(null);
                    } catch (e) {
                      setPickErr((e as Error).message); // hiện trong hộp thoại, không bị che
                    }
                  });
                }}>
                Gọi
              </Button>
            </li>
          ))}
        </ul>
      </Modal>

      <MoveMatchModal key={moving?.id ?? "none"} match={moving} courts={t.courts} busyCourts={busyCourts} onClose={() => setMoving(null)}
        onDone={() => { void board.refresh(); }} />

      <Modal open={Boolean(early)} onClose={() => setEarly(null)} title="Giải chưa khai mạc">
        {early && (
          <>
            <p className="text-sm text-slate-600">
              Giải khai mạc lúc <strong className="tabular">{fmtTime(t.starts_at)}</strong>. Vẫn gọi <strong>{early.m.a?.name} – {early.m.b?.name}</strong> vào sân {early.court} ngay bây giờ?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEarly(null)}>Huỷ</Button>
              <Button variant="primary" disabled={busy} onClick={() => { const e = early; setEarly(null); void e.run(); }}>
                <Megaphone className="h-4 w-4" aria-hidden />Vẫn gọi
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={Boolean(uncalling)} onClose={() => setUncalling(null)} title="Rút trận đã có điểm?">
        {uncalling && (
          <>
            <p className="text-sm text-slate-600">
              Trận <strong>{uncalling.m.a?.name} – {uncalling.m.b?.name}</strong> đã có điểm ({scoreLine(uncalling.m)}). Rút về hàng chờ thì sân {uncalling.court} trống, điểm vẫn giữ.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setUncalling(null)}>Huỷ</Button>
              <Button variant="danger" disabled={busy} onClick={() => { const u = uncalling; setUncalling(null); void uncall(u.m, u.court); }}>
                <Undo2 className="h-4 w-4" aria-hidden />Vẫn rút về
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function Reasons({ q }: { q: QueueItem }) {
  return (
    <>
      {q.busyWith.map((x) => (
        <span key={x.name} className="mr-2 mt-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
          {x.name} đang ở sân {x.court ?? "?"}
        </span>
      ))}
      {q.restingMinutes > 0 && (
        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
          <Coffee className="h-3 w-3" aria-hidden />Nghỉ thêm ~{q.restingMinutes}′
        </span>
      )}
    </>
  );
}

/** Một dòng hàng chờ: gọi nhanh vào sân trống bất kỳ, hoặc dời giờ/sân dự kiến. */
function QueueRow({ q, freeCourts, busy, onCall, onMove }: {
  q: QueueItem; freeCourts: number[]; busy: boolean;
  onCall: (m: Match, court: number) => Promise<boolean>; onMove: (m: Match) => void;
}) {
  const [court, setCourt] = useState<string>("");
  const target = court || (q.match.court && freeCourts.includes(q.match.court) ? String(q.match.court) : String(freeCourts[0] ?? ""));
  const blocked = q.busyWith.length > 0;
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm sm:px-6">
      <div className="tabular w-24 shrink-0 text-xs text-slate-500">
        {q.match.scheduledAt ? fmtTime(q.match.scheduledAt) : "Chưa xếp giờ"}
        {q.match.court && <span className="block">dự kiến sân {q.match.court}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">{matchTitle(q.match)}</p>
        <p className="font-semibold text-slate-900">{q.match.a?.name} <span className="font-normal text-slate-400">vs</span> {q.match.b?.name}</p>
        <Reasons q={q} />
      </div>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`qc-${q.match.id}`}>Sân để gọi trận</label>
        <select id={`qc-${q.match.id}`} value={target} onChange={(e) => setCourt(e.target.value)} disabled={busy || blocked || !freeCourts.length}
          className={`${textInputClass} w-auto min-h-11 cursor-pointer`}>
          {!freeCourts.length && <option value="">Hết sân trống</option>}
          {freeCourts.map((n) => <option key={n} value={n}>Sân {n}</option>)}
        </select>
        <Button variant="primary" className="px-3" disabled={busy || blocked || !target} onClick={() => onCall(q.match, Number(target))}>
          <Megaphone className="h-4 w-4" aria-hidden />Gọi
        </Button>
        <Button variant="ghost" className="px-3" disabled={busy} onClick={() => onMove(q.match)} aria-label={`Dời trận ${q.match.a?.name} gặp ${q.match.b?.name}`}>
          <Clock className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

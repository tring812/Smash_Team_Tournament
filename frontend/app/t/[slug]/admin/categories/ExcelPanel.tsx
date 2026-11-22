"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, FileUp, Info, Users } from "lucide-react";
import { api } from "../../../../lib/api";
import { defaultSheets, downloadTemplate, exportEntries, planImport, readWorkbook, usableSheets, type NameDecision, type RawSheet } from "../../../../lib/excel";
import type { Athlete, Category, Entry } from "../../../../lib/types";
import { Button, Modal } from "../../../../components/ui";
import { useAdmin } from "../AdminContext";

const CHUNK = 256; // = giới hạn 1 lần gọi POST /categories/:id/entries

/** Nhập / xuất danh sách VĐV bằng Excel. File chỉ đọc trên trình duyệt; kế hoạch nhập được xem trước rồi mới ghi. */
export function ExcelPanel({ current }: { current: Category | undefined }) {
  const { t, busy, act, setError } = useAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState<null | "read" | "export" | "template">(null);
  /** File đã đọc + dữ liệu để lập kế hoạch; `picked` = sheet BTC chọn nhập (đổi chọn → lập lại kế hoạch). */
  const [loaded, setLoaded] = useState<{
    file: string; sheets: RawSheet[]; usable: string[]; picked: string[];
    existing: Record<string, Entry[]>; athletes: Athlete[];
    /** Lựa chọn của BTC cho dòng trùng tên khác CLB (khoá = NameClash.key). */
    decisions: Record<string, NameDecision>;
    /** Nội dung nhập lỗi ở lần bấm "Nhập" trước (các nội dung khác vẫn đã nhập). */
    failed: { code: string; message: string }[];
  } | null>(null);
  const [committing, setCommitting] = useState(false);
  const plan = useMemo(() => loaded && {
    file: loaded.file,
    plan: planImport(loaded.sheets.filter((x) => loaded.picked.includes(x.sheet)), t.categories, current, loaded.existing, loaded.athletes, loaded.decisions),
  }, [loaded, t.categories, current]);
  const setPlan = (v: null) => setLoaded(v);

  const loadEntries = async (cats: Category[]) =>
    Object.fromEntries(await Promise.all(cats.map(async (c) => [c.id, await api<Entry[]>(`/categories/${c.id}/entries`)] as const)));
  const loadAthletes = () => api<Athlete[]>(`/tournaments/${t.id}/athletes`);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setWorking("read");
    try {
      const sheets = await readWorkbook(file);
      const [existing, athletes] = await Promise.all([loadEntries(t.categories.filter((c) => c.stage === "setup")), loadAthletes()]);
      setLoaded({ file: file.name, sheets, usable: usableSheets(sheets), picked: defaultSheets(sheets, t.categories), existing, athletes, decisions: {}, failed: [] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(null);
      if (fileRef.current) fileRef.current.value = ""; // chọn lại cùng file vẫn kích hoạt onChange
    }
  }

  async function exportAll(cats: Category[]) {
    setWorking("export");
    try {
      const [byId, athletes] = await Promise.all([loadEntries(cats), loadAthletes()]);
      await exportEntries(t.name, cats.map((category) => ({ category, entries: byId[category.id] ?? [] })), athletes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(null);
    }
  }

  /**
   * Ghi từng NỘI DUNG độc lập: một nội dung lỗi (vd dữ liệu sai) không chặn các nội dung còn lại.
   * Có lỗi → giữ hộp xem trước, tải lại đội đã có (dòng đã vào sẽ tự bỏ qua) và báo lỗi theo từng nội dung.
   */
  async function commit() {
    if (!plan || !loaded) return;
    const groups = plan.plan.byCategory;
    setCommitting(true);
    const done: { code: string; n: number; drawn: boolean }[] = [];
    const failed: { code: string; message: string }[] = [];
    for (const g of groups) {
      try {
        const ids: string[] = [];
        for (let i = 0; i < g.rows.length; i += CHUNK) {
          const entries = g.rows.slice(i, i + CHUNK).map(({ p1, p2, club }) => ({
            player1Name: p1.name, player1StudentId: p1.studentId, player1Phone: p1.phone, player1Email: p1.email || null,
            player1NewAthlete: p1.newAthlete || undefined,
            player2Name: p2?.name ?? null, player2StudentId: p2?.studentId ?? null, player2Phone: p2?.phone ?? null, player2Email: p2?.email || null,
            player2NewAthlete: p2?.newAthlete || undefined,
            club,
          }));
          const created = await api<{ id: string }[]>(`/categories/${g.category.id}/entries`, { method: "POST", body: { entries } });
          ids.push(...created.map((e) => e.id)); // server trả đúng thứ tự gửi lên
        }
        // Bảng có sẵn trong file → chia đúng như file thay vì bốc thăm ngẫu nhiên.
        if (g.groups) {
          await api(`/categories/${g.category.id}/draw`, {
            method: "POST", body: { groups: g.groups.map((x) => ({ name: x.name, entryIds: x.rows.map((r) => ids[r]!) })) },
          });
        }
        done.push({ code: g.category.code, n: g.rows.length, drawn: Boolean(g.groups) });
      } catch (err) {
        failed.push({ code: g.category.code, message: (err as Error).message });
      }
    }
    const total = done.reduce((n, d) => n + d.n, 0);
    const drawn = done.filter((d) => d.drawn).map((d) => d.code);
    await act(async () => null, done.length
      ? `Đã nhập ${total} đội vào ${done.map((d) => d.code).join(", ")}${drawn.length ? ` và chia bảng theo file cho ${drawn.join(", ")}` : ""}`
        + (failed.length ? ` — ${failed.length} nội dung lỗi, xem trong hộp nhập` : "")
      : `Chưa nhập được nội dung nào — xem lỗi trong hộp nhập`);
    if (!failed.length) {
      setPlan(null);
    } else {
      // Đội đã vào sẽ được bỏ qua ở lần nhập lại; BTC sửa file / bỏ chọn sheet lỗi rồi bấm Nhập tiếp.
      try {
        const [existing, athletes] = await Promise.all([loadEntries(t.categories.filter((c) => c.stage === "setup")), loadAthletes()]);
        setLoaded({ ...loaded, existing, athletes, failed });
      } catch {
        setLoaded({ ...loaded, failed });
      }
    }
    setCommitting(false);
  }

  const p = plan?.plan;
  const total = p?.byCategory.reduce((n, g) => n + g.rows.length, 0) ?? 0;
  /** Bảng tổng hợp theo nội dung: số đội hợp lệ, dòng lỗi, dòng trùng. Lỗi chưa rõ nội dung gom vào một dòng riêng. */
  const summary = useMemo(() => {
    if (!p) return [];
    const rows = new Map<string, { label: string; ok: number; err: number; dup: number }>();
    const get = (code: string) => {
      let r = rows.get(code);
      if (!r) {
        const c = t.categories.find((x) => x.code === code);
        r = { label: c ? c.name : code, ok: 0, err: 0, dup: 0 };
        rows.set(code, r);
      }
      return r;
    };
    for (const g of p.byCategory) get(g.category.code).ok += g.rows.length;
    for (const e of p.errors) {
      if (e.codes?.length) e.codes.forEach((c) => get(c).err++);
      else get("").err++;
    }
    for (const s of p.skipped) s.codes?.forEach((c) => get(c).dup++);
    const order = (code: string) => { const i = t.categories.findIndex((c) => c.code === code); return i < 0 ? Infinity : i; };
    return [...rows.entries()].sort(([a], [b]) => order(a) - order(b))
      .map(([code, r]) => ({ code, ...r, label: code ? r.label : "Chưa xác định nội dung" }));
  }, [p, t.categories]);
  const btn = "inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:border-slate-400 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed";

  return (
    <section aria-labelledby="excel-h" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="excel-h" className="mr-auto flex items-center gap-2 font-bold text-slate-900">
          <FileSpreadsheet className="h-5 w-5 text-emerald-600" aria-hidden />Excel
          <span className="text-sm font-normal text-slate-500">nhập / xuất danh sách VĐV</span>
        </h2>
        <button type="button" className={btn} disabled={Boolean(working) || !t.categories.length}
          onClick={async () => { setWorking("template"); try { await downloadTemplate(t.name, t.categories); } catch (e) { setError((e as Error).message); } finally { setWorking(null); } }}>
          <Download className="h-4 w-4" aria-hidden />File mẫu
        </button>
        <label className={`${btn} ${!t.categories.length || working ? "pointer-events-none opacity-50" : ""}`}>
          <FileUp className="h-4 w-4" aria-hidden />{working === "read" ? "Đang đọc…" : "Nhập Excel / CSV"}
          <input ref={fileRef} type="file" className="sr-only" disabled={Boolean(working) || !t.categories.length}
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {current && (
          <button type="button" className={btn} disabled={Boolean(working)} onClick={() => void exportAll([current])}>
            <Download className="h-4 w-4" aria-hidden />Xuất {current.code}
          </button>
        )}
        {t.categories.length > 1 && (
          <button type="button" className={btn} disabled={Boolean(working)} onClick={() => void exportAll(t.categories)}>
            <Download className="h-4 w-4" aria-hidden />{working === "export" ? "Đang xuất…" : "Xuất toàn giải"}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Nhận file mẫu, <strong>file Google Sheets / Form</strong> (Tải xuống .xlsx hoặc .csv) hoặc file có mỗi nội dung một sheet (tên sheet như
        <strong>“ĐÔI NAM A”</strong>, đôi = 2 dòng cùng STT “ĐỘI n”). Cột: <strong>Nội dung</strong> · <strong>Họ tên</strong> · <strong>MSSV</strong> · <strong>SĐT</strong> ·
        đồng đội · <strong>CLB/Trường</strong> · <strong>Đăng kí bảng đấu / Hạng</strong> (A, B → nội dung “Đôi nam A”…) · <strong>Bảng</strong> (nếu đã chia sẵn).
        Người đã đăng ký tự bỏ qua. File xuất có MSSV/SĐT — đừng chia sẻ công khai.
      </p>

      <Modal open={Boolean(plan)} onClose={() => setPlan(null)} title={`Xem trước: ${plan?.file ?? ""}`} maxWidth="max-w-2xl">
        {p && (
          <div className="space-y-4 text-sm">
            {loaded && loaded.usable.length > 1 && (
              <fieldset className="rounded-2xl border border-slate-100 p-3">
                <legend className="px-1 font-bold text-slate-900">Sheet sẽ nhập</legend>
                <div className="flex flex-wrap gap-2">
                  {loaded.usable.map((name) => {
                    const on = loaded.picked.includes(name);
                    return (
                      <label key={name} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm font-semibold ${on ? "border-primary bg-red-50 text-red-800" : "border-slate-200 text-slate-600"}`}>
                        <input type="checkbox" className="h-4 w-4 accent-red-600" checked={on}
                          onChange={() => setLoaded({ ...loaded, picked: on ? loaded.picked.filter((x) => x !== name) : [...loaded.picked, name] })} />
                        {name}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  File có cả sheet câu trả lời Google Form lẫn sheet theo nội dung → mặc định chỉ chọn các sheet theo nội dung (danh sách đã chốt).
                  Trùng chỉ xét trong cùng một tab: người có ở hai tab cùng vào một nội dung sẽ báo lỗi (không tự bỏ qua) — vì vậy chỉ nên chọn một loại sheet.
                </p>
              </fieldset>
            )}
            {loaded && loaded.failed.length > 0 && (
              <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-800">
                <p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" aria-hidden />Lần nhập trước: {loaded.failed.length} nội dung lỗi (các nội dung khác đã vào)</p>
                <ul className="mt-1 space-y-1">{loaded.failed.map((f) => <li key={f.code}><span className="font-semibold">{f.code}:</span> {f.message}</li>)}</ul>
                <p className="mt-1 text-xs">Sửa file rồi chọn lại file, hoặc bấm Nhập để thử lại — đội đã vào tự bỏ qua.</p>
              </div>
            )}
            <section aria-labelledby="import-summary-h" className="rounded-2xl border border-slate-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="import-summary-h" className="font-bold text-slate-900">Tổng hợp dữ liệu đăng ký</h3>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${p.errors.length || p.nameClashes.length ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                  {p.errors.length || p.nameClashes.length ? "Cần kiểm tra" : "Sẵn sàng nhập"}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ["Hợp lệ", total, "text-emerald-700", "đội sẽ nhập"],
                  ["Có lỗi", p.errors.length, p.errors.length ? "text-red-700" : "text-slate-400", "dòng không nhập"],
                  ["Cần xác nhận", p.nameClashes.length, p.nameClashes.length ? "text-amber-700" : "text-slate-400", "trùng tên"],
                  ["Trùng", p.skipped.length, "text-slate-500", "bỏ qua"],
                ] as const).map(([label, n, tone, hint]) => (
                  <div key={label} className="flex flex-col rounded-xl bg-slate-50 p-3">
                    <dt className="text-sm font-semibold text-slate-700">
                      {label}<span className="block text-xs font-normal text-slate-500">{hint}</span>
                    </dt>
                    <dd className={`order-first text-2xl font-bold tabular-nums ${tone}`}>{n}</dd>
                  </div>
                ))}
              </dl>
              {summary.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Phân loại theo nội dung</caption>
                    <thead>
                      <tr className="whitespace-nowrap border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th scope="col" className="py-2 pr-2 font-semibold">Nội dung</th>
                        <th scope="col" className="px-2 py-2 text-right font-semibold">Hợp lệ</th>
                        <th scope="col" className="px-2 py-2 text-right font-semibold">Lỗi</th>
                        <th scope="col" className="py-2 pl-2 text-right font-semibold">Trùng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {summary.map((r) => (
                        <tr key={r.code || "?"}>
                          <th scope="row" className="py-2 pr-2 text-left font-medium text-slate-900">
                            {r.code && <span className="mr-1.5 text-xs font-bold text-slate-500">{r.code}</span>}{r.label}
                          </th>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-900">{r.ok}</td>
                          <td className={`px-2 py-2 text-right tabular-nums ${r.err ? "font-bold text-red-700" : "text-slate-400"}`}>{r.err}</td>
                          <td className="py-2 pl-2 text-right tabular-nums text-slate-500">{r.dup}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {p.errors.length > 0 && (
              <details open className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-800">
                <summary className="flex cursor-pointer items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" aria-hidden />{p.errors.length} dòng lỗi cần xử lý — sẽ KHÔNG được nhập</summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {p.errors.slice(0, 100).map((e, i) => <li key={i}><span className="font-semibold">{e.sheet} · dòng {e.row}:</span> {e.message}</li>)}
                </ul>
              </details>
            )}
            {p.nameClashes.length > 0 && (
              <fieldset className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-800">
                <legend className="flex items-center gap-2 px-1 font-bold"><Users className="h-4 w-4" aria-hidden />{p.nameClashes.length} VĐV trùng tên người khác, không có MSSV / SĐT</legend>
                <p className="text-xs">Chỉ có tên thì không biết chắc là một người hay hai. Khác CLB → mặc định là <strong>người khác</strong> (tạo hồ sơ riêng). Nếu đúng là cùng một người thì chọn &quot;Cùng người&quot;.</p>
                <ul className="mt-2 space-y-2">
                  {p.nameClashes.map((c) => (
                    <li key={c.key} className="rounded-xl bg-white/70 p-2 text-sm text-slate-700">
                      <p><span className="font-semibold text-slate-900">{c.name}</span>{c.club ? ` · ${c.club}` : ""} <span className="text-xs text-slate-500">({c.sheet} · dòng {c.row} · {c.code})</span></p>
                      <p className="text-xs text-slate-500">Trùng tên với: {c.others.join("; ")}</p>
                      <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={`${c.name} dòng ${c.row}`}>
                        {(["new", "same"] as const).map((d) => (
                          <label key={d} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm font-semibold ${c.decision === d ? "border-primary bg-red-50 text-red-800" : "border-slate-200 text-slate-600"}`}>
                            <input type="radio" className="accent-red-600" name={c.key} checked={c.decision === d}
                              onChange={() => loaded && setLoaded({ ...loaded, decisions: { ...loaded.decisions, [c.key]: d } })} />
                            {d === "new" ? "Người khác" : "Cùng người"}
                          </label>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            {p.warnings.length > 0 && (
              <details className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-800">
                <summary className="flex cursor-pointer items-center gap-2 font-bold"><Info className="h-4 w-4" aria-hidden />{p.warnings.length} dòng có ô bị bỏ qua — vẫn nhập</summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {p.warnings.slice(0, 100).map((w, i) => <li key={i}><span className="font-semibold">{w.sheet} · dòng {w.row}:</span> {w.message}</li>)}
                </ul>
              </details>
            )}
            {p.notes.length > 0 && (
              <ul className="space-y-1 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-800">
                {p.notes.map((n) => <li key={n} className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{n}</li>)}
              </ul>
            )}
            {p.byCategory.length > 0 ? (
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
                {p.byCategory.map((g) => (
                  <li key={g.category.id} className="p-3">
                    <p className="font-bold text-slate-900">{g.category.code} — {g.category.name}: <span className="text-primary">+{g.rows.length} {g.category.is_doubles ? "cặp" : "VĐV"}</span></p>
                    <p className="mt-1 line-clamp-2 text-slate-500">
                      {g.rows.slice(0, 8).map((r) => (r.p2 ? `${r.p1.name} / ${r.p2.name}` : r.p1.name)).join(" · ")}
                      {g.rows.length > 8 && ` · … và ${g.rows.length - 8} nữa`}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {g.rows.filter((r) => r.p1.studentId || r.p1.phone).length}/{g.rows.length} dòng có MSSV hoặc SĐT
                    </p>
                    {g.groups && (
                      <p className="mt-1 text-xs font-semibold text-emerald-700">
                        Chia bảng theo file: {g.groups.map((x) => `Bảng ${x.name} (${x.rows.length})`).join(" · ")} — không bốc thăm ngẫu nhiên
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-2xl bg-slate-50 p-3 text-slate-600">Không có đội mới nào để nhập.</p>}

            {p.skipped.length > 0 && (
              <details className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-700">
                <summary className="flex cursor-pointer items-center gap-2 font-bold"><Info className="h-4 w-4" aria-hidden />{p.skipped.length} dòng trùng — bỏ qua</summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {p.skipped.slice(0, 100).map((e, i) => <li key={i}><span className="font-semibold">{e.sheet} · dòng {e.row}:</span> {e.message}</li>)}
                </ul>
              </details>
            )}
            {p.errors.length > 0 && total > 0 && <p className="text-xs text-slate-500">Có thể nhập phần hợp lệ ngay, sửa các dòng lỗi rồi nhập lại file — dòng đã nhập sẽ tự bỏ qua vì trùng.</p>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPlan(null)}>Huỷ</Button>
              <Button variant="primary" disabled={total === 0 || busy} loading={committing} onClick={() => void commit()}>Nhập {total} đội</Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

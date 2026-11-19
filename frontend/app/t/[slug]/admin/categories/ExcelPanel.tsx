"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, FileUp, Info } from "lucide-react";
import { api } from "../../../../lib/api";
import { downloadTemplate, exportEntries, planImport, readWorkbook, type ImportPlan } from "../../../../lib/excel";
import type { Athlete, Category, Entry } from "../../../../lib/types";
import { Button, Modal } from "../../../../components/ui";
import { useAdmin } from "../AdminContext";

const CHUNK = 256; // = giới hạn 1 lần gọi POST /categories/:id/entries

/** Nhập / xuất danh sách VĐV bằng Excel. File chỉ đọc trên trình duyệt; kế hoạch nhập được xem trước rồi mới ghi. */
export function ExcelPanel({ current }: { current: Category | undefined }) {
  const { t, busy, act, setError } = useAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState<null | "read" | "export" | "template">(null);
  const [plan, setPlan] = useState<{ file: string; plan: ImportPlan } | null>(null);

  const loadEntries = async (cats: Category[]) =>
    Object.fromEntries(await Promise.all(cats.map(async (c) => [c.id, await api<Entry[]>(`/categories/${c.id}/entries`)] as const)));
  const loadAthletes = () => api<Athlete[]>(`/tournaments/${t.id}/athletes`);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setWorking("read");
    try {
      const sheets = await readWorkbook(file);
      const [existing, athletes] = await Promise.all([loadEntries(t.categories.filter((c) => c.stage === "setup")), loadAthletes()]);
      setPlan({ file: file.name, plan: planImport(sheets, t.categories, current, existing, athletes) });
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

  async function commit() {
    if (!plan) return;
    const groups = plan.plan.byCategory;
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    const drawn = groups.filter((g) => g.groups).map((g) => g.category.code);
    const ok = await act(async () => {
      for (const g of groups) {
        const ids: string[] = [];
        for (let i = 0; i < g.rows.length; i += CHUNK) {
          const entries = g.rows.slice(i, i + CHUNK).map(({ p1, p2, club }) => ({
            player1Name: p1.name, player1StudentId: p1.studentId, player1Phone: p1.phone, player1Email: p1.email || null,
            player2Name: p2?.name ?? null, player2StudentId: p2?.studentId ?? null, player2Phone: p2?.phone ?? null, player2Email: p2?.email || null,
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
      }
    }, `Đã nhập ${total} đội vào ${groups.map((g) => g.category.code).join(", ")}${drawn.length ? ` và chia bảng theo file cho ${drawn.join(", ")}` : ""}`);
    if (ok) setPlan(null);
  }

  const p = plan?.plan;
  const total = p?.byCategory.reduce((n, g) => n + g.rows.length, 0) ?? 0;
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
        Nhận file mẫu hoặc <strong>CSV tải từ Google Form</strong>. Cột: <strong>Nội dung</strong> · <strong>Họ tên</strong> · <strong>MSSV</strong> · <strong>SĐT</strong> ·
        đồng đội (họ tên / MSSV / SĐT) · <strong>CLB</strong> · <strong>Bảng</strong> (nếu đã chia sẵn). MSSV/SĐT giúp phân biệt người trùng tên;
        người đã đăng ký tự bỏ qua. File xuất có MSSV/SĐT — đừng chia sẻ công khai.
      </p>

      <Modal open={Boolean(plan)} onClose={() => setPlan(null)} title={`Xem trước: ${plan?.file ?? ""}`} maxWidth="max-w-2xl">
        {p && (
          <div className="space-y-4 text-sm">
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

            {p.errors.length > 0 && (
              <details open className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-800">
                <summary className="flex cursor-pointer items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" aria-hidden />{p.errors.length} dòng lỗi — sẽ KHÔNG được nhập</summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {p.errors.slice(0, 100).map((e, i) => <li key={i}><span className="font-semibold">{e.sheet} · dòng {e.row}:</span> {e.message}</li>)}
                </ul>
              </details>
            )}
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
              <Button variant="primary" disabled={total === 0} loading={busy} onClick={() => void commit()}>Nhập {total} đội</Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

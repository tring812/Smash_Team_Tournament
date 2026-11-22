"use client";

import { useState } from "react";
import { ArrowLeftRight, GitBranch, Pencil, Plus, RotateCcw, Shuffle, Trash2, UserX, Users } from "lucide-react";
import { api } from "../../../../lib/api";
import { usePoll } from "../../../../lib/usePoll";
import type { Category, Entry, Match } from "../../../../lib/types";
import { Button, Card, DqBadge, EmptyState, Field, Modal, PageHeader, Select, textInputClass } from "../../../../components/ui";
import { STAGE_LABEL, useAdmin } from "../AdminContext";
import { ExcelPanel } from "./ExcelPanel";
import { RoundRulesCard } from "./RoundRulesCard";

const PRESETS = {
  bwf: { label: "21 điểm, trần 30 (BWF)", pointsToWin: 21, maxPoints: 30 },
  p15: { label: "15 điểm, trần 21", pointsToWin: 15, maxPoints: 21 },
  p11: { label: "11 điểm, trần 15", pointsToWin: 11, maxPoints: 15 },
} as const;

/** Dòng "Tên 1 / Tên 2 ; CLB" → entry (giải mở rộng: không ELO, không hạt giống). Dòng trống bỏ qua. */
/**
 * Mỗi dòng: `tên ; CLB ; MSSV ; SĐT` (đôi: `tên A / tên B ; CLB ; MSSV A / MSSV B ; SĐT A / SĐT B`).
 * Chỉ tên là bắt buộc; MSSV/SĐT giúp phân biệt người trùng tên và nhận ra một người đánh nhiều nội dung.
 */
function parseEntries(text: string, doubles: boolean) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [players = "", club = "", sids = "", phones = ""] = line.split(";").map((s) => s.trim());
    const pair = (v: string) => v.split("/").map((s) => s.trim());
    const [p1 = "", p2] = pair(players);
    const [s1, s2] = pair(sids);
    const [ph1, ph2] = pair(phones);
    return {
      player1Name: p1, player2Name: doubles ? (p2 ?? "") : null, club,
      player1StudentId: s1 || null, player1Phone: ph1 || null,
      ...(doubles ? { player2StudentId: s2 || null, player2Phone: ph2 || null } : {}),
    };
  });
}

export default function CategoriesPage() {
  const { t, version, busy, act } = useAdmin();
  const [catId, setCatId] = useState("");
  // Nội dung đang chọn bị xoá → tự quay về nội dung đầu tiên.
  const cat = t.categories.find((c) => c.id === catId) ?? t.categories[0];
  const cid = cat?.id ?? "";

  const entries = usePoll((s) => (cid ? api<Entry[]>(`/categories/${cid}/entries`, { signal: s }) : Promise.resolve([])), [cid, version], 30_000);
  const matches = usePoll((s) => (cid ? api<Match[]>(`/tournaments/${t.id}/matches?categoryId=${cid}`, { signal: s }) : Promise.resolve([])), [cid, version], 30_000);

  const [addOpen, setAddOpen] = useState(false);
  const [newCat, setNewCat] = useState({ code: "MS", name: "Đơn nam", isDoubles: false, groupCount: 2, advancePerGroup: 2, preset: "bwf" as keyof typeof PRESETS, gamesToWin: 2 });
  const [bulk, setBulk] = useState("");
  const [swap, setSwap] = useState({ a: "", b: "" });
  const [editing, setEditing] = useState<{ e: Entry; p1: string; p2: string; club: string } | null>(null);
  const [dq, setDq] = useState<{ e: Entry; reason: string } | null>(null);

  const list = entries.data ?? [];
  const started = (m: Match) => !["bye", "cancelled"].includes(m.status) && (["live", "finished", "walkover"].includes(m.status) || m.games.length > 0);
  const groupsStarted = (matches.data ?? []).some((m) => m.stage === "group" && started(m));
  const anyStarted = (matches.data ?? []).some(started);
  const swapA = list.find((x) => x.id === swap.a);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Quản lý giải" title="Nội dung & VĐV" desc="Thêm nội dung, nhập danh sách đăng ký, bốc thăm ngẫu nhiên và điều hành đội."
        actions={<Button onClick={() => setAddOpen(true)}><Plus className="w-4 h-4" aria-hidden />Thêm nội dung</Button>} />

      <ExcelPanel current={cat} />

      {t.categories.length === 0 ? (
        <Card><EmptyState icon={<Users className="w-10 h-10" />} title="Chưa có nội dung thi đấu" desc="Tạo nội dung đầu tiên, ví dụ Đơn nam (MS) hoặc Đôi nam nữ (XD)."
          action={<Button onClick={() => setAddOpen(true)}><Plus className="w-4 h-4" aria-hidden />Thêm nội dung</Button>} /></Card>
      ) : (
        <div role="tablist" aria-label="Chọn nội dung" className="flex flex-wrap gap-2">
          {t.categories.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={c.id === cid} onClick={() => { setCatId(c.id); setSwap({ a: "", b: "" }); }}
              className={`min-h-11 rounded-full px-4 text-sm transition-colors cursor-pointer ${c.id === cid ? "bg-black text-white" : "bg-white border border-slate-200 text-slate-700 hover:border-slate-400"}`}>
              <strong>{c.code}</strong> · {c.entry_count} đội · {STAGE_LABEL[c.stage]}
            </button>
          ))}
        </div>
      )}

      {cat && (
        <Card title={`${cat.code} — ${cat.name}`} actions={<>
          <CategoryActions cat={cat} entryCount={list.length} groupsStarted={groupsStarted} />
          <CategoryCrud cat={cat} entryCount={list.length} anyStarted={anyStarted} onDeleted={() => setCatId("")} />
        </>}>
          <p className="-mt-2 mb-5 text-sm text-slate-500">
            {cat.is_doubles ? "Đôi" : "Đơn"} · {cat.group_count} bảng · {cat.advance_per_group} đội/bảng đi tiếp · {cat.points_to_win} điểm (trần {cat.max_points}) · {cat.games_to_win === 2 ? "thắng 2/3 game" : "1 game"}
          </p>

          {cat.stage === "setup" && (
            <form className="mb-6 grid gap-3 rounded-2xl bg-slate-50 p-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act(() => api(`/categories/${cat.id}/entries`, { method: "POST", body: { entries: parseEntries(bulk, cat.is_doubles) } }), "Đã thêm đội")) setBulk("");
              }}>
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-bold text-slate-600">Dán danh sách đăng ký (mỗi dòng 1 {cat.is_doubles ? "cặp" : "VĐV"}) — hoặc dùng Nhập từ Excel ở trên</span>
                <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} required className={`${textInputClass} font-mono text-sm`}
                  placeholder={cat.is_doubles ? "Nguyễn An / Trần Chi ; CLB Quận 7 ; 21520001 / 21520002 ; 0901234567 / 0912345678\nLê Bình / Phạm Dung" : "Nguyễn An ; CLB Quận 7 ; 21520001 ; 0901234567\nLê Bình"} />
                <span className="text-xs text-slate-500">Định dạng: tên{cat.is_doubles ? " / tên" : ""} ; CLB ; MSSV{cat.is_doubles ? " / MSSV" : ""} ; SĐT{cat.is_doubles ? " / SĐT" : ""} — chỉ tên là bắt buộc; MSSV/SĐT giúp phân biệt người trùng tên. Bốc thăm <strong>ngẫu nhiên</strong> và tự tách VĐV cùng CLB ra các bảng.</span>
              </label>
              <div><Button type="submit" disabled={busy}><Plus className="w-4 h-4" aria-hidden />Thêm vào danh sách</Button></div>
            </form>
          )}

          {cat.stage === "groups" && (
            <form className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl bg-slate-50 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void act(() => api(`/categories/${cat.id}/swap`, { method: "POST", body: { entryA: swap.a, entryB: swap.b } }), "Đã đổi bảng & tạo lại lịch vòng tròn 2 bảng")
                  .then((ok) => ok && setSwap({ a: "", b: "" }));
              }}>
              <div className="min-w-56 flex-1">
                <Select label="Đổi chỗ đội" value={swap.a} required onChange={(e) => setSwap({ a: e.target.value, b: "" })}>
                  <option value="">— Chọn đội —</option>
                  {list.filter((x) => !x.disqualified_at && x.group_id).map((x) => <option key={x.id} value={x.id}>Bảng {x.group_name} · {x.name}</option>)}
                </Select>
              </div>
              <ArrowLeftRight className="mb-3.5 w-5 h-5 text-primary" aria-hidden />
              <div className="min-w-56 flex-1">
                <Select label="với đội ở bảng khác" value={swap.b} required disabled={!swapA} onChange={(e) => setSwap({ ...swap, b: e.target.value })}>
                  <option value="">— Chọn đội —</option>
                  {list.filter((x) => !x.disqualified_at && x.group_id && x.group_id !== swapA?.group_id).map((x) => <option key={x.id} value={x.id}>Bảng {x.group_name} · {x.name}</option>)}
                </Select>
              </div>
              <Button type="submit" variant="outline" disabled={busy || !swap.a || !swap.b}>Đổi bảng</Button>
              <p className="w-full text-xs text-slate-500">Chỉ đổi được khi 2 bảng chưa có trận nào được nhập điểm. Lịch vòng tròn của 2 bảng được tạo lại.</p>
            </form>
          )}

          {list.length === 0 ? <EmptyState icon={<Users className="w-10 h-10" />} title="Chưa có đội nào" desc={cat.stage === "setup" ? "Dán danh sách ở ô phía trên hoặc bấm Nhập từ Excel." : undefined} /> : (
            <div className="-mx-5 overflow-x-auto sm:-mx-6">
              <table className="w-full text-sm">
                <caption className="sr-only">Danh sách đội nội dung {cat.code}</caption>
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 sm:px-6">Bảng</th>
                    <th scope="col" className="py-3 pr-3">Đội / VĐV</th>
                    <th scope="col" className="py-3 pr-3">CLB</th>
                    <th scope="col" className="py-3 pr-3 text-right"><abbr title="Bốc thăm phụ — phá hoà cuối cùng ở bảng xếp hạng">Thăm</abbr></th>
                    <th scope="col" className="py-3 pr-5 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => {
                    const isDq = Boolean(e.disqualified_at);
                    const canEdit = !isDq && !e.has_played && cat.stage !== "completed";
                    return (
                      <tr key={e.id} className={`border-t border-slate-100 ${isDq ? "text-slate-400" : ""}`}>
                        <td className="px-5 py-3 sm:px-6">
                          {e.group_name ? <span className="inline-grid h-7 w-7 place-items-center rounded-lg bg-black text-xs font-bold text-white">{e.group_name}</span> : "—"}
                        </td>
                        <th scope="row" className="py-3 pr-3 text-left font-semibold">
                          <span className={isDq ? "line-through" : "text-slate-900"}>{e.name}</span>
                          {isDq && <><DqBadge reason={e.dq_reason} /><span className="block text-xs font-normal">Lý do: {e.dq_reason}</span></>}
                        </th>
                        <td className="py-3 pr-3 text-slate-600">{e.club || "—"}</td>
                        <td className="tabular py-3 pr-3 text-right text-slate-500">{e.draw_lot ?? "—"}</td>
                        <td className="py-2 pr-5 sm:pr-6">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {canEdit && (
                              <Button variant="ghost" className="px-3" disabled={busy} aria-label={`Sửa ${e.name}`}
                                onClick={() => setEditing({ e, p1: e.player1_name, p2: e.player2_name ?? "", club: e.club })}>
                                <Pencil className="w-4 h-4" aria-hidden /><span className="hidden md:inline">Sửa</span>
                              </Button>
                            )}
                            {cat.stage === "setup" && (
                              <Button variant="danger" className="px-3" disabled={busy} aria-label={`Xoá ${e.name}`}
                                onClick={() => act(() => api(`/entries/${e.id}`, { method: "DELETE" }), `Đã xoá ${e.name}`)}>
                                <Trash2 className="w-4 h-4" aria-hidden /><span className="hidden md:inline">Xoá</span>
                              </Button>
                            )}
                            {(cat.stage === "groups" || cat.stage === "knockout") && !isDq && (
                              <Button variant="danger" className="px-3" disabled={busy} aria-label={`Truất quyền ${e.name}`} onClick={() => setDq({ e, reason: "" })}>
                                <UserX className="w-4 h-4" aria-hidden /><span className="hidden md:inline">Truất quyền</span>
                              </Button>
                            )}
                            {isDq && cat.stage === "groups" && (
                              <Button variant="outline" className="px-3" disabled={busy}
                                onClick={() => act(() => api(`/entries/${e.id}/reinstate`, { method: "POST" }), `Đã huỷ truất quyền ${e.name}`)}>
                                <RotateCcw className="w-4 h-4" aria-hidden />Huỷ truất quyền
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* key: đổi nội dung / vừa lưu → nạp lại bản nháp từ dữ liệu mới */}
      {cat && <RoundRulesCard key={`${cat.id}:${JSON.stringify(cat.round_rules ?? {})}:${matches.data ? 1 : 0}`} cat={cat} matches={matches.data ?? []} />}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Thêm nội dung thi đấu" maxWidth="max-w-xl">
        <form className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const p = PRESETS[newCat.preset];
            const ok = await act(() => api(`/tournaments/${t.id}/categories`, {
              method: "POST",
              body: { code: newCat.code, name: newCat.name, isDoubles: newCat.isDoubles, groupCount: newCat.groupCount,
                advancePerGroup: newCat.advancePerGroup, pointsToWin: p.pointsToWin, maxPoints: p.maxPoints, gamesToWin: newCat.gamesToWin },
            }), `Đã thêm nội dung ${newCat.code}`);
            if (ok) setAddOpen(false);
          }}>
          <Field label="Mã" required pattern="[A-Z0-9]{1,10}" value={newCat.code} onChange={(e) => setNewCat({ ...newCat, code: e.target.value.toUpperCase() })} hint="MS, WS, MD, WD, XD…" />
          <Field label="Tên" required value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
          <Select label="Loại" value={newCat.isDoubles ? "d" : "s"} onChange={(e) => setNewCat({ ...newCat, isDoubles: e.target.value === "d" })}>
            <option value="s">Đơn</option><option value="d">Đôi</option>
          </Select>
          <Field label="Số bảng" type="number" inputMode="numeric" min={1} max={32} value={newCat.groupCount} onChange={(e) => setNewCat({ ...newCat, groupCount: Number(e.target.value) })} />
          <Field label="Số đội đi tiếp / bảng" type="number" inputMode="numeric" min={1} max={4} value={newCat.advancePerGroup} onChange={(e) => setNewCat({ ...newCat, advancePerGroup: Number(e.target.value) })} />
          <Select label="Luật điểm" value={newCat.preset} onChange={(e) => setNewCat({ ...newCat, preset: e.target.value as keyof typeof PRESETS })}>
            {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Select label="Thể thức" value={newCat.gamesToWin} onChange={(e) => setNewCat({ ...newCat, gamesToWin: Number(e.target.value) })}>
            <option value={2}>Thắng 2/3 game</option><option value={1}>1 game</option>
          </Select>
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Huỷ</Button>
            <Button type="submit" disabled={busy}>Thêm nội dung</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Sửa đội: ${editing?.e.name ?? ""}`}>
        {editing && cat && (
          <form className="grid gap-4"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const ok = await act(() => api(`/entries/${editing.e.id}`, { method: "PATCH", body: { player1Name: editing.p1, player2Name: cat.is_doubles ? editing.p2 : null, club: editing.club } }), "Đã cập nhật đội");
              if (ok) setEditing(null);
            }}>
            <Field label="VĐV 1" required value={editing.p1} onChange={(ev) => setEditing({ ...editing, p1: ev.target.value })} />
            {cat.is_doubles && <Field label="VĐV 2 (đồng đội)" required value={editing.p2} onChange={(ev) => setEditing({ ...editing, p2: ev.target.value })} />}
            <Field label="CLB" value={editing.club} onChange={(ev) => setEditing({ ...editing, club: ev.target.value })} hint="Chỉ sửa được khi đội chưa thi đấu trận nào." />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Huỷ</Button>
              <Button type="submit" disabled={busy}>Lưu</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={Boolean(dq)} onClose={() => setDq(null)} title={`Truất quyền: ${dq?.e.name ?? ""}`}>
        {dq && cat && (
          <form className="grid gap-4"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const ok = await act(() => api(`/entries/${dq.e.id}/disqualify`, { method: "POST", body: { reason: dq.reason } }), `Đã truất quyền ${dq.e.name}`);
              if (ok) setDq(null);
            }}>
            <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">
              {cat.stage === "groups"
                ? "Vòng bảng: MỌI kết quả của đội bị huỷ (theo BWF), bảng xếp hạng tính lại. Có thể huỷ truất quyền trước khi tạo nhánh."
                : "Loại trực tiếp: đối thủ thắng bỏ cuộc (W.O) và đi tiếp. Không thể hoàn tác."}
            </p>
            <Field label="Lý do (bắt buộc, ghi vào nhật ký)" required minLength={3} maxLength={300} value={dq.reason}
              onChange={(ev) => setDq({ ...dq, reason: ev.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDq(null)}>Huỷ</Button>
              <Button type="submit" variant="primary" disabled={busy}><UserX className="w-4 h-4" aria-hidden />Xác nhận truất quyền</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/**
 * Sửa / xoá nội dung. Các trường bị khoá theo giai đoạn được tắt kèm lý do (server vẫn kiểm tra lại):
 * đơn/đôi khi đã có đội; số bảng & số đội đi tiếp khi đã bốc thăm; luật điểm khi đã có trận bắt đầu.
 * Xoá chỉ khi chưa trận nào bắt đầu, và phải gõ đúng mã nội dung để xác nhận.
 */
function CategoryCrud({ cat, entryCount, anyStarted, onDeleted }: { cat: Category; entryCount: number; anyStarted: boolean; onDeleted: () => void }) {
  const { busy, act } = useAdmin();
  const presetOf = (c: Category) => (Object.entries(PRESETS).find(([, p]) => p.pointsToWin === c.points_to_win && p.maxPoints === c.max_points)?.[0] ?? "keep") as keyof typeof PRESETS | "keep";
  const init = () => ({ code: cat.code, name: cat.name, isDoubles: cat.is_doubles, groupCount: cat.group_count, advancePerGroup: cat.advance_per_group, preset: presetOf(cat), gamesToWin: cat.games_to_win });
  const [edit, setEdit] = useState<ReturnType<typeof init> | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const drawn = cat.stage !== "setup";
  const lockDoubles = drawn || entryCount > 0;

  return (
    <>
      <Button variant="ghost" className="px-3" disabled={busy} onClick={() => setEdit(init())} aria-label={`Sửa nội dung ${cat.code}`}>
        <Pencil className="w-4 h-4" aria-hidden /><span className="hidden md:inline">Sửa</span>
      </Button>
      <Button variant="danger" className="px-3" disabled={busy || anyStarted} onClick={() => setDel("")} aria-label={`Xoá nội dung ${cat.code}`}
        title={anyStarted ? "Đã có trận được nhập điểm — không thể xoá" : undefined}>
        <Trash2 className="w-4 h-4" aria-hidden /><span className="hidden md:inline">Xoá</span>
      </Button>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={`Sửa nội dung ${cat.code}`} maxWidth="max-w-xl">
        {edit && (
          <form className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const p = edit.preset === "keep" ? null : PRESETS[edit.preset];
              const body = {
                code: edit.code, name: edit.name, isDoubles: edit.isDoubles, groupCount: edit.groupCount,
                advancePerGroup: edit.advancePerGroup, gamesToWin: edit.gamesToWin,
                ...(p ? { pointsToWin: p.pointsToWin, maxPoints: p.maxPoints } : {}),
              };
              if (await act(() => api(`/categories/${cat.id}`, { method: "PATCH", body }), `Đã cập nhật nội dung ${edit.code}`)) setEdit(null);
            }}>
            <Field label="Mã" required pattern="[A-Z0-9]{1,10}" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} hint="MS, WS, MD, WD, XD…" />
            <Field label="Tên" required maxLength={100} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Select label="Loại" value={edit.isDoubles ? "d" : "s"} disabled={lockDoubles} onChange={(e) => setEdit({ ...edit, isDoubles: e.target.value === "d" })}>
              <option value="s">Đơn</option><option value="d">Đôi</option>
            </Select>
            <Field label="Số bảng" type="number" inputMode="numeric" min={1} max={32} disabled={drawn} value={edit.groupCount}
              onChange={(e) => setEdit({ ...edit, groupCount: Number(e.target.value) })} />
            <Field label="Số đội đi tiếp / bảng" type="number" inputMode="numeric" min={1} max={4} disabled={drawn} value={edit.advancePerGroup}
              onChange={(e) => setEdit({ ...edit, advancePerGroup: Number(e.target.value) })} />
            <Select label="Luật điểm mặc định" value={edit.preset} disabled={anyStarted} onChange={(e) => setEdit({ ...edit, preset: e.target.value as keyof typeof PRESETS | "keep" })}>
              {edit.preset === "keep" && <option value="keep">Giữ nguyên ({cat.points_to_win}, trần {cat.max_points})</option>}
              {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Select label="Thể thức" value={edit.gamesToWin} disabled={anyStarted} onChange={(e) => setEdit({ ...edit, gamesToWin: Number(e.target.value) })}>
              <option value={2}>Thắng 2/3 game</option><option value={1}>1 game</option>
            </Select>
            <ul className="space-y-1 text-xs text-slate-500 sm:col-span-2">
              {lockDoubles && <li>• Đơn/đôi chỉ đổi được khi nội dung chưa có đội nào.</li>}
              {drawn && <li>• Đã bốc thăm: không đổi số bảng / số đội đi tiếp.</li>}
              {anyStarted && <li>• Đã có trận bắt đầu: không đổi luật điểm / thể thức.</li>}
            </ul>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>Huỷ</Button>
              <Button type="submit" disabled={busy}>Lưu thay đổi</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={del !== null} onClose={() => setDel(null)} title={`Xoá nội dung ${cat.code}?`}>
        <form className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => api(`/categories/${cat.id}`, { method: "DELETE" }), `Đã xoá nội dung ${cat.code}`)) { setDel(null); onDeleted(); }
          }}>
          <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">
            Xoá <strong>{cat.code} — {cat.name}</strong> cùng <strong>{entryCount} đội</strong>, toàn bộ bảng đấu và lịch của nội dung này. Không thể hoàn tác. Nhật ký thao tác vẫn được giữ.
          </p>
          <Field label={`Gõ "${cat.code}" để xác nhận`} required value={del ?? ""} onChange={(e) => setDel(e.target.value.toUpperCase())} autoComplete="off" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDel(null)}>Huỷ</Button>
            <Button type="submit" variant="primary" disabled={busy || del !== cat.code}><Trash2 className="w-4 h-4" aria-hidden />Xoá vĩnh viễn</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function CategoryActions({ cat, entryCount, groupsStarted }: { cat: Category; entryCount: number; groupsStarted: boolean }) {
  const { t, busy, act } = useAdmin();
  const [confirmDraw, setConfirmDraw] = useState(false);
  const [confirmRedraw, setConfirmRedraw] = useState(false);
  /** Số trận vòng bảng của nội dung đã xếp giờ — bốc lại sẽ mất lịch này. */
  const [scheduled, setScheduled] = useState<number | null>(null);
  const openRedraw = async () => {
    setScheduled(null);
    setConfirmRedraw(true);
    try {
      const ms = await api<Match[]>(`/tournaments/${t.id}/matches?categoryId=${cat.id}`);
      setScheduled(ms.filter((m) => m.stage === "group" && m.scheduledAt && ["pending", "scheduled"].includes(m.status)).length);
    } catch { setScheduled(null); }
  };
  if (cat.stage === "setup") {
    return (
      <>
        <Button variant="primary" disabled={busy || entryCount < cat.group_count * 2}
          title={entryCount < cat.group_count * 2 ? `Cần ít nhất ${cat.group_count * 2} đội` : undefined}
          onClick={() => setConfirmDraw(true)}>
          <Shuffle className="w-4 h-4" aria-hidden />Bốc thăm {cat.group_count} bảng
        </Button>
        <Modal open={confirmDraw} onClose={() => setConfirmDraw(false)} title={`Bốc thăm ${cat.code}?`}>
          <p className="text-sm text-slate-600">
            Chia <strong>{entryCount} {cat.is_doubles ? "cặp" : "VĐV"}</strong> vào <strong>{cat.group_count} bảng</strong> ngẫu nhiên (tự tách cùng CLB) và tạo lịch vòng tròn.
            Sau khi bốc, nội dung <strong>không nhận thêm / xoá đội</strong> nữa; vẫn bốc lại được khi chưa có trận nào có điểm.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDraw(false)}>Huỷ</Button>
            <Button variant="primary" disabled={busy}
              onClick={async () => {
                setConfirmDraw(false);
                await act(() => api(`/categories/${cat.id}/draw`, { method: "POST" }), "Đã bốc thăm ngẫu nhiên & tạo lịch vòng tròn");
              }}>
              <Shuffle className="w-4 h-4" aria-hidden />Bốc thăm
            </Button>
          </div>
        </Modal>
      </>
    );
  }
  if (cat.stage !== "groups") return null;
  return (
    <>
      <Button variant="outline" disabled={busy || groupsStarted} onClick={() => void openRedraw()}
        title={groupsStarted ? "Đã có trận được nhập điểm" : "Kết quả mới luôn khác lần trước"}>
        <Shuffle className="w-4 h-4" aria-hidden />Bốc thăm lại
      </Button>
      <Button disabled={busy} onClick={() => act(() => api(`/categories/${cat.id}/knockout`, { method: "POST" }), "Đã tạo nhánh loại trực tiếp")}>
        <GitBranch className="w-4 h-4" aria-hidden />Tạo nhánh loại trực tiếp
      </Button>
      <Modal open={confirmRedraw} onClose={() => setConfirmRedraw(false)} title="Bốc thăm lại?">
        <p className="text-sm text-slate-600">Bảng đấu và lịch vòng bảng hiện tại của <strong>{cat.code}</strong> sẽ bị thay thế. Cách chia mới luôn khác lần trước.</p>
        {scheduled !== null && scheduled > 0 && (
          <p role="alert" className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <strong>{scheduled} trận đã xếp giờ / sân sẽ mất lịch.</strong> Sau khi bốc lại, vào <strong>Xếp lịch sân</strong> để xếp lại vòng bảng.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmRedraw(false)}>Huỷ</Button>
          <Button variant="primary" disabled={busy}
            onClick={async () => {
              await act(() => api<{ sameAsBefore: boolean }>(`/categories/${cat.id}/draw`, { method: "POST" }),
                (r) => (r.sameAsBefore ? "Chỉ có một cách chia bảng — kết quả giữ nguyên" : "Đã bốc thăm lại — cách chia bảng mới khác lần trước"));
              setConfirmRedraw(false);
            }}>
            <Shuffle className="w-4 h-4" aria-hidden />Bốc lại
          </Button>
        </div>
      </Modal>
    </>
  );
}

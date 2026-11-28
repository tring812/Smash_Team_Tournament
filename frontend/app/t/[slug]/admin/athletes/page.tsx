"use client";

import { useMemo, useState, type FormEvent } from "react";
import { IdCard, Pencil, Phone, Search, UserRound, UserX } from "lucide-react";
import { api } from "../../../../lib/api";
import { usePoll } from "../../../../lib/usePoll";
import type { Athlete, AthleteDisqualification } from "../../../../lib/types";
import { Button, Card, CardSkeleton, DqBadge, EmptyState, Field, Modal, Notice, PageHeader, Select } from "../../../../components/ui";
import { useAdmin } from "../AdminContext";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

/**
 * VẬN ĐỘNG VIÊN — hồ sơ theo giải (CHỈ BTC: có MSSV/SĐT/email).
 * Dùng để đối chiếu thông tin, sửa hồ sơ hoặc xử lý truất quyền VĐV.
 */
export default function AthletesPage() {
  const { t, version, busy, act } = useAdmin();
  const list = usePoll((s) => api<Athlete[]>(`/tournaments/${t.id}/athletes`, { signal: s }), [t.id, version], 60_000);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Athlete | null>(null);
  const [disqualifying, setDisqualifying] = useState<Athlete | null>(null);

  const rows = useMemo(() => {
    const k = fold(q.trim());
    const digits = q.replace(/\D/g, "");
    return (list.data ?? []).filter((a) => !k || fold(a.full_name).includes(k) || fold(a.club).includes(k)
      || (a.student_id ?? "").toLowerCase().includes(k) || (digits.length >= 3 && (a.phone ?? "").includes(digits)));
  }, [list.data, q]);
  const missing = (list.data ?? []).filter((a) => !a.student_id && !a.phone).length;
  const homonyms = useMemo(() => {
    const c = new Map<string, number>();
    for (const a of list.data ?? []) c.set(fold(a.full_name), (c.get(fold(a.full_name)) ?? 0) + 1);
    return c;
  }, [list.data]);

  const controls = (a: Athlete) => (
    <div className="flex flex-wrap justify-end gap-1">
      <Button variant="ghost" className="px-3" disabled={busy} onClick={() => setEditing(a)} aria-label={`Sửa hồ sơ ${a.full_name}`}>
        <Pencil className="h-4 w-4" aria-hidden />
      </Button>
      {a.entries.some((entry) => entry.canDisqualify) && (
        <Button variant="outline" className="px-3" disabled={busy} onClick={() => setDisqualifying(a)} aria-label={`Truất quyền ${a.full_name}`}>
          <UserX className="h-4 w-4" aria-hidden />Truất quyền
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Quản lý giải" title="Vận động viên"
        desc="Mỗi người một hồ sơ, nhận diện bằng MSSV (thẻ sinh viên), rồi đến SĐT. Một người đánh nhiều nội dung vẫn là một hồ sơ — hệ thống không gọi họ vào 2 sân cùng lúc." />

      {list.data && missing > 0 && (
        <Notice kind="error">{missing} VĐV chưa có MSSV hoặc SĐT — nếu có người trùng tên, hệ thống không phân biệt được. Bấm biểu tượng bút để bổ sung.</Notice>
      )}

      <Card title={`Danh sách (${list.data?.length ?? 0})`}
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <label htmlFor="ath-q" className="sr-only">Tìm VĐV</label>
            <input id="ath-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, MSSV, SĐT, CLB…" autoComplete="off"
              className="min-h-11 w-full rounded-xl bg-slate-100 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-black/10" />
          </div>
        }>
        {list.error && <Notice kind="error">{list.error}</Notice>}
        {!list.data ? <CardSkeleton rows={4} /> : rows.length === 0 ? (
          <EmptyState icon={<UserRound className="h-10 w-10" />} title={q ? "Không tìm thấy" : "Chưa có VĐV"} desc={q ? undefined : "VĐV được tạo khi nhập danh sách ở Nội dung & VĐV."} />
        ) : (
          <>
            <div className="-mx-5 hidden overflow-x-auto sm:-mx-6 md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Vận động viên: họ tên, MSSV, SĐT, CLB, nội dung</caption>
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 sm:px-6">Họ tên</th>
                    <th scope="col" className="py-3 pr-3">MSSV</th>
                    <th scope="col" className="py-3 pr-3">SĐT</th>
                    <th scope="col" className="py-3 pr-3">CLB</th>
                    <th scope="col" className="py-3 pr-3">Nội dung</th>
                    <th scope="col" className="py-3 pr-5"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="px-5 py-3 font-semibold text-slate-900 sm:px-6">
                        {a.full_name}
                        {(homonyms.get(fold(a.full_name)) ?? 0) > 1 && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">trùng tên</span>}
                      </td>
                      <td className="tabular py-3 pr-3">{a.student_id ?? <span className="text-slate-400">—</span>}</td>
                      <td className="tabular py-3 pr-3">{a.phone ? <a href={`tel:${a.phone}`} className="underline-offset-2 hover:underline">{a.phone}</a> : <span className="text-slate-400">—</span>}</td>
                      <td className="py-3 pr-3 text-slate-600">{a.club || "—"}</td>
                      <td className="py-3 pr-3">
                        <span className="flex flex-wrap gap-1">
                          {a.entries.map((e) => (
                            <span key={e.entryId} title={e.entryName} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                              {e.categoryCode}{e.disqualified && <DqBadge />}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="py-3 pr-5 text-right">{controls(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {rows.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-3 rounded-2xl border border-slate-100 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{a.full_name}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1"><IdCard className="h-3.5 w-3.5" aria-hidden />{a.student_id ?? "—"}</span>
                      <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" aria-hidden />{a.phone ? <a href={`tel:${a.phone}`}>{a.phone}</a> : "—"}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1 text-xs text-slate-500">
                      {a.entries.length ? a.entries.map((e) => <span key={e.entryId}>{e.categoryCode} {e.disqualified && <DqBadge />}</span>) : "Chưa đăng ký nội dung"}
                    </p>
                  </div>
                  {controls(a)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <EditAthlete key={editing?.id ?? "none"} athlete={editing} onClose={() => setEditing(null)}
        onSaved={(name) => act(async () => undefined, `Đã cập nhật hồ sơ ${name}`)} />
      {disqualifying && <DisqualifyAthlete key={disqualifying.id} athlete={disqualifying} onClose={() => setDisqualifying(null)} />}
    </div>
  );
}

function DisqualifyAthlete({ athlete, onClose }: { athlete: Athlete; onClose: () => void }) {
  const { act } = useAdmin();
  const eligible = athlete.entries.filter((entry) => entry.canDisqualify);
  const [scope, setScope] = useState(eligible.length === 1 ? eligible[0]?.categoryId ?? "" : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const affected = eligible.filter((entry) => scope === "tournament" || scope === entry.categoryId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: AthleteDisqualification = scope === "tournament"
      ? { scope, reason: reason.trim() }
      : { scope: "category", categoryId: scope, reason: reason.trim() };
    setError(null);
    setSaving(true);
    try {
      const out = await api<{ entries: { entryId: string }[] }>(`/athletes/${athlete.id}/disqualify`, { method: "POST", body });
      await act(async () => undefined, `Đã truất quyền ${athlete.full_name} ở ${out.entries.length} nội dung`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Truất quyền ${athlete.full_name}`}>
      <form className="space-y-4" onSubmit={submit}>
        {error && <Notice kind="error">{error}</Notice>}
        <Select label="Phạm vi" required value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">— Chọn phạm vi —</option>
          {eligible.map((entry) => <option key={entry.entryId} value={entry.categoryId}>{entry.categoryCode}</option>)}
          <option value="tournament">Toàn giải (các nội dung còn thi đấu)</option>
        </Select>
        {affected.length > 0 && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-semibold">Đội bị ảnh hưởng</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {affected.map((entry) => <li key={entry.entryId}>{entry.categoryCode} · {entry.entryName}</li>)}
            </ul>
          </div>
        )}
        <p className="text-sm text-slate-600">Giữ nguyên kết quả đã chốt. Huỷ các trận vòng bảng chưa chốt; ở loại trực tiếp, đối thủ đủ điều kiện thắng W.O.</p>
        <Field label="Lý do truất quyền" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
          hint="Chỉ lưu trong nhật ký BTC. Không ghi thông tin liên hệ hay mã số sinh viên." />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button type="submit" variant="danger" loading={saving} disabled={!affected.length || reason.trim().length < 3}>Xác nhận truất quyền</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditAthlete({ athlete, onClose, onSaved }: { athlete: Athlete | null; onClose: () => void; onSaved: (name: string) => unknown }) {
  const [f, setF] = useState({
    fullName: athlete?.full_name ?? "", studentId: athlete?.student_id ?? "", phone: athlete?.phone ?? "",
    email: athlete?.email ?? "", club: athlete?.club ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!athlete) return;
    setSaving(true);
    setErr(null);
    try {
      await api(`/athletes/${athlete.id}`, {
        method: "PATCH",
        body: { fullName: f.fullName, studentId: f.studentId || null, phone: f.phone || null, email: f.email || null, club: f.club },
      });
      await onSaved(f.fullName);
      onClose();
    } catch (e2) {
      setErr((e2 as Error).message); // giữ nguyên dữ liệu đã nhập để sửa
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={Boolean(athlete)} onClose={onClose} title="Sửa hồ sơ VĐV">
      {athlete && (
        <form onSubmit={submit} className="space-y-4">
          {err && <Notice kind="error">{err}</Notice>}
          <Field label="Họ tên" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required maxLength={120}
            hint={athlete.entries.length ? `Đổi tên sẽ cập nhật ${athlete.entries.length} đội đã đăng ký.` : undefined} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="MSSV" value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })} maxLength={30} autoComplete="off" inputMode="text" />
            <Field label="SĐT" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} autoComplete="off" />
          </div>
          <Field label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={254} autoComplete="off" />
          <Field label="CLB / Khoa" value={f.club} onChange={(e) => setF({ ...f, club: e.target.value })} maxLength={120} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Huỷ</Button>
            <Button type="submit" variant="primary" loading={saving}>Lưu</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

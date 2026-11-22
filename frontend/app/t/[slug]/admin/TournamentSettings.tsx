"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CalendarClock, Trash2 } from "lucide-react";
import { api, isoToVnLocal, vnLocalToIso } from "../../../lib/api";
import type { Match, Tournament } from "../../../lib/types";
import { Button, Card, Field, Notice } from "../../../components/ui";
import { useAdmin } from "./AdminContext";

/**
 * Sửa thông tin giải: tên, đường dẫn, địa điểm, giờ bắt đầu, số sân, phút/trận.
 * Đổi số sân hoặc phút/trận mà còn trận đã xếp lịch chưa đánh → hỏi có xếp lại lịch không (sang trang Xếp lịch).
 */
export function TournamentInfoCard({ matches }: { matches: Match[] | null }) {
  const { t, busy, act } = useAdmin();
  const router = useRouter();
  const initial = { name: t.name, slug: t.slug, venue: t.venue ?? "", startsAt: isoToVnLocal(t.starts_at), courts: t.courts, slotMinutes: t.slot_minutes };
  const [form, setForm] = useState(initial);
  const [askReschedule, setAskReschedule] = useState<number | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const capacityChanged = form.courts !== t.courts || form.slotMinutes !== t.slot_minutes;
    const ok = await act(() => api<Tournament>(`/tournaments/${t.id}`, {
      method: "PATCH",
      body: { name: form.name, slug: form.slug, venue: form.venue, startsAt: vnLocalToIso(form.startsAt), courts: form.courts, slotMinutes: form.slotMinutes },
    }), "Đã lưu thông tin giải");
    if (!ok) return;
    const waiting = (matches ?? []).filter((m) => ["pending", "scheduled"].includes(m.status) && m.scheduledAt && !m.calledAt).length;
    if (capacityChanged && waiting) setAskReschedule(waiting);
    if (form.slug !== t.slug) router.replace(`/t/${form.slug}/admin`);
  }

  return (
    <Card title="Thông tin giải">
      <form onSubmit={save} className="grid gap-4">
        <Field label="Tên giải" required minLength={3} maxLength={200} value={form.name} onChange={set("name")} />
        <Field label="Đường dẫn (slug)" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={form.slug} onChange={set("slug")}
          hint={form.slug !== t.slug ? "Đổi đường dẫn: link cũ (đã gửi cho VĐV, mã QR…) sẽ không mở được nữa." : "Chữ thường, số và dấu gạch ngang."} />
        <Field label="Địa điểm" maxLength={200} value={form.venue} onChange={set("venue")} />
        <Field label="Bắt đầu (giờ Việt Nam)" type="datetime-local" required value={form.startsAt} onChange={set("startsAt")} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Số sân" type="number" min={1} max={50} required value={form.courts} onChange={set("courts")} />
          <Field label="Phút / trận" type="number" min={5} max={240} required value={form.slotMinutes} onChange={set("slotMinutes")} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !dirty}>Lưu thông tin</Button>
          {dirty && <Button variant="ghost" onClick={() => setForm(initial)}>Huỷ thay đổi</Button>}
        </div>
      </form>
      {askReschedule !== null && (
        <div role="alert" className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="flex items-center gap-2 font-bold"><CalendarClock className="h-4 w-4" aria-hidden />Xếp lại lịch {askReschedule} trận chưa đánh?</p>
          <p className="mt-1">Lịch hiện tại được xếp theo số sân / phút mỗi trận cũ. Trận đã gọi vào sân hoặc đang đánh giữ nguyên.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/t/${form.slug}/admin/schedule`} className="inline-flex min-h-11 items-center rounded-full bg-black px-4 text-sm font-bold text-white">Xếp lại lịch</Link>
            <Button variant="ghost" onClick={() => setAskReschedule(null)}>Để sau</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Vùng nguy hiểm: xoá giải (xoá mềm — khôi phục trong 7 ngày ở trang chủ, mục "Giải đã xoá").
 * Chỉ quản trị viên / người tạo giải; không xoá giải đang diễn ra; phải gõ lại đường dẫn để xác nhận.
 */
export function DangerZone() {
  const { t, busy, act } = useAdmin();
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!t.canDelete) return null;
  const ongoing = t.status === "ongoing";

  async function remove() {
    setError(null);
    try {
      await api(`/tournaments/${t.id}`, { method: "DELETE", body: { confirmSlug: confirm } });
      router.push("/"); // trang chủ có mục "Giải đã xoá" để khôi phục
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section aria-labelledby="danger-h" className="rounded-2xl border-2 border-red-200 bg-white p-5 sm:p-6">
      <h2 id="danger-h" className="flex items-center gap-2 text-lg font-bold text-red-700"><AlertTriangle className="h-5 w-5" aria-hidden />Vùng nguy hiểm</h2>
      <p className="mt-2 text-sm text-slate-600">
        <strong>Xoá giải</strong> cùng toàn bộ nội dung, đội, VĐV đăng ký, trận, biên bản, nhật ký và phân công trọng tài.
        Giải biến khỏi trang công khai ngay; <strong>khôi phục được trong 7 ngày</strong> (trang chủ → mục &quot;Giải đã xoá&quot;), sau đó xoá hẳn.
      </p>
      {ongoing ? (
        <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">Giải đang diễn ra — đổi trạng thái (Đã kết thúc / Nháp…) rồi mới xoá được.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:max-w-md">
          <Field label={`Gõ "${t.slug}" để xác nhận`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
          <Button variant="danger" disabled={busy || confirm !== t.slug} onClick={() => void act(remove, "Đã xoá giải")}>
            <Trash2 className="h-4 w-4" aria-hidden />Xoá giải
          </Button>
          {error && <Notice kind="error">{error}</Notice>}
        </div>
      )}
    </section>
  );
}

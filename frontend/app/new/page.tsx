"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, vnLocalToIso } from "../lib/api";
import type { TournamentSummary } from "../lib/types";
import { Button, Card, Field, Notice, PageHeader } from "../components/ui";

/** Tạo giải mới — chỉ quản trị viên (backend kiểm tra quyền). */
export default function NewTournamentPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", slug: "", venue: "", startsAt: "", courts: 4, slotMinutes: 30 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await api<TournamentSummary>("/tournaments", {
        method: "POST",
        body: { ...form, startsAt: vnLocalToIso(form.startsAt) },
      });
      router.push(`/t/${t.slug}/admin`);
    } catch (err) {
      setError((err as Error).message); // giữ nguyên dữ liệu đã nhập để sửa & gửi lại
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader eyebrow="Quản trị viên" title="Tạo giải mới" desc="Người tạo tự động trở thành Ban tổ chức của giải." />
      <Card title="Thông tin giải">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Tên giải" required minLength={3} maxLength={200} value={form.name} onChange={set("name")} placeholder="Smash Team IV – Mùa giải 2026" />
          <Field label="Đường dẫn (slug)" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={form.slug} onChange={set("slug")}
            placeholder="smash-team-iv" hint="Chữ thường, số và dấu gạch ngang. Ví dụ: smash-team-iv" />
          <Field label="Địa điểm" maxLength={200} value={form.venue} onChange={set("venue")} placeholder="Sân Aurora - TP Thủ Đức" />
          <Field label="Bắt đầu (giờ Việt Nam)" type="datetime-local" required value={form.startsAt} onChange={set("startsAt")} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Số sân" type="number" min={1} max={50} required value={form.courts} onChange={set("courts")} />
            <Field label="Phút / trận" type="number" min={5} max={240} required value={form.slotMinutes} onChange={set("slotMinutes")} />
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Đang tạo…" : "Tạo giải"}</Button>
          {error && <Notice kind="error">{error}</Notice>}
        </form>
      </Card>
    </div>
  );
}

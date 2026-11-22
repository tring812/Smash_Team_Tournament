"use client";

import { useState } from "react";
import { CalendarClock, GitBranch, LayoutGrid } from "lucide-react";
import { api, fmtTime, vnLocalToIso } from "../../../../lib/api";
import { Button, Card, Field, PageHeader } from "../../../../components/ui";
import { useAdmin } from "../AdminContext";

type Stage = "group" | "knockout";
type Form = { startAt: string; courts: string; slotMinutes: string };

export default function SchedulePage() {
  const { t, busy, act } = useAdmin();
  const [form, setForm] = useState<Record<Stage, Form>>({
    group: { startAt: "", courts: "", slotMinutes: "" },
    knockout: { startAt: "", courts: "", slotMinutes: "" },
  });
  const set = (s: Stage, k: keyof Form, v: string) => setForm({ ...form, [s]: { ...form[s], [k]: v } });

  function submit(stage: Stage) {
    const f = form[stage];
    const body: Record<string, unknown> = { stage };
    if (f.startAt) body.startAt = vnLocalToIso(f.startAt);
    if (f.courts) body.courts = Number(f.courts);
    if (f.slotMinutes) body.slotMinutes = Number(f.slotMinutes);
    return act(() => api<{ scheduled: number; endsAt: string; noRest?: number }>(`/tournaments/${t.id}/schedule`, { method: "POST", body }),
      (r) => `Đã xếp ${r.scheduled} trận, dự kiến xong lúc ${fmtTime(r.endsAt)}`
        + (r.noRest ? ` — ${r.noRest} lượt VĐV phải đánh 2 khung giờ liền nhau (không được nghỉ): thêm sân hoặc tăng phút/trận nếu cần` : " — mọi VĐV đều được nghỉ giữa 2 trận"));
  }

  const block = (stage: Stage, title: string, desc: string, Icon: typeof LayoutGrid) => (
    <Card>
      <form className="p-5 sm:p-6" onSubmit={(e) => { e.preventDefault(); void submit(stage); }}>
        <div className="mb-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center shrink-0" aria-hidden><Icon className="w-5 h-5 text-white" /></div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            <p className="text-sm text-slate-500">{desc}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={stage === "knockout" ? "Bắt đầu lúc (bắt buộc)" : "Bắt đầu lúc"} type="datetime-local"
            required={stage === "knockout"} value={form[stage].startAt} onChange={(e) => set(stage, "startAt", e.target.value)}
            hint={stage === "group" ? "Bỏ trống = giờ khai mạc" : "Có thể khác ngày vòng bảng"} />
          <Field label="Số sân" type="number" inputMode="numeric" min={1} max={50} placeholder={String(t.courts)} value={form[stage].courts}
            onChange={(e) => set(stage, "courts", e.target.value)} hint={`Mặc định ${t.courts}`} />
          <Field label="Phút / trận" type="number" inputMode="numeric" min={5} max={240} placeholder={String(t.slot_minutes)} value={form[stage].slotMinutes}
            onChange={(e) => set(stage, "slotMinutes", e.target.value)} hint={`Mặc định ${t.slot_minutes}`} />
        </div>
        <Button type="submit" variant={stage === "knockout" ? "primary" : "black"} disabled={busy} className="mt-5">
          <CalendarClock className="w-4 h-4" aria-hidden />Xếp lịch {stage === "knockout" ? "loại trực tiếp" : "vòng bảng"}
        </Button>
      </form>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Quản lý giải" title="Xếp lịch sân"
        desc="Xếp riêng từng giai đoạn. Không VĐV nào đánh 2 sân cùng lúc, ưu tiên nghỉ 1 lượt; sân đang có trận diễn ra không bị xếp đè." />
      <div className="grid gap-6 lg:grid-cols-2">
        {block("group", "Vòng bảng", "Xếp các trận vòng bảng chưa đánh của mọi nội dung.", LayoutGrid)}
        {block("knockout", "Loại trực tiếp", "Xếp cả nhánh một lần, kể cả trận chưa biết đội: vòng sau bắt đầu sau khi các trận dẫn vào xong + nghỉ 1 lượt.", GitBranch)}
      </div>
    </div>
  );
}

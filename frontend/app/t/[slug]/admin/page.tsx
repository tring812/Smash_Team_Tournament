"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Layers, Radio, Users } from "lucide-react";
import { api, fmtTime } from "../../../lib/api";
import { usePoll } from "../../../lib/usePoll";
import type { Match, TournamentEvent } from "../../../lib/types";
import { Card, PageHeader, Select, StatCard } from "../../../components/ui";
import { ACTION_LABEL, STAGE_LABEL, describeEvent, useAdmin } from "./AdminContext";

export default function AdminOverview() {
  const { slug } = useParams<{ slug: string }>();
  const { t, version, busy, act } = useAdmin();
  const matches = usePoll((s) => api<Match[]>(`/tournaments/${t.id}/matches`, { signal: s }), [t.id, version], 15_000);
  const events = usePoll((s) => api<TournamentEvent[]>(`/tournaments/${t.id}/events`, { signal: s }), [t.id, version], 60_000);

  const real = (matches.data ?? []).filter((m) => m.status !== "bye" && m.status !== "cancelled");
  const done = real.filter((m) => m.status === "finished" || m.status === "walkover").length;
  const live = real.filter((m) => m.status === "live").length;
  const entries = t.categories.reduce((n, c) => n + c.entry_count, 0);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Bảng điều khiển BTC" title="Tổng quan"
        desc={`${fmtTime(t.starts_at)} · ${t.venue || "Chưa có địa điểm"} · ${t.courts} sân · ${t.slot_minutes} phút/trận`} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Layers className="w-6 h-6" />} label="Nội dung thi đấu" value={t.categories.length} tone="slate" />
        <StatCard icon={<Users className="w-6 h-6" />} label="Đội / VĐV đăng ký" value={entries} tone="slate" />
        <StatCard icon={<CheckCircle2 className="w-6 h-6" />} label="Trận đã xong" value={`${done}/${real.length}`} tone="green" />
        <StatCard icon={<Radio className="w-6 h-6" />} label="Đang thi đấu" value={live} tone="red" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Trạng thái giải" className="lg:col-span-2">
          <Select label="Hiển thị với khán giả" value={t.status} disabled={busy}
            onChange={(e) => act(() => api(`/tournaments/${t.id}`, { method: "PATCH", body: { status: e.target.value } }), "Đã cập nhật trạng thái")}>
            <option value="draft">Nháp (chỉ BTC thấy)</option>
            <option value="published">Công bố</option>
            <option value="ongoing">Đang diễn ra</option>
            <option value="completed">Đã kết thúc (khoá nhập điểm)</option>
          </Select>
          <ul className="mt-5 divide-y divide-slate-100">
            {t.categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0"><strong className="text-slate-900">{c.code}</strong> <span className="text-slate-500">· {c.name} · {c.entry_count} đội</span></span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${c.stage === "setup" ? "bg-amber-50 text-amber-800" : c.stage === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-slate-900 text-white"}`}>
                  {STAGE_LABEL[c.stage]}
                </span>
              </li>
            ))}
          </ul>
          <Link href={`/t/${slug}/admin/categories`} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary hover:underline">
            Quản lý nội dung & VĐV <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        </Card>

        <Card title="Thao tác gần đây" className="lg:col-span-3"
          actions={<Link href={`/t/${slug}/admin/log`} className="text-sm font-bold text-primary hover:underline">Xem tất cả</Link>}>
          {!events.data?.length ? <p className="text-sm text-slate-500">Chưa có thao tác nào.</p> : (
            <ol className="space-y-3">
              {events.data.slice(0, 6).map((ev) => (
                <li key={ev.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                  <div className="min-w-0">
                    <p><strong className="text-slate-900">{ACTION_LABEL[ev.action]}</strong>{ev.category_code && <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-xs font-bold">{ev.category_code}</span>} <span className="text-slate-600">{describeEvent(ev)}</span></p>
                    <p className="text-xs text-slate-400">{fmtTime(ev.created_at)} · {ev.actor}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

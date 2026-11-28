"use client";

import { ScrollText } from "lucide-react";
import { api, fmtTime } from "../../../../lib/api";
import { usePoll } from "../../../../lib/usePoll";
import type { TournamentEvent } from "../../../../lib/types";
import { Card, CardSkeleton, EmptyState, PageHeader } from "../../../../components/ui";
import { ACTION_LABEL, describeEvent, useAdmin } from "../AdminContext";

const TONE: Partial<Record<TournamentEvent["action"], string>> = {
  disqualify: "bg-red-600 text-white", reinstate: "bg-emerald-50 text-emerald-700", redraw: "bg-amber-50 text-amber-800",
};

export default function LogPage() {
  const { t, version } = useAdmin();
  const events = usePoll((s) => api<TournamentEvent[]>(`/tournaments/${t.id}/events`, { signal: s }), [t.id, version], 60_000);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Quản lý giải" title="Nhật ký thao tác" desc="Mọi lần bốc thăm, truất quyền, sửa đội, xếp lịch và sửa kết quả. Không thể sửa hay xoá nhật ký." />
      <Card>
        {!events.data ? <div className="p-5"><CardSkeleton /></div> : events.data.length === 0 ? (
          <EmptyState icon={<ScrollText className="w-10 h-10" />} title="Chưa có thao tác nào" />
        ) : (
          <ol className="divide-y divide-slate-100">
            {events.data.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-4 text-sm">
                <span className="tabular w-28 shrink-0 text-slate-500">{fmtTime(ev.created_at)}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${TONE[ev.action] ?? "bg-slate-900 text-white"}`}>{ACTION_LABEL[ev.action]}</span>
                {ev.category_code && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold">{ev.category_code}</span>}
                <span className="min-w-0 flex-1 text-slate-700">{describeEvent(ev)}</span>
                <span className="text-slate-400">— {ev.actor}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

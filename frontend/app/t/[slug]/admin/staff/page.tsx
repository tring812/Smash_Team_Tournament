"use client";

import { useState } from "react";
import { Search, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { api } from "../../../../lib/api";
import { usePoll } from "../../../../lib/usePoll";
import type { Staff, Viewer } from "../../../../lib/types";
import { Button, Card, EmptyState, PageHeader } from "../../../../components/ui";
import { useAdmin } from "../AdminContext";

export default function StaffPage() {
  const { t, version, busy, act, setError } = useAdmin();
  const staff = usePoll((s) => api<Staff[]>(`/tournaments/${t.id}/staff`, { signal: s }), [t.id, version], 120_000);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Viewer[] | null>(null);

  const add = (u: Viewer, role: "referee" | "organizer") =>
    act(() => api(`/tournaments/${t.id}/staff/${u.id}`, { method: "PUT", body: { role } }), `Đã thêm ${role === "referee" ? "trọng tài" : "BTC"} ${u.full_name}`);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Quản lý giải" title="Ban tổ chức & trọng tài"
        desc={<>Tìm theo tên hoặc tên đăng nhập. Chưa có tài khoản? Quản trị viên tạo ở <a href="/accounts" className="font-semibold text-primary underline underline-offset-2">Tài khoản</a>.</>} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Tìm & thêm">
          <form className="flex gap-2" role="search"
            onSubmit={async (e) => {
              e.preventDefault();
              try { setFound(await api<Viewer[]>(`/users?q=${encodeURIComponent(q)}`)); } catch (err) { setError((err as Error).message); }
            }}>
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden />
              <label htmlFor="staff-q" className="sr-only">Tìm theo tên</label>
              <input id="staff-q" value={q} onChange={(e) => setQ(e.target.value)} required maxLength={60} placeholder="Tên hoặc tên đăng nhập…" autoComplete="off"
                className="w-full min-h-11 pl-11 pr-4 rounded-xl bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-black/10" />
            </div>
            <Button type="submit">Tìm</Button>
          </form>
          {found && (found.length === 0 ? <p className="mt-4 text-sm text-slate-500">Không tìm thấy ai.</p> : (
            <ul className="mt-4 divide-y divide-slate-100">
              {found.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                  <span className="mr-auto min-w-0">
                    <span className="block font-semibold text-slate-900">{u.full_name}</span>
                    {u.username && <span className="text-xs text-slate-500">@{u.username}</span>}
                  </span>
                  <Button variant="ghost" className="px-3" disabled={busy} onClick={() => add(u, "referee")}><UserPlus className="w-4 h-4" aria-hidden />Trọng tài</Button>
                  <Button variant="ghost" className="px-3" disabled={busy} onClick={() => add(u, "organizer")}><ShieldCheck className="w-4 h-4" aria-hidden />BTC</Button>
                </li>
              ))}
            </ul>
          ))}
        </Card>

        <Card title={`Đội ngũ (${staff.data?.length ?? 0})`}>
          {!staff.data?.length ? <EmptyState icon={<ShieldCheck className="w-10 h-10" />} title="Chưa có ai" /> : (
            <ul className="divide-y divide-slate-100">
              {staff.data.map((s) => (
                <li key={s.user_id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black text-xs font-bold text-white" aria-hidden>
                    {s.full_name.split(" ").slice(-1)[0]?.[0] ?? "?"}
                  </span>
                  <span className="mr-auto min-w-0">
                    <span className="block truncate font-semibold text-slate-900">{s.full_name}</span>
                    <span className={`text-xs font-bold ${s.role === "organizer" ? "text-primary" : "text-slate-500"}`}>{s.role === "organizer" ? "Ban tổ chức" : "Trọng tài"}</span>
                  </span>
                  <Button variant="danger" className="px-3" disabled={busy} aria-label={`Gỡ ${s.full_name}`}
                    onClick={() => act(() => api(`/tournaments/${t.id}/staff/${s.user_id}`, { method: "DELETE" }), `Đã gỡ ${s.full_name}`)}>
                    <UserMinus className="w-4 h-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

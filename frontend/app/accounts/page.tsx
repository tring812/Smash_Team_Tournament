"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { KeyRound, Lock, LockOpen, Pencil, Search, ShieldCheck, UserPlus, Users } from "lucide-react";
import { api, fmtTime, loginUrl } from "../lib/api";
import { tempPassword } from "../lib/password";
import { usePoll } from "../lib/usePoll";
import type { Account, Viewer } from "../lib/types";
import { Button, Card, CardSkeleton, EmptyState, Field, Modal, Notice, PageHeader, Select } from "../components/ui";


type Draft = { id?: string; username: string; hadUsername?: boolean; fullName: string; role: "admin" | "user"; password: string };

/**
 * TÀI KHOẢN — chỉ quản trị viên hệ thống. Không có đăng ký công khai: admin cấp tài khoản cho BTC/trọng tài,
 * đặt lại mật khẩu khi quên, khoá khi cần (không xoá để giữ nhật ký).
 */
export default function AccountsPage() {
  const [viewer, setViewer] = useState<Viewer | null | undefined>(undefined);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    api<{ user: Viewer | null }>("/me", { signal: ctl.signal }).then((r) => setViewer(r.user)).catch(() => setViewer(null));
    return () => ctl.abort();
  }, []);

  const list = usePoll(
    (s) => (viewer?.role === "admin" ? api<Account[]>(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`, { signal: s }) : Promise.resolve([])),
    [viewer?.role, query, version], 120_000,
  );

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: ok });
      setVersion((v) => v + 1);
      return true;
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const d = draft;
    const ok = d.id
      ? await run(() => api(`/admin/users/${d.id}`, { method: "PATCH", body: { fullName: d.fullName, role: d.role, ...(d.password ? { password: d.password } : {}), ...(!d.hadUsername && d.username ? { username: d.username } : {}) } }),
        `Đã cập nhật ${d.fullName}${d.password ? " — mật khẩu mới có hiệu lực, các phiên cũ bị đăng xuất" : ""}`)
      : await run(() => api("/admin/users", { method: "POST", body: { username: d.username, fullName: d.fullName, role: d.role, password: d.password } }),
        `Đã tạo tài khoản @${d.username.toLowerCase()} — gửi mật khẩu cho người dùng qua kênh riêng`);
    if (ok) setDraft(null);
  }

  if (viewer === undefined) return <CardSkeleton rows={4} />;
  if (!viewer) {
    return <EmptyState icon={<Lock className="w-10 h-10" />} title="Cần đăng nhập"
      action={<Link href={loginUrl("/accounts")} className="inline-flex min-h-11 items-center rounded-full bg-black px-5 text-sm font-bold text-white">Đăng nhập</Link>} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Hệ thống" title="Tài khoản"
        desc={viewer.role === "admin" ? "Tạo tài khoản cho Ban tổ chức và trọng tài, đặt lại mật khẩu, khoá tài khoản." : "Đổi mật khẩu của bạn."}
        actions={viewer.role === "admin" && (
          <Button variant="primary" onClick={() => setDraft({ username: "", fullName: "", role: "user", password: tempPassword() })}>
            <UserPlus className="w-4 h-4" aria-hidden />Tạo tài khoản
          </Button>
        )} />

      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <ChangePassword />

      {viewer.role === "admin" && (
        <Card title="Danh sách tài khoản">
          <form role="search" className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <label htmlFor="acc-q" className="sr-only">Tìm tài khoản</label>
              <input id="acc-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} placeholder="Tên hoặc tên đăng nhập…"
                className="min-h-11 w-full rounded-xl bg-slate-100 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-black/10" />
            </div>
            <Button type="submit">Tìm</Button>
          </form>
          {list.error && <Notice kind="error">{list.error}</Notice>}
          {!list.data ? <CardSkeleton /> : list.data.length === 0 ? <EmptyState icon={<Users className="w-10 h-10" />} title="Không có tài khoản nào" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Tài khoản: tên, tên đăng nhập, vai trò, trạng thái, lần đăng nhập cuối</caption>
                <thead className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="py-2 pr-3">Họ tên</th>
                    <th scope="col" className="py-2 pr-3">Tên đăng nhập</th>
                    <th scope="col" className="py-2 pr-3">Vai trò</th>
                    <th scope="col" className="hidden py-2 pr-3 md:table-cell">Đăng nhập cuối</th>
                    <th scope="col" className="py-2 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((u) => (
                    <tr key={u.id} className={`border-t border-slate-100 ${u.disabled_at ? "text-slate-400" : ""}`}>
                      <td className="py-3 pr-3 font-semibold">
                        {u.full_name}{u.id === viewer.id && <span className="ml-2 text-xs font-normal text-slate-500">(bạn)</span>}
                        {u.disabled_at && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">Đã khoá</span>}
                        {!u.has_password && !u.disabled_at && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">Chưa có mật khẩu</span>}
                      </td>
                      <td className="py-3 pr-3 text-slate-600">{u.username ? `@${u.username}` : "—"}</td>
                      <td className="py-3 pr-3">
                        {u.role === "admin"
                          ? <span className="inline-flex items-center gap-1 font-bold text-primary"><ShieldCheck className="h-4 w-4" aria-hidden />Quản trị</span>
                          : <span className="text-slate-600">Người dùng</span>}
                      </td>
                      <td className="hidden py-3 pr-3 text-slate-500 md:table-cell">{u.last_login_at ? fmtTime(u.last_login_at) : "Chưa đăng nhập"}</td>
                      <td className="py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" className="px-3" disabled={busy} aria-label={`Sửa ${u.full_name}`}
                            onClick={() => setDraft({ id: u.id, username: u.username ?? "", hadUsername: Boolean(u.username), fullName: u.full_name, role: u.role, password: "" })}>
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                          {u.id !== viewer.id && (
                            <Button variant={u.disabled_at ? "ghost" : "danger"} className="px-3" disabled={busy}
                              aria-label={u.disabled_at ? `Mở khoá ${u.full_name}` : `Khoá ${u.full_name}`}
                              onClick={() => run(() => api(`/admin/users/${u.id}`, { method: "PATCH", body: { disabled: !u.disabled_at } }),
                                u.disabled_at ? `Đã mở khoá ${u.full_name}` : `Đã khoá ${u.full_name} và đăng xuất mọi phiên`)}>
                              {u.disabled_at ? <LockOpen className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? "Sửa tài khoản" : "Tạo tài khoản"}>
        {draft && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Họ tên" value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} required maxLength={255} />
            {draft.hadUsername ? (
              <p className="text-sm text-slate-600">Tên đăng nhập: <strong>@{draft.username}</strong> (không đổi được)</p>
            ) : (
              <Field label="Tên đăng nhập" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                required minLength={3} maxLength={40} pattern="[A-Za-z0-9._\-]{3,40}" autoCapitalize="none" spellCheck={false} autoComplete="off"
                hint={draft.id ? "Tài khoản này chưa có tên đăng nhập — đặt 1 lần, sau đó không đổi được." : "3–40 ký tự: chữ, số, dấu chấm, gạch dưới, gạch ngang. Không phân biệt hoa thường."} />
            )}
            <Select label="Vai trò" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Draft["role"] })}>
              <option value="user">Người dùng — được gán làm BTC / trọng tài từng giải</option>
              <option value="admin">Quản trị viên — tạo giải, quản lý tài khoản, toàn quyền</option>
            </Select>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={draft.id ? "Mật khẩu mới (để trống nếu không đổi)" : "Mật khẩu tạm"} value={draft.password}
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })} required={!draft.id} minLength={8} maxLength={128} autoComplete="new-password" />
              </div>
              <Button variant="ghost" className="px-3" onClick={() => setDraft({ ...draft, password: tempPassword() })} aria-label="Sinh mật khẩu ngẫu nhiên">
                <KeyRound className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <p className="text-xs text-slate-500">Tối thiểu 8 ký tự. Gửi mật khẩu cho người dùng qua kênh riêng và nhắc họ đổi sau lần đăng nhập đầu.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>Huỷ</Button>
              <Button type="submit" variant="primary" loading={busy}>{draft.id ? "Lưu" : "Tạo tài khoản"}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/** Tự đổi mật khẩu: phiên hiện tại được giữ, mọi phiên khác bị đăng xuất. */
function ChangePassword() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) { setMsg({ kind: "error", text: "Mật khẩu nhập lại không khớp" }); return; }
    setBusy(true);
    setMsg(null);
    try {
      await api("/me/password", { method: "POST", body: { currentPassword: cur, newPassword: next } });
      setMsg({ kind: "ok", text: "Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất." });
      setCur(""); setNext(""); setAgain("");
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Đổi mật khẩu của bạn">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
        {msg && <div className="md:col-span-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
        <Field label="Mật khẩu hiện tại" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" />
        <Field label="Mật khẩu mới" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" hint="Tối thiểu 8 ký tự" />
        <Field label="Nhập lại mật khẩu mới" type="password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} autoComplete="new-password" />
        <div className="md:col-span-3 flex justify-end"><Button type="submit" loading={busy}>Đổi mật khẩu</Button></div>
      </form>
    </Card>
  );
}

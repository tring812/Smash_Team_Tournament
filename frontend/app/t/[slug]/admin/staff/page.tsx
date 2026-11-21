"use client";

import { useState, type FormEvent } from "react";
import {
  Check, ClipboardList, Copy, KeyRound, Lock, LockOpen, Pencil, Search, ShieldCheck, UserMinus, UserPlus,
} from "lucide-react";
import { api, fmtTime } from "../../../../lib/api";
import { usePoll } from "../../../../lib/usePoll";
import { suggestUsername, tempPassword } from "../../../../lib/password";
import type { RefereeAccount, Staff, Viewer } from "../../../../lib/types";
import { Button, Card, CardSkeleton, EmptyState, Field, Modal, PageHeader } from "../../../../components/ui";
import { useAdmin } from "../AdminContext";

type Dialog =
  | { kind: "create"; fullName: string; username: string; usernameTouched: boolean; password: string }
  | { kind: "rename"; ref: RefereeAccount; fullName: string }
  | { kind: "password"; ref: RefereeAccount; password: string }
  | { kind: "remove"; ref: RefereeAccount }
  | { kind: "credentials"; title: string; name: string; username: string; password: string };

const initials = (name: string) => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? (p[p.length - 1]?.[0] ?? "") : "")).toUpperCase();
};

/**
 * BAN TỔ CHỨC & TRỌNG TÀI.
 * - Tài khoản trọng tài: BTC tự tạo / đổi tên / đặt lại mật khẩu / khoá / gỡ — không phải nhờ quản trị viên.
 *   Tài khoản đang làm ở giải của BTC khác thì chỉ gỡ khỏi giải được (server kiểm tra lại, xem refereeService).
 * - Thêm tài khoản có sẵn làm trọng tài / BTC; danh sách BTC.
 */
export default function StaffPage() {
  const { t, version, busy, act, setError } = useAdmin();
  const staff = usePoll((s) => api<Staff[]>(`/tournaments/${t.id}/staff`, { signal: s }), [t.id, version], 120_000);
  const referees = usePoll((s) => api<RefereeAccount[]>(`/tournaments/${t.id}/referees`, { signal: s }), [t.id, version], 120_000);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Viewer[] | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const organizers = (staff.data ?? []).filter((s) => s.role === "organizer");
  const refs = referees.data ?? [];
  const add = (u: Viewer, role: "referee" | "organizer") =>
    act(() => api(`/tournaments/${t.id}/staff/${u.id}`, { method: "PUT", body: { role } }), `Đã thêm ${role === "referee" ? "trọng tài" : "BTC"} ${u.full_name}`);

  const open = (d: Dialog) => { setDialogError(null); setDialog(d); };
  /**
   * Thao tác trong hộp thoại: lỗi hiện NGAY TRONG hộp thoại (thông báo chung của trang bị lớp phủ che);
   * thành công → thông báo chung + tải lại danh sách (qua act), rồi đóng hoặc chuyển sang bước sau.
   */
  async function runInDialog<R>(fn: () => Promise<R>, ok: string, then?: (r: R) => void) {
    setDialogError(null);
    setSaving(true);
    try {
      const r = await fn();
      await act(async () => r, ok);
      if (then) then(r); else setDialog(null);
    } catch (err) {
      setDialogError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dialog) return;
    if (dialog.kind === "create") {
      const body = { fullName: dialog.fullName.trim(), username: dialog.username.trim().toLowerCase(), password: dialog.password };
      await runInDialog(() => api<RefereeAccount>(`/tournaments/${t.id}/referees`, { method: "POST", body }), `Đã tạo tài khoản trọng tài ${body.fullName}`,
        () => setDialog({ kind: "credentials", title: "Đã tạo tài khoản", name: body.fullName, username: body.username, password: body.password }));
    } else if (dialog.kind === "rename") {
      await runInDialog(() => api(`/tournaments/${t.id}/referees/${dialog.ref.id}`, { method: "PATCH", body: { fullName: dialog.fullName.trim() } }),
        `Đã đổi tên thành ${dialog.fullName.trim()}`);
    } else if (dialog.kind === "password") {
      const { ref, password } = dialog;
      await runInDialog(() => api(`/tournaments/${t.id}/referees/${ref.id}`, { method: "PATCH", body: { password } }),
        `Đã đặt lại mật khẩu cho ${ref.full_name} — các thiết bị đang đăng nhập bị đăng xuất`,
        () => setDialog({ kind: "credentials", title: "Mật khẩu mới", name: ref.full_name, username: ref.username ?? "", password }));
    } else if (dialog.kind === "remove") {
      const { ref } = dialog;
      await runInDialog(() => api<{ disabled: boolean }>(`/tournaments/${t.id}/referees/${ref.id}`, { method: "DELETE" }),
        `Đã gỡ ${ref.full_name} khỏi giải`);
    }
  }

  const toggleLock = (r: RefereeAccount) => act(
    () => api(`/tournaments/${t.id}/referees/${r.id}`, { method: "PATCH", body: { disabled: !r.disabled_at } }),
    r.disabled_at ? `Đã mở khoá ${r.full_name}` : `Đã khoá ${r.full_name} — đăng xuất khỏi mọi thiết bị`,
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Quản lý giải" title="Ban tổ chức & trọng tài"
        desc="Tạo tài khoản cho trọng tài ngay tại đây, gửi tên đăng nhập + mật khẩu cho họ. Quên mật khẩu thì đặt lại; hết giải thì khoá hoặc gỡ." />

      <Card title={`Tài khoản trọng tài (${refs.length})`}
        actions={<Button variant="primary" disabled={busy}
          onClick={() => open({ kind: "create", fullName: "", username: "", usernameTouched: false, password: tempPassword() })}>
          <UserPlus className="h-4 w-4" aria-hidden />Tạo tài khoản trọng tài
        </Button>}>
        {!referees.data ? <CardSkeleton rows={2} /> : !refs.length ? (
          <EmptyState icon={<ClipboardList className="h-10 w-10" />} title="Chưa có trọng tài"
            desc="Tạo tài khoản mới, hoặc tìm tài khoản có sẵn ở ô bên dưới và thêm làm trọng tài." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {refs.map((r) => {
              const locked = Boolean(r.disabled_at);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold ${locked ? "bg-slate-200 text-slate-500" : "bg-black text-white"}`}>
                    {initials(r.full_name)}
                  </span>
                  <span className="mr-auto min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`truncate font-semibold ${locked ? "text-slate-500 line-through" : "text-slate-900"}`}>{r.full_name}</span>
                      {locked && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Đã khoá</span>}
                      {!r.has_password && !locked && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">Chưa có mật khẩu</span>}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {r.username ? `@${r.username}` : "chưa có tên đăng nhập"}
                      {" · "}{r.last_login_at ? `đăng nhập ${fmtTime(r.last_login_at)}` : "chưa đăng nhập lần nào"}
                      {r.courts.length > 0 && <> · phụ trách sân {r.courts.join(", ")}</>}
                      {r.matches_assigned > 0 && <> · {r.matches_assigned} trận</>}
                      {r.other_tournaments > 0 && <> · làm ở {r.other_tournaments} giải khác</>}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {r.can_manage ? (
                      <>
                        <Button variant="ghost" className="px-3" disabled={busy} aria-label={`Đổi tên ${r.full_name}`} title="Đổi tên"
                          onClick={() => open({ kind: "rename", ref: r, fullName: r.full_name })}><Pencil className="h-4 w-4" aria-hidden /></Button>
                        <Button variant="ghost" className="px-3" disabled={busy || !r.username} aria-label={`Đặt lại mật khẩu ${r.full_name}`} title="Đặt lại mật khẩu"
                          onClick={() => open({ kind: "password", ref: r, password: tempPassword() })}><KeyRound className="h-4 w-4" aria-hidden /></Button>
                        <Button variant="ghost" className="px-3" disabled={busy} aria-label={`${locked ? "Mở khoá" : "Khoá"} ${r.full_name}`} title={locked ? "Mở khoá" : "Khoá"}
                          onClick={() => void toggleLock(r)}>{locked ? <LockOpen className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}</Button>
                      </>
                    ) : (
                      <span className="self-center text-xs text-slate-500" title="Tài khoản này còn làm ở giải bạn không quản lý — nhờ quản trị viên hệ thống sửa">Chỉ gỡ được</span>
                    )}
                    <Button variant="danger" className="px-3" disabled={busy} aria-label={`Gỡ ${r.full_name} khỏi giải`} title="Gỡ khỏi giải"
                      onClick={() => open({ kind: "remove", ref: r })}><UserMinus className="h-4 w-4" aria-hidden /></Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Thêm tài khoản có sẵn">
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

        <Card title={`Ban tổ chức (${organizers.length})`}>
          {!organizers.length ? <EmptyState icon={<ShieldCheck className="w-10 h-10" />} title="Chưa có ai" /> : (
            <ul className="divide-y divide-slate-100">
              {organizers.map((s) => (
                <li key={s.user_id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-white" aria-hidden>{initials(s.full_name)}</span>
                  <span className="mr-auto min-w-0 truncate font-semibold text-slate-900">{s.full_name}</span>
                  <Button variant="danger" className="px-3" disabled={busy} aria-label={`Gỡ BTC ${s.full_name}`}
                    onClick={() => act(() => api(`/tournaments/${t.id}/staff/${s.user_id}`, { method: "DELETE" }), `Đã gỡ ${s.full_name}`)}>
                    <UserMinus className="w-4 h-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={Boolean(dialog)} onClose={() => setDialog(null)}
        title={!dialog ? "" : dialog.kind === "create" ? "Tạo tài khoản trọng tài" : dialog.kind === "rename" ? "Đổi tên trọng tài"
          : dialog.kind === "password" ? "Đặt lại mật khẩu" : dialog.kind === "remove" ? "Gỡ trọng tài khỏi giải" : dialog.title}>
        {dialog?.kind === "credentials" ? (
          <Credentials name={dialog.name} username={dialog.username} password={dialog.password} onDone={() => setDialog(null)} />
        ) : dialog && (
          <form onSubmit={submit} className="space-y-4">
            {dialogError && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{dialogError}</p>}

            {dialog.kind === "create" && (
              <>
                <Field label="Họ tên" required maxLength={255} autoFocus value={dialog.fullName} autoComplete="off"
                  onChange={(e) => {
                    const fullName = e.target.value;
                    setDialog({ ...dialog, fullName, username: dialog.usernameTouched ? dialog.username : suggestUsername(fullName) });
                  }} />
                <Field label="Tên đăng nhập" required minLength={3} maxLength={40} pattern="[a-z0-9._\-]{3,40}" value={dialog.username}
                  autoComplete="off" autoCapitalize="none" spellCheck={false}
                  hint="3–40 ký tự: chữ thường không dấu, số, . _ - (tự gợi ý từ họ tên)"
                  onChange={(e) => setDialog({ ...dialog, username: e.target.value.toLowerCase(), usernameTouched: true })} />
                <PasswordField value={dialog.password} onChange={(password) => setDialog({ ...dialog, password })} />
              </>
            )}
            {dialog.kind === "rename" && (
              <Field label="Họ tên" required maxLength={255} autoFocus value={dialog.fullName}
                onChange={(e) => setDialog({ ...dialog, fullName: e.target.value })} />
            )}
            {dialog.kind === "password" && (
              <>
                <p className="text-sm text-slate-600">Mật khẩu mới cho <strong>{dialog.ref.full_name}</strong> (@{dialog.ref.username}). Các thiết bị đang đăng nhập bằng tài khoản này sẽ bị đăng xuất.</p>
                <PasswordField value={dialog.password} onChange={(password) => setDialog({ ...dialog, password })} />
              </>
            )}
            {dialog.kind === "remove" && (
              <div className="space-y-2 text-sm text-slate-600">
                <p>Gỡ <strong>{dialog.ref.full_name}</strong> khỏi giải này: bỏ phụ trách sân của họ, không chấm được trận mới. Các trận đã chấm giữ nguyên.</p>
                <p>{dialog.ref.can_manage && dialog.ref.other_tournaments === 0
                  ? "Tài khoản không còn làm ở giải nào khác nên sẽ bị KHOÁ (không xoá — vẫn mở khoá lại được)."
                  : "Tài khoản vẫn giữ nguyên (người này còn làm ở giải khác)."}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>Huỷ</Button>
              <Button type="submit" variant={dialog.kind === "remove" ? "danger" : "primary"} loading={saving}>
                {dialog.kind === "create" ? "Tạo tài khoản" : dialog.kind === "rename" ? "Lưu" : dialog.kind === "password" ? "Đặt mật khẩu" : "Gỡ khỏi giải"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Field label="Mật khẩu" required minLength={8} maxLength={128} value={value} autoComplete="new-password" spellCheck={false}
          className="font-mono" hint="Tối thiểu 8 ký tự. Mặc định sinh ngẫu nhiên — sau khi lưu sẽ hiện để bạn gửi cho trọng tài."
          onChange={(e) => onChange(e.target.value)} />
      </div>
      <Button variant="ghost" className="mb-6 px-3" onClick={() => onChange(tempPassword())} aria-label="Sinh mật khẩu ngẫu nhiên" title="Sinh mật khẩu khác">
        <KeyRound className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

/** Hiện tên đăng nhập + mật khẩu MỘT LẦN để BTC gửi cho trọng tài (server không lưu mật khẩu dạng đọc được). */
function Credentials({ name, username, password, onDone }: { name: string; username: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Tài khoản trọng tài — ${name}\nĐăng nhập: ${typeof window !== "undefined" ? window.location.origin : ""}/login\nTên đăng nhập: ${username}\nMật khẩu: ${password}`;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">Gửi thông tin này cho <strong>{name}</strong>. Mật khẩu chỉ hiện <strong>một lần</strong> — đóng hộp thoại là không xem lại được (quên thì đặt lại).</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl bg-slate-50 p-4">
        <dt className="font-bold text-slate-500">Tên đăng nhập</dt><dd className="font-mono text-slate-900">{username}</dd>
        <dt className="font-bold text-slate-500">Mật khẩu</dt><dd className="break-all font-mono text-slate-900">{password}</dd>
      </dl>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={async () => {
          try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
        }}>
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Đã sao chép" : "Sao chép"}
        </Button>
        <Button variant="primary" onClick={onDone}>Xong</Button>
      </div>
    </div>
  );
}

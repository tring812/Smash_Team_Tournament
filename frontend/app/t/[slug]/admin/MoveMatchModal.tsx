"use client";

import { useState, type FormEvent } from "react";
import { api, vnLocalToIso } from "../../../lib/api";
import type { Match } from "../../../lib/types";
import { Button, Field, Modal, Notice, Select } from "../../../components/ui";
import { matchTitle } from "../../../components/MatchViews";
import { useAdmin } from "./AdminContext";

/** ISO → "YYYY-MM-DDTHH:mm" giờ Việt Nam cho input datetime-local. */
function isoToVnLocal(iso: string | null): string {
  if (!iso) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Dời MỘT trận: đổi sân và/hoặc giờ dự kiến (server chặn trùng sân / trùng VĐV trong cùng khung giờ).
 * Trận đang ở sân (đang đánh / đã gọi) chỉ đổi được sân — "chuyển sân".
 */
export function MoveMatchModal({ match, courts, busyCourts = [], onClose, onDone }: {
  match: Match | null; courts: number;
  /** Sân đang có trận (đang đánh / đã gọi): không chọn được khi chuyển sân. */
  busyCourts?: number[];
  onClose: () => void;
  /** Có thì trang tự cập nhật bằng trận máy chủ trả về (không tải lại cả trang). */
  onDone?: (m: Match) => void;
}) {
  const { busy, act } = useAdmin();
  const onCourt = Boolean(match && (match.status === "live" || match.calledAt));
  // Chuyển sân: chọn sẵn sân trống đầu tiên (sân hiện tại và sân bận bị làm mờ).
  const [court, setCourt] = useState<string>(() => {
    if (!match) return "";
    if (!(match.status === "live" || match.calledAt)) return match.court ? String(match.court) : "";
    const free = Array.from({ length: courts }, (_, i) => i + 1).find((n) => n !== match.court && !busyCourts.includes(n));
    return free ? String(free) : "";
  });
  const [at, setAt] = useState<string>(isoToVnLocal(match?.scheduledAt ?? null));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!match) return;
    const body: { court: number | null; scheduledAt?: string | null } = { court: court ? Number(court) : null };
    if (!onCourt) body.scheduledAt = at ? vnLocalToIso(at) : null;
    // Lỗi (trùng sân / trùng VĐV) hiện NGAY TRONG hộp thoại, giữ nguyên lựa chọn để sửa.
    setSaving(true);
    setErr(null);
    try {
      const moved = await api<Match>(`/matches/${match.id}`, { method: "PATCH", body });
      await act(async () => moved, onCourt ? `Đã chuyển sang sân ${court}` : "Đã dời trận", onDone ? { local: onDone } : undefined);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={Boolean(match)} onClose={onClose} title={onCourt ? "Chuyển sân" : "Dời trận"}>
      {match && (
        <form onSubmit={submit} className="space-y-4">
          {err && <Notice kind="error">{err}</Notice>}
          <div className="rounded-2xl bg-slate-50 p-3 text-sm">
            <p className="text-xs text-slate-500">{matchTitle(match)}</p>
            <p className="font-semibold text-slate-900">{match.a?.name ?? "?"} <span className="text-slate-400">vs</span> {match.b?.name ?? "?"}</p>
          </div>
          <Select label="Sân" value={court} onChange={(e) => setCourt(e.target.value)} required={onCourt}>
            {!onCourt && <option value="">— Chưa chọn sân —</option>}
            {Array.from({ length: courts }, (_, i) => {
              const n = i + 1;
              const current = onCourt && n === match.court;
              const busyHere = onCourt && !current && busyCourts.includes(n);
              return (
                <option key={n} value={n} disabled={current || busyHere}>
                  Sân {n}{current ? " — sân hiện tại" : busyHere ? " — đang có trận" : ""}
                </option>
              );
            })}
          </Select>
          {onCourt ? (
            <p className="text-xs text-slate-500">Trận đang ở sân: chỉ chuyển sân (sân mới phải đang trống), điểm số giữ nguyên.</p>
          ) : (
            <Field label="Giờ dự kiến" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)}
              hint="Bỏ trống = chưa xếp giờ. Không cho trùng sân hoặc trùng VĐV trong cùng khung giờ." />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Huỷ</Button>
            <Button type="submit" variant="primary" loading={busy || saving}>{onCourt ? "Chuyển sân" : "Lưu"}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

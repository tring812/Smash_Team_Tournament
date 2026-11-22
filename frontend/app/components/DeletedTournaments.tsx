"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { api, fmtTime } from "../lib/api";
import type { DeletedTournament } from "../lib/types";
import { Button, Notice } from "./ui";

/**
 * Giải đã xoá còn khôi phục được (7 ngày) — chỉ hiện với quản trị viên / người tạo giải có giải đã xoá.
 * Khách / người khác: API trả rỗng hoặc 401 → không hiện gì.
 */
export function DeletedTournaments({ onRestored }: { onRestored?: () => void }) {
  const [items, setItems] = useState<DeletedTournament[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try { setItems(await api<DeletedTournament[]>("/deleted-tournaments", { signal })); } catch { setItems([]); }
  }, []);
  useEffect(() => {
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải danh sách từ máy chủ (hệ thống ngoài) khi mở trang
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  if (!items.length && !notice) return null;

  async function restore(t: DeletedTournament) {
    setBusy(t.id);
    setNotice(null);
    try {
      await api(`/tournaments/${t.id}/restore`, { method: "POST" });
      setNotice({ kind: "ok", text: `Đã khôi phục "${t.name}".` });
      await load();
      onRestored?.();
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="trash-h" className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 id="trash-h" className="flex items-center gap-2 font-bold text-slate-900"><Trash2 className="h-5 w-5 text-slate-500" aria-hidden />Giải đã xoá</h2>
      <p className="mt-1 text-sm text-slate-500">Khôi phục được trong 7 ngày kể từ lúc xoá; quá hạn máy chủ xoá hẳn.</p>
      {notice && <div className="mt-3"><Notice kind={notice.kind}>{notice.text}</Notice></div>}
      <ul className="mt-3 divide-y divide-slate-100">
        {items.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{t.name} <span className="text-sm font-normal text-slate-500">/{t.slug}</span></p>
              <p className="text-xs text-slate-500">Xoá lúc {fmtTime(t.deleted_at)}{t.deleted_by ? ` bởi ${t.deleted_by}` : ""} · xoá hẳn sau {fmtTime(t.purge_at)}</p>
            </div>
            <Button variant="outline" loading={busy === t.id} disabled={Boolean(busy)} onClick={() => void restore(t)}>
              <RotateCcw className="h-4 w-4" aria-hidden />Khôi phục
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

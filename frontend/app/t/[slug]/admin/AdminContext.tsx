"use client";

import { createContext, useContext } from "react";
import { fmtTime } from "../../../lib/api";
import type { Tournament, TournamentEvent } from "../../../lib/types";

export type ActFn = <R>(fn: () => Promise<R>, ok: string | ((r: R) => string)) => Promise<boolean>;

export interface AdminCtx {
  t: Tournament;
  /** Tăng sau mỗi thao tác thành công → các trang con tải lại dữ liệu. */
  version: number;
  busy: boolean;
  /** Chạy một thao tác ghi, báo kết quả ở đầu trang, tải lại. Trả về true nếu thành công. */
  act: ActFn;
  setError: (text: string) => void;
}

export const AdminContext = createContext<AdminCtx | null>(null);

export function useAdmin(): AdminCtx {
  const v = useContext(AdminContext);
  if (!v) throw new Error("useAdmin phải nằm trong AdminLayout");
  return v;
}

export const STAGE_LABEL: Record<Tournament["categories"][number]["stage"], string> = {
  setup: "Nhận đăng ký", groups: "Vòng bảng", knockout: "Loại trực tiếp", completed: "Đã xong",
};

export const ACTION_LABEL: Record<TournamentEvent["action"], string> = {
  draw: "Bốc thăm", redraw: "Bốc thăm lại", disqualify: "Truất quyền", reinstate: "Huỷ truất quyền",
  swap: "Đổi bảng", edit_entry: "Sửa đội", schedule: "Xếp lịch",
  category_create: "Tạo nội dung", category_update: "Sửa nội dung", category_delete: "Xoá nội dung",
  call_match: "Gọi vào sân", uncall_match: "Rút trận", move_match: "Dời trận", court_referee: "Trọng tài sân", athlete_update: "Sửa hồ sơ VĐV", rules_update: "Luật điểm theo vòng",
  referee_create: "Tạo TK trọng tài", referee_update: "Sửa TK trọng tài", referee_remove: "Gỡ trọng tài",
};

/** Tóm tắt 1 dòng nhật ký để hiển thị. */
export function describeEvent(ev: TournamentEvent): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- details là JSON tự do theo từng action
  const d = ev.details as Record<string, any>;
  switch (ev.action) {
    case "disqualify": return `${d.name} — ${d.reason}${d.cancelledMatches ? ` (huỷ ${d.cancelledMatches} trận)` : ""}${d.walkoverMatchId ? " (đối thủ thắng W.O)" : ""}`;
    case "reinstate": return `${d.name} (khôi phục ${d.restoredMatches} trận)`;
    case "swap": return `${d.a?.name} (${d.a?.from}→${d.a?.to}) ⇄ ${d.b?.name} (${d.b?.from}→${d.b?.to})`;
    case "edit_entry": return `${d.before?.name} → ${d.after?.name}`;
    case "schedule": return `${d.stage === "knockout" ? "Loại trực tiếp" : "Vòng bảng"}: ${d.scheduled} trận, ${d.courts} sân, ${d.slotMinutes} phút/trận, từ ${fmtTime(String(d.startsAt))}`;
    case "category_create": return `${d.code} — ${d.name}`;
    case "category_update": return d.before?.code !== d.after?.code || d.before?.name !== d.after?.name
      ? `${d.before?.code} — ${d.before?.name} → ${d.after?.code} — ${d.after?.name}` : `${d.after?.code}: ${(d.fields as string[] | undefined)?.join(", ") ?? ""}`;
    case "category_delete": return `${d.code} — ${d.name} (${d.entries} đội)`;
    case "call_match": return `Sân ${d.court}${d.fromCourt && d.fromCourt !== d.court ? ` (lịch dự kiến sân ${d.fromCourt})` : ""}`;
    case "uncall_match": return `Rút khỏi sân ${d.court}, về hàng chờ`;
    case "move_match": return `Sân ${d.from?.court ?? "—"} · ${d.from?.at ? fmtTime(String(d.from.at)) : "chưa xếp"} → Sân ${d.to?.court ?? "—"} · ${d.to?.at ? fmtTime(String(d.to.at)) : "chưa xếp"}`;
    case "court_referee": return `Sân ${d.court}: ${d.referee ?? "bỏ trọng tài"}`;
    case "athlete_update": return `${d.before && d.before !== d.name ? `${d.before} → ` : ""}${d.name}: ${(d.fields as string[] | undefined)?.map((f) => ({ fullName: "họ tên", studentId: "MSSV", phone: "SĐT", email: "email", club: "CLB" } as Record<string, string>)[f] ?? f).join(", ") ?? ""}`;
    case "rules_update": {
      const a = (d.after ?? {}) as { group?: unknown; knockout?: Record<string, unknown> };
      const parts = [a.group ? "vòng bảng" : null, ...Object.keys(a.knockout ?? {}).map((k) => (k === "*" ? "mọi vòng loại" : k === "1" ? "chung kết" : k === "2" ? "bán kết" : k === "3" ? "tứ kết" : `vòng 1/${2 ** (Number(k) - 1)}`))].filter(Boolean);
      return `${d.code}: ${parts.length ? `luật riêng cho ${parts.join(", ")}` : "bỏ mọi luật riêng (dùng mặc định)"}`;
    }
    case "referee_create": return `${d.name} (@${d.username})`;
    case "referee_update": return `${d.name}: ${(d.fields as string[] | undefined)?.map((f) => ({ fullName: "đổi tên", password: "đặt lại mật khẩu", disabled: d.disabled ? "khoá" : "mở khoá" } as Record<string, string>)[f] ?? f).join(", ") ?? ""}`;
    case "referee_remove": return `${d.name}${d.disabled ? " (đã khoá tài khoản)" : ""}`;
    case "draw": case "redraw": return `${(d.groups as unknown[] | undefined)?.length ?? 0} bảng${d.manual ? " (chia theo file)" : ""}${d.sameAsBefore ? " (chỉ có 1 cách chia)" : ""}`;
    default: return "";
  }
}

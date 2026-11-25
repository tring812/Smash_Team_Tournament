"use client";

import Link from "next/link";
import type { Staff } from "../../../lib/types";

/**
 * Các lựa chọn trong ô "Trọng tài" (trận / sân): gom theo vai trò để BTC thấy ngay ai là trọng tài của giải.
 * Chỉ người đã là trọng tài / BTC CỦA GIẢI mới được phân công (máy chủ kiểm lại) — tài khoản mới tạo ở trang
 * Tài khoản phải được thêm vào giải trước (chọn giải khi tạo, hoặc ở Ban tổ chức & trọng tài).
 */
export function RefereeOptions({ staff }: { staff: Staff[] }) {
  const refs = staff.filter((s) => s.role === "referee");
  const orgs = staff.filter((s) => s.role === "organizer");
  return (
    <>
      {refs.length > 0 && (
        <optgroup label="Trọng tài">
          {refs.map((r) => <option key={r.user_id} value={r.user_id}>{r.full_name}</option>)}
        </optgroup>
      )}
      {orgs.length > 0 && (
        <optgroup label="Ban tổ chức">
          {orgs.map((r) => <option key={r.user_id} value={r.user_id}>{r.full_name}</option>)}
        </optgroup>
      )}
    </>
  );
}

/** Nhắc khi giải chưa có trọng tài nào: tài khoản tạo ở trang Tài khoản chưa tự thuộc giải. */
export function NoRefereeHint({ staff, slug }: { staff: Staff[] | null; slug: string }) {
  if (!staff || staff.some((s) => s.role === "referee")) return null;
  return (
    <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Giải chưa có trọng tài nào nên ô phân công chỉ có Ban tổ chức. Tài khoản tạo ở trang Tài khoản cần được thêm vào giải:{" "}
      <Link href={`/t/${slug}/admin/staff`} className="font-bold underline">Ban tổ chức &amp; trọng tài</Link>.
    </p>
  );
}

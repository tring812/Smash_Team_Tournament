"use client";

import Link from "next/link";
import { api, loginUrl } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { Match } from "../lib/types";
import { PageHeader } from "../components/ui";
import { MatchCard } from "../components/MatchViews";

/** Hàng đợi trọng tài: trận được phân công + trận chưa ai nhận trong giải mình làm trọng tài. */
export default function RefereeQueuePage() {
  const q = usePoll((signal) => api<Match[]>("/referee/queue", { signal }), [], 15_000);

  if (q.error) {
    return (
      <div className="py-10 text-center">
        <p role="alert" className="text-live">{q.error}</p>
        <Link href={loginUrl("/ref")} className="mt-4 inline-block min-h-11 content-center rounded-full bg-primary px-5 font-semibold text-on-primary">
          Đăng nhập
        </Link>
      </div>
    );
  }
  return (
    <>
      <div className="mb-6"><PageHeader eyebrow="Trọng tài" title="Bàn trọng tài" desc="Chọn trận để nhập điểm. Trận đang đánh hiện lên đầu." /></div>
      {!q.data ? <p className="text-muted">Đang tải…</p> : q.data.length === 0 ? (
        <p className="text-muted">Chưa có trận nào dành cho bạn. Nhờ BTC thêm bạn làm trọng tài của giải.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {q.data.map((m) => (
            <li key={m.id}>
              <Link href={`/ref/${m.id}`} className="block rounded-2xl outline-offset-4 hover:opacity-90" aria-label={`Nhập điểm: ${m.a?.name} gặp ${m.b?.name}`}>
                <MatchCard m={m} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

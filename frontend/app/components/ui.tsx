"use client";

import { memo, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { X } from "lucide-react";

/* Bộ UI Red Line dùng chung: thẻ viền mảnh, nút góc gọn, tiêu đề thể thao. */

export function Card({ children, className = "", title, actions, id }: {
  children: ReactNode; className?: string; title?: string; actions?: ReactNode; id?: string;
}) {
  return (
    <section id={id} className={`redline-card bg-white rounded-xl border border-slate-200 shadow-sm ${title ? "p-5 sm:p-6" : ""} ${className}`}>
      {title && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="headline text-2xl text-slate-900">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, desc, actions, eyebrow }: { title: string; desc?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="redline-page-header flex flex-wrap items-end justify-between gap-4 py-2">
      <div className="min-w-0">
        {eyebrow && <p className="redline-kicker mb-2 text-primary">{eyebrow}</p>}
        <h1 className="headline break-words text-4xl text-slate-900 sm:text-5xl">{title}</h1>
        {desc && <p className="text-slate-500 mt-1">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type BtnVariant = "black" | "primary" | "ghost" | "danger" | "outline";
const BTN: Record<BtnVariant, string> = {
  black: "bg-black text-white hover:bg-black/85",
  primary: "bg-primary text-white hover:bg-primary-hover",
  ghost: "bg-slate-100 text-slate-700 hover:bg-slate-200",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
  outline: "bg-white text-slate-800 border border-slate-200 hover:border-slate-400",
};

/** Nút thao tác có vùng chạm tối thiểu 44px. */
export function Button({ variant = "black", loading = false, className = "", children, disabled, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  return (
    <button type="button" {...p} disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 px-5 min-h-11 rounded-lg text-sm font-bold transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:pointer-events-none ${BTN[variant]} ${className}`}>
      {loading ? "Đang xử lý..." : children}
    </button>
  );
}

export function StatCard({ icon, label, value, tone = "slate" }: { icon: ReactNode; label: string; value: ReactNode; tone?: "red" | "slate" | "green" | "amber" }) {
  const tones = { red: "bg-red-100 text-red-700", slate: "bg-slate-900 text-white", green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700" };
  return (
    <div className="redline-card bg-white rounded-xl p-5 shadow-sm border border-slate-200 flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${tones[tone]}`} aria-hidden>{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="font-display text-4xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-6">
      {icon && <div className="flex justify-center mb-3 text-slate-300" aria-hidden>{icon}</div>}
      <p className="font-bold text-slate-700">{title}</p>
      {desc && <p className="text-sm text-slate-500 mt-1">{desc}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-14 rounded-2xl bg-slate-100" />)}
    </div>
  );
}

function ModalBase({ open, onClose, title, children, maxWidth = "max-w-md" }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; maxWidth?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  // onClose thường là arrow function mới mỗi lần render (vd `() => setDraft(null)`). Nếu đặt nó vào deps của effect
  // focus bên dưới thì MỖI PHÍM gõ (setState → render lại) sẽ chạy lại effect: trả focus về nút mở rồi focus ô ĐẦU TIÊN
  // → chữ đang gõ ở ô thứ hai "nhảy" sang ô Họ tên, bộ gõ tiếng Việt (Telex/VNI) bị ngắt giữa chừng. Giữ qua ref.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // Chỉ khi VỪA MỞ: đưa focus vào ô nhập đầu tiên (trừ khi một ô autoFocus đã nhận); trả focus về nút mở khi đóng.
    if (!box.current?.contains(document.activeElement)) {
      box.current?.querySelector<HTMLElement>("input, select, textarea, button:not([aria-label='Đóng'])")?.focus();
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title}
        className={`w-full ${maxWidth} bg-white rounded-xl border-t-4 border-primary shadow-2xl p-6 max-h-[90vh] overflow-y-auto animate-fade-up`}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Đóng"
            className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors cursor-pointer">
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export const Modal = memo(ModalBase);

export const textInputClass =
  "w-full min-h-11 px-4 py-2.5 rounded-lg border border-slate-300 bg-slate-50 focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none transition-all text-slate-900";

export function Field({ label, hint, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="font-bold text-slate-600">{label}</span>
      <input {...p} className={textInputClass} />
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Select({ label, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="font-bold text-slate-600">{label}</span>
      <select {...p} className={`${textInputClass} cursor-pointer`}>{children}</select>
    </label>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok"; children: ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"}
      className={`rounded-2xl border px-4 py-3 text-sm font-medium ${kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      {children}
    </p>
  );
}

export function DqBadge({ reason }: { reason?: string | null }) {
  return (
    <span title={reason ?? undefined}
      className="ml-1.5 inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 align-middle text-[11px] font-bold uppercase tracking-wide text-white">
      Bị truất quyền
    </span>
  );
}

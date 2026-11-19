"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "st-theme";

/**
 * Chạy TRƯỚC khi vẽ trang (chèn inline trong <head>) để không loé màn trắng khi người dùng chọn Tối.
 * Giữ thật ngắn; localStorage bị chặn thì im lặng theo hệ thống.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function apply(pref: ThemePref) {
  const el = document.documentElement;
  if (pref === "system") delete el.dataset.theme;
  else el.dataset.theme = pref;
}

/**
 * Chọn giao diện: Hệ thống / Sáng / Tối — mặc định Hệ thống, lưu RIÊNG trên máy này (localStorage),
 * không đồng bộ theo tài khoản (TV nhà thi đấu và điện thoại trọng tài có thể chọn khác nhau).
 */
export function ThemeToggle({ className = "", tone = "auto" }: { className?: string; tone?: "auto" | "onDark" }) {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc lựa chọn đã lưu (hệ thống ngoài) 1 lần
      if (v === "light" || v === "dark") setPref(v);
    } catch { /* bộ nhớ bị chặn → theo hệ thống */ }
  }, []);
  const choose = (p: ThemePref) => {
    setPref(p);
    apply(p);
    try { if (p === "system") window.localStorage.removeItem(KEY); else window.localStorage.setItem(KEY, p); } catch { /* bỏ qua */ }
  };
  const opts: { id: ThemePref; label: string; Icon: typeof Sun }[] = [
    { id: "system", label: "Theo hệ thống", Icon: Monitor }, { id: "light", label: "Sáng", Icon: Sun }, { id: "dark", label: "Tối", Icon: Moon },
  ];
  const base = tone === "onDark" ? "bg-white/10" : "bg-slate-100";
  return (
    <div role="radiogroup" aria-label="Giao diện" className={`inline-flex gap-1 rounded-full p-1 ${base} ${className}`}>
      {opts.map(({ id, label, Icon }) => {
        const on = pref === id;
        const cls = tone === "onDark"
          ? on ? "bg-white text-black" : "text-slate-300 hover:text-white"
          : on ? "bg-black text-white" : "text-slate-600 hover:text-black";
        return (
          <button key={id} type="button" role="radio" aria-checked={on} aria-label={label} title={label} onClick={() => choose(id)}
            className={`grid h-11 w-11 place-items-center rounded-full transition-colors cursor-pointer ${cls}`}>
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

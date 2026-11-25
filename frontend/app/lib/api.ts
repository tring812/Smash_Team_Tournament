/**
 * Client gọi API cùng origin (Next rewrites /api → backend). Cookie phiên httpOnly tự gửi kèm;
 * không có token nào nằm trong JS/localStorage.
 */
import { createSharedRead } from "./sharedRead";

const sharedReads = createSharedRead();

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET") {
    // Không gộp request phía máy chủ: dữ liệu của hai phiên không được chia sẻ qua bộ nhớ server.
    if (typeof window === "undefined" || init.body !== undefined) return request<T>(path, init);
    return sharedReads.read(path, (signal) => request<T>(path, { ...init, signal }), init.signal);
  }
  // Không dùng lại GET đã bắt đầu trước hoặc trong thao tác ghi/đổi phiên đăng nhập.
  sharedReads.clear();
  try { return await request<T>(path, init); }
  finally { sharedReads.clear(); }
}

async function request<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      // Header tuỳ biến bắt buộc cho request ghi (chống CSRF, khớp csrfGuard ở backend).
      "X-Requested-With": "fetch",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const issues = Array.isArray(data.issues)
      ? ` (${(data.issues as { path: string; message: string }[]).map((i) => `${i.path}: ${i.message}`).join("; ")})`
      : "";
    throw new ApiError(res.status, String(data.code ?? "ERROR"), `${String(data.title ?? "Có lỗi xảy ra")}${issues}`, data);
  }
  return data as T;
}

/** Trang đăng nhập, quay lại `next` sau khi đăng nhập. */
export function loginUrl(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}

/** Chỉ chấp nhận đường dẫn nội bộ (chống open redirect: chặn "//evil", "/\evil", URL tuyệt đối). */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

const dtf = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
});
export const fmtTime = (iso: string | null) => (iso ? dtf.format(new Date(iso)) : "Chưa xếp");

/** ISO → "2026-12-05T08:00" theo giờ Việt Nam (giá trị cho input datetime-local). */
export function isoToVnLocal(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "2026-12-05T08:00" (input datetime-local, giờ VN) → ISO có offset +07:00. */
export function vnLocalToIso(local: string): string {
  return `${local.length === 16 ? `${local}:00` : local}+07:00`;
}

/** Sinh mật khẩu tạm dễ đọc, dễ đọc qua điện thoại (bỏ ký tự dễ nhầm 0/O, 1/l/I). CSPRNG của trình duyệt. */
export function tempPassword(length = 12): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(buf, (n) => abc[n % abc.length]).join("");
}

/** "Nguyễn Văn Lan" → "lan.nguyen" (gợi ý tên đăng nhập; người dùng sửa được). */
export function suggestUsername(fullName: string): string {
  const words = fullName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const last = words[words.length - 1]!;
  const first = words.length > 1 ? words[0]! : "";
  return [last, first].filter(Boolean).join(".").slice(0, 40);
}

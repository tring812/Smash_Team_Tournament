/**
 * Nhập / xuất danh sách VĐV — Excel (.xlsx) hoặc CSV (Google Form → Tải xuống .csv), xử lý HOÀN TOÀN trên trình duyệt:
 * file không gửi lên máy chủ, chỉ danh sách đã kiểm tra mới đi qua API thêm đội (server kiểm tra lại).
 *
 * Cột nhận theo NGHĨA, không phân biệt hoa thường / dấu / thứ tự (dòng tiêu đề nằm trong 10 dòng đầu):
 *   Nội dung · Họ tên (VĐV 1) · MSSV · SĐT · Email · Họ tên đồng đội (VĐV 2) · MSSV đồng đội · SĐT đồng đội · CLB · Bảng
 * - Cột của đồng đội: có chữ "đồng đội" / "partner" / "VĐV 2", hoặc kết thúc bằng số 2 ("MSSV 2", "SĐT 2").
 * - "Nội dung": mã (MS) hoặc tên ("Đơn nam", "Đơn nam (MS)"); Google Form chọn nhiều → "Đơn nam, Đôi nam nữ" → mỗi
 *   nội dung một dòng (đồng đội chỉ dùng cho nội dung đôi). Không có cột → tên sheet trùng mã, hoặc nội dung đang chọn.
 * - "Bảng": chia bảng THEO FILE thay vì bốc thăm (chỉ khi file chứa toàn bộ đội của nội dung).
 * Một người = MSSV, nếu không có thì SĐT, nếu không có nữa thì tên (giống server).
 */
import type { Athlete, Category, Entry } from "./types";

export type CellValue = string | number | boolean | Date | null | undefined;
export interface RawSheet { sheet: string; data: CellValue[][] }

export interface Person { name: string; studentId: string | null; phone: string | null; email: string | null }
export interface ImportRow { sheet: string; row: number; code: string; p1: Person; p2: Person | null; club: string; group: string | null }
export interface ImportIssue { sheet: string; row: number; message: string }
export interface ImportPlan {
  /** Theo nội dung: các đội sẽ thêm (chỉ nội dung đang nhận đăng ký). `groups`: chia bảng theo file. */
  byCategory: { category: Category; rows: ImportRow[]; groups: { name: string; rows: number[] }[] | null }[];
  errors: ImportIssue[];
  /** Dòng bỏ qua nhưng không chặn việc nhập (đã đăng ký rồi…). */
  skipped: ImportIssue[];
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const NAME_MAX = 120;
const CLUB_MAX = 120;

/** "Số điện thoại đồng đội" → "sodienthoaidongdoi". */
const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

// ───────── Định danh (khớp backend/src/services/athleteService.js) ─────────
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!d) return null;
  if (d.startsWith("+84")) d = `0${d.slice(3)}`;
  else if (d.startsWith("84") && d.length >= 11) d = `0${d.slice(2)}`;
  else if (!d.startsWith("0") && d.length === 9) d = `0${d}`;
  return /^0\d{9,10}$/.test(d) ? d : null;
}
export function normalizeStudentId(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/[\s.\-_]/g, "").toUpperCase();
  return /^[A-Z0-9]{4,20}$/.test(s) ? s : null;
}
const nameKey = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");

// ───────── Nhận diện cột ─────────
type Base = "name" | "sid" | "phone" | "email" | "code" | "club" | "group";
type Field = "code" | "club" | "group" | "p1" | "p1Sid" | "p1Phone" | "p1Email" | "p2" | "p2Sid" | "p2Phone" | "p2Email";
/** Ưu tiên từ trên xuống: "Tên CLB" là CLB chứ không phải họ tên; "Họ tên" chung chung nhất nên cuối cùng. */
const ALIASES: [Base, string[]][] = [
  ["sid", ["mssv", "masosinhvien", "masv", "masosv", "studentid", "mssinhvien"]],
  ["phone", ["sodienthoai", "dienthoai", "sdt", "sodt", "phone", "didong", "zalo"]],
  ["email", ["email", "gmail", "diachiemail", "mail"]],
  ["club", ["caulacbo", "clb", "club", "donvi", "truong", "khoa", "team"]],
  ["code", ["noidung", "manoidung", "hangmuc", "category", "event"]],
  ["group", ["tenbang", "group"]],
  ["name", ["hovaten", "hoten", "vandongvien", "vdv", "fullname", "player", "nguoichoi", "ten", "name"]],
];
/** Chỉ khớp NGUYÊN Ô (chuỗi quá ngắn / dễ nằm trong từ khác). */
const EXACT: [Base, string[]][] = [["code", ["ma", "code"]], ["club", ["doi"]], ["group", ["bang"]]];
const PARTNER = ["dongdoi", "partner", "vdv2", "nguoi2", "thanhvien2", "player2", "vandongvien2"];
const IGNORE = ["dauthoigian", "timestamp", "thoigian", "stt", "ghichu", "note", "trangthai"];

function classify(header: unknown): Field | null {
  const h = norm(header);
  if (!h || IGNORE.some((x) => h === x || h.startsWith(x))) return null;
  let base: Base | null = null;
  for (const [b, list] of EXACT) if (list.includes(h)) base = b;
  if (!base) for (const [b, list] of ALIASES) if (list.some((a) => h.includes(a))) { base = b; break; }
  if (!base) return null;
  if (base === "code" || base === "club" || base === "group") return base;
  const partner = PARTNER.some((p) => h.includes(p)) || /2$/.test(h);
  const prefix = partner ? "p2" : "p1";
  return base === "name" ? prefix : (`${prefix}${base === "sid" ? "Sid" : base === "phone" ? "Phone" : "Email"}` as Field);
}

type Header = { headerRow: number } & Partial<Record<Field, number>>;
function findHeader(data: CellValue[][]): Header | null {
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const map: Partial<Record<Field, number>> = {};
    (data[r] ?? []).forEach((cell, i) => { const f = classify(cell); if (f && map[f] === undefined) map[f] = i; });
    if (map.p1 !== undefined) return { headerRow: r, ...map };
  }
  return null;
}

const cellText = (v: CellValue) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "")).trim().replace(/\s+/g, " ");

/** "Đơn nam, Đôi nam nữ" / "MS; XD" / "Đơn nam (MS)" → các nội dung. */
function matchCategories(cell: string, categories: Category[]): { found: Category[]; unknown: string[] } {
  const parts = cell.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const found: Category[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    const k = norm(p);
    const code = p.match(/\(([A-Za-z0-9]{1,10})\)/)?.[1]?.toUpperCase();
    const c = categories.find((x) => x.code.toUpperCase() === p.toUpperCase() || (code && x.code.toUpperCase() === code) || norm(x.name) === k)
      ?? categories.find((x) => k.includes(norm(x.name)) && norm(x.name).length >= 4);
    if (c) { if (!found.includes(c)) found.push(c); } else unknown.push(p);
  }
  return { found, unknown };
}

const groupLabel = (v: string) => v.replace(/^\s*bảng\s*/i, "").trim().toUpperCase();

/** Danh tính đã có trong một nội dung (để bỏ qua người đã đăng ký). */
interface Known { sids: Set<string>; phones: Set<string>; names: Set<string> }
function knownFor(entries: Entry[], athletes: Map<string, Athlete>): Known {
  const k: Known = { sids: new Set(), phones: new Set(), names: new Set() };
  for (const e of entries) {
    for (const [aid, nm] of [[e.player1_athlete_id, e.player1_name], [e.player2_athlete_id, e.player2_name]] as const) {
      if (!nm) continue;
      const a = aid ? athletes.get(aid) : undefined;
      if (a?.student_id) k.sids.add(a.student_id);
      if (a?.phone) k.phones.add(a.phone);
      k.names.add(nameKey(nm));
    }
  }
  return k;
}
const isKnown = (k: Known, p: Person) => (p.studentId ? k.sids.has(p.studentId) : false)
  || (p.phone ? k.phones.has(p.phone) : false)
  || (!p.studentId && !p.phone && k.names.has(nameKey(p.name)));
const remember = (k: Known, p: Person) => {
  if (p.studentId) k.sids.add(p.studentId);
  if (p.phone) k.phones.add(p.phone);
  k.names.add(nameKey(p.name));
};

/**
 * Đọc các sheet → kế hoạch nhập đã kiểm tra (thuần, không gọi mạng — test được).
 * @param existing đội đã có theo categoryId  @param athletes hồ sơ VĐV của giải (BTC) để so MSSV/SĐT
 */
export function planImport(sheets: RawSheet[], categories: Category[], fallback: Category | undefined,
  existing: Record<string, Entry[]>, athletes: Athlete[] = []): ImportPlan {
  const errors: ImportIssue[] = [];
  const skipped: ImportIssue[] = [];
  const byCode = new Map(categories.map((c) => [c.code.toUpperCase(), c]));
  const athleteById = new Map(athletes.map((a) => [a.id, a]));
  const buckets = new Map<string, ImportRow[]>();
  const known = new Map<string, Known>();
  const knownOf = (c: Category) => {
    if (!known.has(c.id)) known.set(c.id, knownFor(existing[c.id] ?? [], athleteById));
    return known.get(c.id)!;
  };
  let total = 0;
  let anyHeader = false;
  const locked = new Map<string, { sheet: string; row: number; code: string; n: number }>();

  for (const s of sheets) {
    const h = findHeader(s.data);
    if (!h) continue;
    anyHeader = true;
    const sheetCat = byCode.get(s.sheet.trim().toUpperCase());
    const col = (row: CellValue[], f: Field) => (h[f] === undefined ? "" : cellText(row[h[f]!]));
    for (let r = h.headerRow + 1; r < s.data.length; r++) {
      const row = s.data[r] ?? [];
      const at = { sheet: s.sheet, row: r + 1 };
      const p1Name = col(row, "p1");
      const p2Name = col(row, "p2");
      const catCell = col(row, "code");
      if (!p1Name && !p2Name && !catCell) continue; // dòng trống
      if (++total > MAX_ROWS) { errors.push({ ...at, message: `File quá ${MAX_ROWS} dòng — hãy chia nhỏ` }); break; }

      const person = (name: string, f: "p1" | "p2"): Person | string => {
        const rawSid = col(row, `${f}Sid` as Field);
        const rawPhone = col(row, `${f}Phone` as Field);
        const studentId = rawSid ? normalizeStudentId(rawSid) : null;
        const phone = rawPhone ? normalizePhone(rawPhone) : null;
        if (rawSid && !studentId) return `MSSV "${rawSid}" của ${name} không hợp lệ (4–20 chữ/số)`;
        if (rawPhone && !phone) return `SĐT "${rawPhone}" của ${name} không hợp lệ`;
        if (name.length > NAME_MAX) return `Tên dài quá ${NAME_MAX} ký tự`;
        return { name, studentId, phone, email: col(row, `${f}Email` as Field) || null };
      };

      let cats: Category[];
      if (catCell) {
        const m = matchCategories(catCell, categories);
        if (m.unknown.length) { errors.push({ ...at, message: `Không có nội dung "${m.unknown.join(", ")}" trong giải` }); continue; }
        cats = m.found;
      } else {
        const c = sheetCat ?? fallback;
        if (!c) { errors.push({ ...at, message: "Không xác định được nội dung (thêm cột \"Nội dung\")" }); continue; }
        cats = [c];
      }
      if (!p1Name) { errors.push({ ...at, message: "Thiếu họ tên VĐV" }); continue; }
      const club = col(row, "club");
      if (club.length > CLUB_MAX) { errors.push({ ...at, message: `Tên CLB dài quá ${CLUB_MAX} ký tự` }); continue; }
      const p1 = person(p1Name, "p1");
      if (typeof p1 === "string") { errors.push({ ...at, message: p1 }); continue; }
      const group = col(row, "group") ? groupLabel(col(row, "group")) : null;
      const multi = cats.length > 1;

      for (const cat of cats) {
        if (cat.stage !== "setup") {
          const k = `${s.sheet}|${cat.code}`;
          const cur = locked.get(k);
          if (cur) cur.n++; else locked.set(k, { ...at, code: cat.code, n: 1 });
          continue;
        }
        let p2: Person | null = null;
        if (cat.is_doubles) {
          if (!p2Name) { errors.push({ ...at, message: `${cat.code} là nội dung đôi — thiếu họ tên đồng đội` }); continue; }
          const x = person(p2Name, "p2");
          if (typeof x === "string") { errors.push({ ...at, message: x }); continue; }
          p2 = x;
        } else if (p2Name && !multi) {
          errors.push({ ...at, message: `${cat.code} là nội dung đơn — bỏ trống cột đồng đội` });
          continue;
        }
        const k = knownOf(cat);
        const dup = [p1, p2].find((p) => p && isKnown(k, p));
        if (dup) { skipped.push({ ...at, message: `${cat.code}: ${dup.name}${dup.studentId ? ` (${dup.studentId})` : ""} đã đăng ký — bỏ qua` }); continue; }
        remember(k, p1);
        if (p2) remember(k, p2);
        buckets.set(cat.id, [...(buckets.get(cat.id) ?? []), { ...at, code: cat.code, p1, p2, club, group }]);
      }
    }
  }
  for (const l of locked.values()) {
    errors.push({ sheet: l.sheet, row: l.row, message: `${l.code} đã bốc thăm — không thêm đội được nữa (${l.n} dòng${l.n > 1 ? `, từ dòng ${l.row}` : ""})` });
  }
  if (!anyHeader) errors.push({ sheet: sheets[0]?.sheet ?? "", row: 1, message: "Không tìm thấy dòng tiêu đề có cột họ tên VĐV — hãy dùng file mẫu" });

  // Chia bảng theo file: chỉ khi MỌI dòng của nội dung có cột Bảng và nội dung chưa có đội nào.
  const byCategory = categories.filter((c) => buckets.has(c.id)).map((category) => {
    const rows = buckets.get(category.id)!;
    const withGroup = rows.filter((x) => x.group);
    if (!withGroup.length) return { category, rows, groups: null };
    const first = rows[0]!;
    const fail = (message: string) => { errors.push({ sheet: first.sheet, row: first.row, message: `${category.code}: ${message} — chỉ nhập đội, KHÔNG chia bảng theo file` }); return { category, rows, groups: null }; };
    if ((existing[category.id] ?? []).length) return fail(`đã có ${(existing[category.id] ?? []).length} đội từ trước; chia bảng theo file cần nhập toàn bộ đội trong một lần`);
    if (withGroup.length !== rows.length) return fail(`${rows.length - withGroup.length} dòng thiếu cột Bảng`);
    const map = new Map<string, number[]>();
    rows.forEach((x, i) => map.set(x.group!, [...(map.get(x.group!) ?? []), i]));
    const bad = [...map.entries()].find(([name, idx]) => idx.length < 2 || !/^[\p{L}0-9]{1,4}$/u.test(name));
    if (bad) return fail(bad[1].length < 2 ? `bảng ${bad[0]} chỉ có 1 đội` : `tên bảng "${bad[0]}" không hợp lệ (1–4 chữ/số)`);
    const groups = [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "vi", { numeric: true })).map(([name, idx]) => ({ name, rows: idx }));
    return { category, rows, groups };
  });
  errors.sort((a, b) => (a.sheet === b.sheet ? a.row - b.row : 0));
  return { byCategory, errors, skipped };
}

// ───────── Đọc file ─────────

/** CSV theo RFC 4180 (ngoặc kép, xuống dòng trong ô); tự nhận dấu phân cách , ; hoặc tab. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === "\"") { if (text[i + 1] === "\"") { cell += "\""; i++; } else q = false; } else cell += ch;
    } else if (ch === "\"") q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Đọc .xlsx hoặc .csv (UTF-8) thành các sheet thô. Ném lỗi tiếng Việt dễ hiểu. */
export async function readWorkbook(file: File): Promise<RawSheet[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error("File lớn hơn 5 MB");
  if (/\.csv$/i.test(file.name)) {
    const text = (await file.text()).replace(/^﻿/, "");
    if (text.includes("�")) throw new Error("File CSV không phải UTF-8 (lỗi dấu tiếng Việt). Google Form: Tải xuống .csv; Excel: Lưu thành \"CSV UTF-8\"");
    return [{ sheet: file.name.replace(/\.csv$/i, ""), data: parseCsv(text) }];
  }
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Chỉ nhận .xlsx hoặc .csv. File .xls: mở bằng Excel rồi Lưu thành .xlsx");
  const { default: readXlsxFile } = await import("read-excel-file/universal") /* không dùng Web Worker blob: → hợp CSP */;
  try {
    const sheets = await readXlsxFile(file);
    return sheets.map((s) => ({ sheet: s.sheet, data: s.data as CellValue[][] }));
  } catch {
    throw new Error("Không đọc được file — file hỏng hoặc không phải .xlsx");
  }
}

// ───────── Ghi file ─────────
const HEADER_STYLE = { fontWeight: "bold" as const, color: "#ffffff", backgroundColor: "#0a0a0a" };
const head = (labels: string[]) => labels.map((value) => ({ value, ...HEADER_STYLE }));
const safeFile = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "");
/** Ô kiểu CHUỖI trong .xlsx (không phải CSV) → Excel không chạy "=..." như công thức; giữ nguyên để nhập lại được. */
const txt = (v: string | null | undefined) => v ?? "";
const IMPORT_COLS = ["Nội dung", "VĐV 1", "MSSV 1", "SĐT 1", "VĐV 2", "MSSV 2", "SĐT 2", "CLB", "Bảng"];
const IMPORT_WIDTHS = [{ width: 10 }, { width: 26 }, { width: 12 }, { width: 13 }, { width: 26 }, { width: 12 }, { width: 13 }, { width: 20 }, { width: 7 }];

/** File mẫu: sheet "Danh sách" (ví dụ theo mã nội dung của giải) + sheet "Hướng dẫn". */
export async function downloadTemplate(tournamentName: string, categories: Category[]) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const single = categories.find((c) => !c.is_doubles);
  const double = categories.find((c) => c.is_doubles);
  const examples = [
    single && [single.code, "Nguyễn Văn An", "21520001", "0901234567", "", "", "", "CLB Quận 7", ""],
    single && [single.code, "Trần Minh Khoa", "21520002", "", "", "", "", "", ""],
    double && [double.code, "Lê Thảo Vy", "21521234", "0912345678", "Phạm Đức Anh", "", "0987654321", "Smash Team", ""],
  ].filter(Boolean) as string[][];
  await writeXlsxFile([
    { sheet: "Danh sách", data: [head(IMPORT_COLS), ...examples], columns: IMPORT_WIDTHS, stickyRowsCount: 1 },
    {
      sheet: "Hướng dẫn",
      data: [
        head(["Mã nội dung", "Tên nội dung", "Loại", "Ghi chú"]),
        ...categories.map((c) => [c.code, c.name, c.is_doubles ? "Đôi — điền VĐV 1 và VĐV 2" : "Đơn — chỉ điền VĐV 1", c.stage === "setup" ? "Đang nhận đăng ký" : "Đã bốc thăm — không nhận thêm"]),
        [],
        ["Xoá các dòng ví dụ ở sheet \"Danh sách\" trước khi điền. Mỗi dòng 1 VĐV (đơn) hoặc 1 cặp (đôi)."],
        ["MSSV (thẻ sinh viên) và SĐT để phân biệt người trùng tên và nhận ra một người đánh nhiều nội dung. Nên điền ít nhất một trong hai."],
        ["Cột \"Bảng\" (A, B, …): điền khi đã chia bảng sẵn (lễ bốc thăm). Để trống cả cột nếu muốn hệ thống bốc thăm ngẫu nhiên."],
        ["Có thể nhập thẳng file .csv tải từ Google Form: cột \"Nội dung thi đấu\" chọn nhiều nội dung cũng được."],
      ],
      columns: [{ width: 14 }, { width: 24 }, { width: 30 }, { width: 60 }],
    },
  ]).toFile(`mau-danh-sach-vdv-${safeFile(tournamentName)}.xlsx`);
}

/**
 * Xuất danh sách đội: mỗi nội dung 1 sheet + sheet "Tất cả". Cùng cột với file nhập (nhập lại được);
 * MSSV/SĐT chỉ có khi truyền `athletes` (BTC) — file này chứa dữ liệu cá nhân, đừng chia sẻ công khai.
 */
export async function exportEntries(tournamentName: string, items: { category: Category; entries: Entry[] }[], athletes: Athlete[] = []) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const byId = new Map(athletes.map((a) => [a.id, a]));
  const cols = ["STT", ...IMPORT_COLS, "Trạng thái"];
  const widths = [{ width: 6 }, ...IMPORT_WIDTHS, { width: 34 }];
  const rowsOf = (category: Category, entries: Entry[]) => [...entries]
    .sort((a, b) => (a.group_name ?? "~").localeCompare(b.group_name ?? "~") || a.name.localeCompare(b.name, "vi"))
    .map((e, i) => {
      const a1 = e.player1_athlete_id ? byId.get(e.player1_athlete_id) : undefined;
      const a2 = e.player2_athlete_id ? byId.get(e.player2_athlete_id) : undefined;
      return [i + 1, category.code, txt(e.player1_name), txt(a1?.student_id), txt(a1?.phone),
        txt(e.player2_name), txt(a2?.student_id), txt(a2?.phone), txt(e.club), e.group_name ?? "",
        e.disqualified_at ? `Truất quyền: ${txt(e.dq_reason)}` : "Thi đấu"];
    });
  const sheets = items.map(({ category, entries }) => ({
    // Tên sheet Excel ≤ 31 ký tự, không chứa : \ / ? * [ ]
    sheet: `${category.code} - ${category.name}`.replace(/[:\\/?*[\]]/g, " ").slice(0, 31),
    data: [head(cols), ...rowsOf(category, entries)], columns: widths, stickyRowsCount: 1,
  }));
  if (items.length > 1) {
    let n = 0;
    const all = items.flatMap(({ category, entries }) => rowsOf(category, entries)).map((r) => [++n, ...r.slice(1)]);
    sheets.unshift({ sheet: "Tất cả", data: [head(cols), ...all], columns: widths, stickyRowsCount: 1 });
  }
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const suffix = items.length === 1 && items[0] ? `-${safeFile(items[0].category.code)}` : "";
  await writeXlsxFile(sheets).toFile(`danh-sach-vdv-${safeFile(tournamentName)}${suffix}-${stamp}.xlsx`);
}

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
 * - "Đăng kí bảng đấu" / "Hạng": HẠNG thi đấu (Bảng A = mở rộng, Bảng B = thành viên CLB…), KHÔNG phải chia bảng:
 *   "Đôi nam" + hạng B → nội dung tên "Đôi nam B". Giải không chia hạng → gộp vào "Đôi nam" (có ghi chú).
 * - Google Form rẽ nhánh: nhiều cột "nội dung" (mỗi nhánh một cột) → lấy ô có giá trị; cột MSSV / SĐT không ghi
 *   "partner" nhưng nằm SAU cột họ tên đồng đội → của đồng đội.
 * - Sheet theo nội dung (tên sheet "ĐÔI NAM A" khớp tên nội dung), mỗi dòng 1 người: nội dung đôi ghép 2 dòng cùng
 *   STT "ĐỘI n" (STT là số / trống → ghép 2 dòng liền nhau).
 * Một người = MSSV, nếu không có thì SĐT, nếu không có nữa thì tên (giống server).
 */
import type { Athlete, Category, Entry } from "./types";

export type CellValue = string | number | boolean | Date | null | undefined;
export interface RawSheet { sheet: string; data: CellValue[][] }

export interface Person {
  name: string; studentId: string | null; phone: string | null; email: string | null;
  /** BTC xác nhận: người KHÁC, chỉ trùng tên với hồ sơ đã có → server tạo hồ sơ mới. */
  newAthlete?: boolean;
}
export interface ImportRow { sheet: string; row: number; code: string; p1: Person; p2: Person | null; club: string; group: string | null }
export interface ImportIssue {
  sheet: string; row: number; message: string;
  /** Mã nội dung của dòng lỗi (nếu xác định được) — để thống kê lỗi theo nội dung ở bảng xem trước. */
  codes?: string[];
}
/**
 * VĐV không có MSSV/SĐT mà TRÙNG TÊN với người đã có (trong giải hoặc dòng khác của file) và khác CLB.
 * Chỉ có tên thì không biết chắc là một người hay hai → BTC chọn ở bước xem trước.
 */
export interface NameClash {
  /** Khoá ổn định của ô người này trong file: "sheet|dòng|p1" → dùng làm khoá lựa chọn. */
  key: string;
  sheet: string; row: number; code: string;
  name: string; club: string;
  /** Những người cùng tên đã có (tên + CLB + có MSSV/SĐT hay không). */
  others: string[];
  decision: NameDecision;
}
export type NameDecision = "same" | "new";
export interface ImportPlan {
  /** Theo nội dung: các đội sẽ thêm (chỉ nội dung đang nhận đăng ký). `groups`: chia bảng theo file. */
  byCategory: { category: Category; rows: ImportRow[]; groups: { name: string; rows: number[] }[] | null }[];
  errors: ImportIssue[];
  /** Dòng bỏ qua nhưng không chặn việc nhập (đã đăng ký rồi…). */
  skipped: ImportIssue[];
  /** Lưu ý chung (vd file chia hạng A/B nhưng giải chưa có nội dung theo hạng). */
  notes: string[];
  /** Dòng vẫn nhập nhưng có ô bị bỏ qua (vd email sai định dạng). */
  warnings: ImportIssue[];
  /** Trùng tên khác CLB, không có MSSV/SĐT — BTC chọn "cùng người" / "người khác". */
  nameClashes: NameClash[];
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
type Base = "name" | "sid" | "phone" | "email" | "code" | "club" | "group" | "division";
type Field = "code" | "club" | "group" | "division" | "p1" | "p1Sid" | "p1Phone" | "p1Email" | "p2" | "p2Sid" | "p2Phone" | "p2Email";
/** Ưu tiên từ trên xuống: "Tên CLB" là CLB chứ không phải họ tên; "Họ tên" chung chung nhất nên cuối cùng. */
const ALIASES: [Base, string[]][] = [
  ["sid", ["mssv", "masosinhvien", "masv", "masosv", "studentid", "mssinhvien"]],
  ["phone", ["sodienthoai", "dienthoai", "sdt", "sodt", "phone", "didong", "zalo"]],
  ["email", ["email", "gmail", "diachiemail", "mail"]],
  ["club", ["caulacbo", "clb", "club", "donvi", "truong", "khoa", "team"]],
  ["division", ["dangkibang", "dangkybang", "bangdau", "hangdau", "hangthidau", "trinhdo", "division", "tier"]],
  ["code", ["noidung", "manoidung", "hangmuc", "category", "event"]],
  ["group", ["tenbang", "group"]],
  ["name", ["hovaten", "hoten", "vandongvien", "vdv", "fullname", "player", "nguoichoi", "ten", "name"]],
];
/** Chỉ khớp NGUYÊN Ô (chuỗi quá ngắn / dễ nằm trong từ khác). */
const EXACT: [Base, string[]][] = [["code", ["ma", "code"]], ["club", ["doi"]], ["group", ["bang"]], ["division", ["hang"]]];
const PARTNER = ["dongdoi", "partner", "vdv2", "nguoi2", "thanhvien2", "player2", "vandongvien2"];
const IGNORE = ["dauthoigian", "timestamp", "thoigian", "stt", "sothutu", "ghichu", "note", "trangthai", "chuyenkhoan", "minhchung", "dinhkem"];

function classify(header: unknown): { field: Field; partner: boolean } | null {
  const h = norm(header);
  if (!h || IGNORE.some((x) => h === x || h.startsWith(x))) return null;
  let base: Base | null = null;
  for (const [b, list] of EXACT) if (list.includes(h)) base = b;
  if (!base) for (const [b, list] of ALIASES) if (list.some((a) => h.includes(a))) { base = b; break; }
  if (!base) return null;
  const partner = PARTNER.some((p) => h.includes(p)) || /2$/.test(h);
  if (base === "code" || base === "club" || base === "group" || base === "division") return { field: base, partner };
  const prefix = partner ? "p2" : "p1";
  return { field: base === "name" ? prefix : (`${prefix}${base === "sid" ? "Sid" : base === "phone" ? "Phone" : "Email"}` as Field), partner };
}

type Header = { headerRow: number; codes: number[]; stt?: number } & Partial<Record<Field, number>>;
function findHeader(data: CellValue[][]): Header | null {
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const map: Partial<Record<Field, number>> = {};
    const codes: number[] = [];
    let stt: number | undefined;
    (data[r] ?? []).forEach((cell, i) => {
      if (["stt", "sothutu"].includes(norm(cell)) && stt === undefined) stt = i;
      const c = classify(cell);
      if (!c) return;
      let f = c.field;
      if (f === "code") { codes.push(i); return; }
      if (f === "club" && c.partner) return; // CLB của đồng đội: đội lấy CLB của VĐV 1
      // Form: "Mã số sinh viên" không ghi "partner" nhưng đứng sau "Họ tên partner" → của đồng đội.
      if (/^p1(Sid|Phone|Email)$/.test(f) && map[f] !== undefined && map.p2 !== undefined && map.p2 < i) f = f.replace("p1", "p2") as Field;
      if (map[f] === undefined) map[f] = i;
    });
    if (map.p1 !== undefined) return { headerRow: r, codes, stt, ...map };
  }
  return null;
}

const cellText = (v: CellValue) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "")).trim().replace(/\s+/g, " ");

/** "Đôi nam A" / "ĐÔI NAM - Bảng B" / "Đơn nam (A)" → { base: "Đôi nam", div: "A" }; không có hạng → div null. */
export function splitDivision(text: string): { base: string; div: string | null } {
  const m = text.trim().match(/^(.*?\S)[\s\-–(]+(?:bảng|bang|hạng|hang|nhóm|nhom)?\s*([A-Za-z0-9])\)?$/i);
  return m && m[1]!.trim().length >= 3 ? { base: m[1]!.trim(), div: m[2]!.toUpperCase() } : { base: text.trim(), div: null };
}
/** Ô hạng: "Bảng A" / "Bảng B đợt 1 (Chỉ thành viên CLB)" / "Hạng B" / "B" → "A" / "B". */
export function divisionOf(cell: string): string | null {
  const t = cell.trim();
  const m = t.match(/(?:bảng|bang|hạng|hang|nhóm|nhom)\s*([A-Za-z0-9])(?![A-Za-zÀ-ỹ])/i)?.[1] ?? t.match(/^([A-Za-z0-9])$/)?.[1];
  return m ? m.toUpperCase() : null;
}

const stripParen = (t: string) => t.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
type Match = { cat: Category; merged?: boolean } | { error: string };
/**
 * Một nội dung theo tên / mã, có xét hạng. "Đôi nam" KHÔNG khớp "Đôi nam nữ" (so nguyên tên, chỉ bỏ phần "(…)").
 * Hạng lấy từ cột hạng của dòng, hoặc từ chính tên ("ĐÔI NAM A"). Giải chia hạng → cần đúng hạng;
 * giải không chia hạng → bỏ qua hạng trong file (merged).
 */
function matchOne(text: string, rowDiv: string | null, categories: Category[]): Match | null {
  const code = text.match(/\(([A-Za-z0-9]{1,10})\)/)?.[1]?.toUpperCase();
  const byCode = categories.find((x) => x.code.toUpperCase() === text.trim().toUpperCase() || (code && x.code.toUpperCase() === code));
  if (byCode) return { cat: byCode };
  const plain = stripParen(text);
  const split = (c: Category) => splitDivision(c.name);
  // 1) tên trùng nguyên văn (kể cả hạng trong tên) và đúng hạng của dòng. Dòng có hạng mà nội dung không chia hạng
  //    → để bước 2 xử lý: ưu tiên "Đôi nam A" nếu có, không thì gộp (merged → có ghi chú).
  const exact = categories.find((x) => norm(x.name) === norm(plain) && (!rowDiv || split(x).div === rowDiv));
  if (exact) return { cat: exact };
  // 2) tên = gốc + hạng ("ĐÔI NAM A") hoặc gốc + hạng của dòng
  const own = splitDivision(plain);
  const tries: { base: string; div: string | null }[] = [];
  if (own.div) tries.push(own);
  tries.push({ base: plain, div: rowDiv });
  for (const t of tries) {
    const same = categories.filter((x) => norm(split(x).base) === norm(t.base));
    if (!same.length) continue;
    if (t.div) {
      const hit = same.find((x) => split(x).div === t.div);
      if (hit) return { cat: hit };
      const flat = same.find((x) => !split(x).div);
      if (flat) return { cat: flat, merged: true };
      return { error: `Không có nội dung "${t.base}" hạng ${t.div} (giải có: ${same.map((x) => x.name).join(", ")})` };
    }
    const flat = same.filter((x) => !split(x).div);
    if (flat.length === 1) return { cat: flat[0]! };
    if (same.length === 1) return { cat: same[0]! };
    return { error: `"${plain}" có nhiều hạng (${same.map((x) => x.name).join(", ")}) — thêm cột "Đăng kí bảng đấu" / "Hạng"` };
  }
  return null;
}

/** "Đơn nam, Đôi nam nữ" / "MS; XD" / "Đơn nam (MS)" → các nội dung. */
function matchCategories(cell: string, rowDiv: string | null, categories: Category[]): { found: Category[]; unknown: string[]; merged: boolean } {
  const parts = cell.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const found: Category[] = [];
  const unknown: string[] = [];
  let merged = false;
  for (const p of parts) {
    const m = matchOne(p, rowDiv, categories);
    if (m && "cat" in m) { if (!found.includes(m.cat)) found.push(m.cat); merged ||= Boolean(m.merged); }
    else unknown.push(m ? m.error : `Không có nội dung "${p}" trong giải`);
  }
  return { found, unknown, merged };
}

/** Sheet đặt tên theo nội dung ("ĐÔI NAM A", "MS")? */
export function sheetCategory(sheet: string, categories: Category[]): Category | undefined {
  const m = matchOne(sheet, null, categories);
  return m && "cat" in m ? m.cat : undefined;
}

/**
 * Sheet nên nhập mặc định: nếu file có sheet đặt tên theo nội dung (danh sách BTC đã chốt) thì chỉ lấy các sheet đó,
 * bỏ sheet câu trả lời Google Form gốc (trùng người, còn người chưa đóng lệ phí). Không thì lấy mọi sheet có tiêu đề.
 */
export function defaultSheets(sheets: RawSheet[], categories: Category[]): string[] {
  const usable = sheets.filter((s) => findHeader(s.data));
  const named = usable.filter((s) => sheetCategory(s.sheet, categories));
  return (named.length ? named : usable).map((s) => s.sheet);
}
/** Sheet có dòng tiêu đề (để chọn trong bản xem trước). */
export const usableSheets = (sheets: RawSheet[]) => sheets.filter((s) => findHeader(s.data)).map((s) => s.sheet);
const isUrl = (v: string) => /^https?:\/\//i.test(v);

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
  || (!p.studentId && !p.phone && !p.newAthlete && k.names.has(nameKey(p.name)));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Người đã gặp trong FILE của một nội dung: khoá định danh → tab + dòng đầu tiên có người đó. */
type FileSeen = Map<string, { sheet: string; row: number }>;
/** Khoá để tra (cùng quy tắc `isKnown`): MSSV, SĐT; chỉ dùng tên khi không có cả hai và chưa chọn "người khác". */
const lookupKeys = (p: Person) => [
  p.studentId ? `sid:${p.studentId}` : null,
  p.phone ? `tel:${p.phone}` : null,
  !p.studentId && !p.phone && !p.newAthlete ? `name:${nameKey(p.name)}` : null,
].filter((x): x is string => Boolean(x));
const storeKeys = (p: Person) => [
  p.studentId ? `sid:${p.studentId}` : null,
  p.phone ? `tel:${p.phone}` : null,
  `name:${nameKey(p.name)}`,
].filter((x): x is string => Boolean(x));

/**
 * Đọc các sheet → kế hoạch nhập đã kiểm tra (thuần, không gọi mạng — test được).
 * @param existing đội đã có theo categoryId  @param athletes hồ sơ VĐV của giải (BTC) để so MSSV/SĐT
 * @param decisions lựa chọn của BTC cho các dòng trùng tên (khoá = NameClash.key)
 */
export function planImport(sheets: RawSheet[], categories: Category[], fallback: Category | undefined,
  existing: Record<string, Entry[]>, athletes: Athlete[] = [], decisions: Record<string, NameDecision> = {}): ImportPlan {
  const errors: ImportIssue[] = [];
  const skipped: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const clashes = new Map<string, NameClash>();
  /**
   * Người đã biết trong CẢ GIẢI theo tên (hồ sơ có sẵn + người ở các dòng trước của file) → phát hiện trùng tên.
   * `slot` = ô của dòng đã thêm người đó (để không tự so với chính mình khi một dòng đăng ký nhiều nội dung).
   */
  type Seen = { club: string; label: string; slot: string | null };
  const byName = new Map<string, Seen[]>();
  const seen = (name: string, s: Seen) => byName.set(nameKey(name), [...(byName.get(nameKey(name)) ?? []), s]);
  for (const a of athletes) {
    const ids = [a.student_id ? `MSSV ${a.student_id}` : null, a.phone ? "có SĐT" : null].filter(Boolean).join(", ");
    seen(a.full_name, { club: a.club ?? "", label: `${a.full_name}${a.club ? ` · ${a.club}` : ""}${ids ? ` (${ids})` : ""}`, slot: null });
  }
  /**
   * Người KHÔNG có MSSV/SĐT trùng tên người khác: cùng CLB (hoặc thiếu CLB) → coi là cùng người như trước;
   * khác CLB → mặc định là NGƯỜI KHÁC (newAthlete) nhưng đưa vào danh sách để BTC đổi lại nếu cần.
   */
  const decide = (p: Person, slot: string, at: { sheet: string; row: number }, code: string, club: string) => {
    if (p.studentId || p.phone) return;
    const others = (byName.get(nameKey(p.name)) ?? []).filter((o) => o.slot !== slot);
    if (!others.length) return;
    const clubDiff = Boolean(club) && others.every((o) => o.club && norm(o.club) !== norm(club));
    const choice = decisions[slot] ?? (clubDiff ? "new" : "same");
    if (clubDiff || decisions[slot]) {
      if (!clashes.has(slot)) {
        clashes.set(slot, { key: slot, ...at, code, name: p.name, club, others: [...new Set(others.map((o) => o.label))], decision: choice });
      }
    }
    if (choice === "new") p.newAthlete = true;
  };
  const added = new Set<string>();
  const note = (p: Person, slot: string, club: string) => {
    if (added.has(slot)) return;
    added.add(slot);
    seen(p.name, { club, label: `${p.name}${club ? ` · ${club}` : ""} (dòng ${slot.split("|")[1]} sheet ${slot.split("|")[0]})`, slot });
  };
  const athleteById = new Map(athletes.map((a) => [a.id, a]));
  const buckets = new Map<string, ImportRow[]>();
  const known = new Map<string, Known>();
  /** Đội đã có trên hệ thống theo nội dung (nhập lại file → bỏ qua). */
  const knownOf = (c: Category) => {
    if (!known.has(c.id)) known.set(c.id, knownFor(existing[c.id] ?? [], athleteById));
    return known.get(c.id)!;
  };
  /** Người đã gặp trong file theo nội dung — trùng chỉ xét TRONG CÙNG TAB; khác tab báo lỗi rõ ràng. */
  const inFile = new Map<string, FileSeen>();
  const fileOf = (c: Category) => {
    if (!inFile.has(c.id)) inFile.set(c.id, new Map());
    return inFile.get(c.id)!;
  };
  let total = 0;
  let anyHeader = false;
  const locked = new Map<string, { sheet: string; row: number; code: string; n: number }>();

  const notes = new Set<string>();
  const mergedNote = (c: Category) => notes.add(`File chia hạng (Bảng A / B…) nhưng giải chưa có nội dung theo hạng — các hạng được gộp vào "${c.name}". Muốn tách: tạo nội dung "${c.name} A", "${c.name} B"… rồi nhập lại.`);

  const codesOf = (cs: (Category | undefined)[]) => cs.filter((c): c is Category => Boolean(c)).map((c) => c.code);
  for (const s of sheets) {
    const h = findHeader(s.data);
    if (!h) continue;
    anyHeader = true;
    const sheetCat = sheetCategory(s.sheet, categories);
    if (sheetCat && splitDivision(s.sheet).div && !splitDivision(sheetCat.name).div && norm(sheetCat.name) !== norm(s.sheet)) mergedNote(sheetCat);
    const col = (row: CellValue[], f: Field) => (h[f] === undefined ? "" : cellText(row[h[f]!]));
    /** Form rẽ nhánh có nhiều cột "nội dung": lấy ô đầu tiên có giá trị (bỏ link minh chứng). */
    const codeOf = (row: CellValue[]) => h.codes.map((i) => cellText(row[i])).find((v) => v && !isUrl(v)) ?? "";

    type Rec = { at: { sheet: string; row: number }; p1: CellValue[]; p2: CellValue[] | null; p2Name: string };
    const recs: Rec[] = [];
    // Sheet theo nội dung ĐÔI, mỗi dòng 1 người (không có cột đồng đội) → ghép 2 dòng thành 1 đội.
    const pairRows = h.p2 === undefined && !h.codes.length && Boolean((sheetCat ?? fallback)?.is_doubles);
    if (pairRows) {
      let pending: { row: CellValue[]; at: Rec["at"]; key: string | null } | null = null;
      const lonely = (x: NonNullable<typeof pending>) =>
        errors.push({ ...x.at, codes: codesOf([sheetCat ?? fallback]), message: `${x.key ? `${cellText(x.row[h.stt!])}: ` : ""}${col(x.row, "p1")} chưa có đồng đội — nội dung đôi cần 2 dòng liền nhau (cùng STT "ĐỘI n")` });
      for (let r = h.headerRow + 1; r < s.data.length; r++) {
        const row = s.data[r] ?? [];
        if (!col(row, "p1")) continue;
        const at = { sheet: s.sheet, row: r + 1 };
        const stt = h.stt === undefined ? "" : cellText(row[h.stt]);
        const key = /^(doi|cap|team|nhom)[a-z0-9]+$/.test(norm(stt)) ? norm(stt) : null; // "ĐỘI 1" = "Đôi 1" = "doi1"
        if (pending && pending.key === key) {
          recs.push({ at: pending.at, p1: pending.row, p2: row, p2Name: col(row, "p1") });
          pending = null;
        } else {
          if (pending) lonely(pending);
          pending = { row, at, key };
        }
      }
      if (pending) lonely(pending);
    } else {
      for (let r = h.headerRow + 1; r < s.data.length; r++) {
        const row = s.data[r] ?? [];
        recs.push({ at: { sheet: s.sheet, row: r + 1 }, p1: row, p2: null, p2Name: col(row, "p2") });
      }
    }

    for (const rec of recs) {
      const { at, p1: row } = rec;
      const p1Name = col(row, "p1");
      const p2Name = rec.p2Name;
      const catCell = codeOf(row);
      if (!p1Name && !p2Name && !catCell) continue; // dòng trống
      if (++total > MAX_ROWS) { errors.push({ ...at, message: `File quá ${MAX_ROWS} dòng — hãy chia nhỏ` }); break; }

      const person = (name: string, f: "p1" | "p2"): Person | string => {
        // Dòng ghép (sheet 1 người/dòng): đồng đội nằm ở cột VĐV 1 của dòng sau.
        const [src, pre] = f === "p2" && rec.p2 ? [rec.p2, "p1" as const] : [row, f];
        const rawSid = col(src, `${pre}Sid` as Field);
        const rawPhone = col(src, `${pre}Phone` as Field);
        const studentId = rawSid ? normalizeStudentId(rawSid) : null;
        const phone = rawPhone ? normalizePhone(rawPhone) : null;
        if (rawSid && !studentId) return `MSSV "${rawSid}" của ${name} không hợp lệ (4–20 chữ/số)`;
        if (rawPhone && !phone) return `SĐT "${rawPhone}" của ${name} không hợp lệ`;
        if (name.length > NAME_MAX) return `Tên dài quá ${NAME_MAX} ký tự`;
        // Email chỉ để liên lạc: sai định dạng (vd ô ghi tên người) → bỏ email, vẫn nhập dòng.
        const rawEmail = col(src, `${pre}Email` as Field);
        const email = rawEmail && EMAIL_RE.test(rawEmail) && rawEmail.length <= 254 ? rawEmail.toLowerCase() : null;
        if (rawEmail && !email) warnings.push({ ...at, message: `Email "${rawEmail}" của ${name} không hợp lệ — bỏ qua email, vẫn nhập` });
        return { name, studentId, phone, email };
      };

      const rowDiv = col(row, "division") ? divisionOf(col(row, "division")) : null;
      let cats: Category[];
      if (catCell) {
        const m = matchCategories(catCell, rowDiv, categories);
        if (m.unknown.length) { errors.push({ ...at, message: m.unknown.join("; ") }); continue; }
        cats = m.found;
        if (m.merged) cats.forEach(mergedNote);
      } else {
        const c = sheetCat ?? fallback;
        if (!c) { errors.push({ ...at, message: "Không xác định được nội dung (thêm cột \"Nội dung\")" }); continue; }
        cats = [c];
      }
      const rowCodes = codesOf(cats);
      if (!p1Name) { errors.push({ ...at, codes: rowCodes, message: "Thiếu họ tên VĐV" }); continue; }
      const club = col(row, "club") || (rec.p2 ? col(rec.p2, "club") : "");
      if (club.length > CLUB_MAX) { errors.push({ ...at, codes: rowCodes, message: `Tên CLB dài quá ${CLUB_MAX} ký tự` }); continue; }
      const p1 = person(p1Name, "p1");
      if (typeof p1 === "string") { errors.push({ ...at, codes: rowCodes, message: p1 }); continue; }
      const slot1 = `${s.sheet}|${at.row}|p1`;
      const slot2 = `${s.sheet}|${at.row}|p2`;
      decide(p1, slot1, at, cats[0]?.code ?? "", club);
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
          if (!p2Name) { errors.push({ ...at, codes: [cat.code], message: `${cat.code} là nội dung đôi — thiếu họ tên đồng đội` }); continue; }
          const x = person(p2Name, "p2");
          if (typeof x === "string") { errors.push({ ...at, codes: [cat.code], message: x }); continue; }
          decide(x, slot2, at, cat.code, club);
          p2 = x;
        } else if (p2Name && !multi && !catCell) {
          errors.push({ ...at, codes: [cat.code], message: `${cat.code} là nội dung đơn — bỏ trống cột đồng đội` });
          continue;
        }
        const who = (p: Person) => `${p.name}${p.studentId ? ` (${p.studentId})` : ""}`;
        const dup = [p1, p2].find((p) => p && isKnown(knownOf(cat), p));
        if (dup) { skipped.push({ ...at, codes: [cat.code], message: `${cat.code}: ${who(dup)} đã đăng ký trên hệ thống — bỏ qua` }); continue; }
        const seenIn = fileOf(cat);
        const hit = [p1, p2].flatMap((p) => (p ? lookupKeys(p).map((key) => ({ p, prev: seenIn.get(key) })) : []))
          .find((x) => x.prev);
        if (hit?.prev) {
          if (hit.prev.sheet === s.sheet) {
            skipped.push({ ...at, codes: [cat.code], message: `${cat.code}: ${who(hit.p)} trùng dòng ${hit.prev.row} cùng tab — bỏ qua` });
          } else {
            errors.push({ ...at, codes: [cat.code], message: `${cat.code}: ${who(hit.p)} cũng có ở tab "${hit.prev.sheet}" dòng ${hit.prev.row} — hai tab cùng vào nội dung "${cat.name}" mà mỗi người chỉ đăng ký 1 lần mỗi nội dung. Hai hạng khác nhau → tạo nội dung riêng (vd "${cat.name} A", "${cat.name} B"); cùng một danh sách → bỏ chọn một tab` });
          }
          continue;
        }
        for (const p of [p1, p2]) if (p) for (const key of storeKeys(p)) if (!seenIn.has(key)) seenIn.set(key, at);
        note(p1, slot1, club);
        if (p2) note(p2, slot2, club);
        buckets.set(cat.id, [...(buckets.get(cat.id) ?? []), { ...at, code: cat.code, p1, p2, club, group }]);
      }
    }
  }
  for (const l of locked.values()) {
    errors.push({ sheet: l.sheet, row: l.row, codes: [l.code], message: `${l.code} đã bốc thăm — không thêm đội được nữa (${l.n} dòng${l.n > 1 ? `, từ dòng ${l.row}` : ""})` });
  }
  if (!anyHeader) errors.push({ sheet: sheets[0]?.sheet ?? "", row: 1, message: "Không tìm thấy dòng tiêu đề có cột họ tên VĐV — hãy dùng file mẫu" });

  // Chia bảng theo file: chỉ khi MỌI dòng của nội dung có cột Bảng và nội dung chưa có đội nào.
  const byCategory = categories.filter((c) => buckets.has(c.id)).map((category) => {
    const rows = buckets.get(category.id)!;
    const withGroup = rows.filter((x) => x.group);
    if (!withGroup.length) return { category, rows, groups: null };
    const first = rows[0]!;
    const fail = (message: string) => { errors.push({ sheet: first.sheet, row: first.row, codes: [category.code], message: `${category.code}: ${message} — chỉ nhập đội, KHÔNG chia bảng theo file` }); return { category, rows, groups: null }; };
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
  return { byCategory, errors, skipped, notes: [...notes], warnings, nameClashes: [...clashes.values()] };
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

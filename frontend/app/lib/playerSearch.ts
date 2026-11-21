import type { Category, GroupStanding, Match, PlayerRef } from "./types";

/* ---------- So khớp ---------- */

const strip = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
const lower = (v: string) => v.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
/** Bỏ dấu + chữ thường: "Nguyễn Ân" → "nguyen an". */
export const fold = (v: string) => lower(strip(v));

export interface Matcher {
  /** Mọi từ khoá đều có trong `text`. */
  test: (text: string) => boolean;
}

/**
 * Từ khoá KHÔNG dấu so khớp bỏ dấu ("bang" khớp "Bằng", "Bàng"),
 * từ khoá CÓ dấu so khớp đúng dấu ("bằng" chỉ khớp "Bằng", không khớp "Bàng").
 * `loose` = bỏ dấu mọi từ (dùng làm dự phòng khi gõ sai dấu: "Bão" vẫn tìm được "Bảo").
 */
export function makeMatcher(q: string, loose = false): Matcher | null {
  const words = lower(q).split(" ").filter(Boolean);
  if (!words.length) return null;
  const tests = words.map((w) => (!loose && strip(w) !== w
    ? (raw: string) => raw.includes(w)
    : (_raw: string, folded: string) => folded.includes(fold(w))));
  return {
    test: (text: string) => {
      const raw = lower(text);
      const folded = fold(text);
      return tests.every((t) => t(raw, folded));
    },
  };
}

/** Từ khoá có dấu? (để biết có nên thử lại kiểu bỏ dấu khi không ra kết quả). */
export const hasDiacritics = (q: string) => strip(lower(q)) !== lower(q);

/* ---------- Danh tính VĐV ---------- */

/** Tên từng người trong 1 đội ("A / B" → ["A", "B"]). */
export const playersOf = (entryName: string) => entryName.split(" / ").map((s) => s.trim()).filter(Boolean);

/**
 * Từng VĐV của một đội kèm KHOÁ danh tính: theo hồ sơ VĐV (athleteId — server đã phân biệt bằng MSSV/SĐT) nếu có,
 * nếu không thì theo tên bỏ dấu. Nhờ vậy hai người TRÙNG TÊN khác MSSV là hai thẻ riêng.
 */
export function peopleOf(side: { name: string; players?: PlayerRef[] }): { key: string; name: string }[] {
  if (side.players?.length) {
    return side.players.map((p) => ({ key: p.athleteId ? `a:${p.athleteId}` : `n:${fold(p.name)}`, name: p.name }));
  }
  return playersOf(side.name).map((n) => ({ key: `n:${fold(n)}`, name: n }));
}

/* ---------- Gom kết quả theo từng VĐV ---------- */

export interface Appearance {
  category: Pick<Category, "id" | "code" | "name">;
  group: string | null;
  rank: number | null;
  partner: string | null;
  club: string;
  matches: Match[];
}

export interface Person {
  key: string;
  name: string;
  club: string;
  /** true = không ai khớp theo tên, người này hiện ra vì khớp CLB / trường. */
  viaClub: boolean;
  /** Có người KHÁC trong kết quả trùng y tên → thẻ hiện thêm CLB để phân biệt. */
  sameNameAsOther: boolean;
  appearances: Appearance[];
}

const byTime = (a: Match, b: Match) =>
  (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999") || a.round - b.round || a.position - b.position;

/**
 * Ưu tiên khớp TÊN: nếu có ai khớp tên thì chỉ hiện những người đó.
 * Chỉ khi không ai khớp tên mới hiện người khớp theo CLB / trường (gắn nhãn "khớp CLB").
 */
export function findPeople(
  m: Matcher,
  matches: Match[],
  standings: { category: Category; groups: GroupStanding[] }[],
): Person[] {
  type Cand = { name: string; club: string; byName: boolean; apps: Map<string, Appearance> };
  const people = new Map<string, Cand>();

  const touch = (key: string, name: string, club: string, cat: Appearance["category"], group: string | null, partner: string | null) => {
    const byName = m.test(name);
    if (!byName && !m.test(`${name} ${club}`)) return null;
    let p = people.get(key);
    if (!p) { p = { name, club, byName, apps: new Map() }; people.set(key, p); }
    p.byName ||= byName;
    let app = p.apps.get(cat.id);
    if (!app) { app = { category: cat, group, rank: null, partner, club, matches: [] }; p.apps.set(cat.id, app); }
    if (!app.group && group) app.group = group;
    return app;
  };

  for (const { category, groups } of standings) {
    for (const g of groups) {
      for (const r of g.standings) {
        const team = peopleOf(r);
        for (const pl of team) {
          const app = touch(pl.key, pl.name, r.club, category, g.name, team.find((x) => x.key !== pl.key)?.name ?? null);
          if (app) app.rank = r.rank;
        }
      }
    }
  }

  for (const mt of matches) {
    for (const side of [mt.a, mt.b]) {
      if (!side) continue;
      const team = peopleOf(side);
      for (const pl of team) {
        const app = touch(pl.key, pl.name, side.club, mt.category, mt.stage === "group" ? mt.groupName : null, team.find((x) => x.key !== pl.key)?.name ?? null);
        if (app && !app.matches.some((x) => x.id === mt.id)) app.matches.push(mt);
      }
    }
  }

  const all = [...people.entries()];
  const byName = all.filter(([, p]) => p.byName);
  const chosen = byName.length ? byName : all;
  const nameCount = new Map<string, number>();
  for (const [, p] of chosen) nameCount.set(fold(p.name), (nameCount.get(fold(p.name)) ?? 0) + 1);
  return chosen
    .map(([key, p]) => ({
      key,
      name: p.name,
      club: p.club,
      viaClub: !p.byName,
      sameNameAsOther: (nameCount.get(fold(p.name)) ?? 0) > 1,
      appearances: [...p.apps.values()]
        .map((a) => ({ ...a, matches: [...a.matches].sort(byTime) }))
        .sort((a, b) => a.category.code.localeCompare(b.category.code)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi") || a.club.localeCompare(b.club, "vi"));
}

/** Trận có ít nhất 1 VĐV trong danh sách tìm được. */
export const involves = (people: Person[]) => {
  const keys = new Set(people.map((p) => p.key));
  return (mt: Match) => [mt.a, mt.b].some((s) => s && peopleOf(s).some((pl) => keys.has(pl.key)));
};

/** Trận sắp tới (đang đánh > đã xếp giờ sớm nhất) của 1 VĐV, mọi nội dung. */
export function nextMatch(p: Person): Match | null {
  const open = p.appearances.flatMap((a) => a.matches)
    .filter((m) => m.status === "live" || m.status === "scheduled" || m.status === "pending");
  return open.find((m) => m.status === "live") ?? open.filter((m) => m.scheduledAt).sort(byTime)[0] ?? null;
}

'use strict';
/**
 * Chia bảng & sinh cặp đấu vòng tròn — thuần logic.
 */

/** @typedef {{ id: string, rating: number, seed?: number|null }} DrawEntry */
/** @typedef {{ name: string, entryIds: string[] }} DrawGroup */
/** @typedef {{ round: number, a: string, b: string }} Pairing */

/**
 * Tên bảng: A, B, ..., Z, AA, AB...
 * @param {number} i
 * @returns {string}
 */
function groupName(i) {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Chia bảng kiểu "rắn bò" (serpentine) theo hạt giống/ELO để các bảng cân sức:
 * hàng 1: A B C D, hàng 2: D C B A, ...
 * Hạt giống thủ công (seed) ưu tiên trước, sau đó rating giảm dần, hoà thì theo id (tất định).
 * @param {DrawEntry[]} entries
 * @param {number} groupCount
 * @returns {DrawGroup[]}
 */
function snakeDraw(entries, groupCount) {
  if (!Number.isInteger(groupCount) || groupCount < 1) throw new RangeError('groupCount phải >= 1');
  if (entries.length < groupCount * 2) throw new RangeError('Mỗi bảng cần ít nhất 2 đội');
  const sorted = [...entries].sort((x, y) => {
    const sx = x.seed ?? Number.POSITIVE_INFINITY;
    const sy = y.seed ?? Number.POSITIVE_INFINITY;
    if (sx !== sy) return sx - sy;
    if (y.rating !== x.rating) return y.rating - x.rating;
    return x.id < y.id ? -1 : 1;
  });
  /** @type {DrawGroup[]} */
  const groups = Array.from({ length: groupCount }, (_, i) => ({ name: groupName(i), entryIds: [] }));
  sorted.forEach((e, idx) => {
    const row = Math.floor(idx / groupCount);
    const col = idx % groupCount;
    const g = row % 2 === 0 ? col : groupCount - 1 - col;
    groups[g].entryIds.push(e.id);
  });
  return groups;
}

/** @typedef {(maxExclusive: number) => number} Rng  số nguyên ngẫu nhiên đều trong [0, maxExclusive) */

/** Mặc định: CSPRNG của Node — kết quả không đoán trước được. @type {Rng} */
const cryptoRng = (n) => require('node:crypto').randomInt(n);

/**
 * Fisher–Yates, không đổi mảng gốc.
 * @template T @param {T[]} arr @param {Rng} rng @returns {T[]}
 */
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Chuẩn hoá tên CLB để so trùng ('' = không thuộc CLB nào → không ràng buộc). */
function clubKey(club) {
  return String(club ?? '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Khoá so sánh hai cách chia bảng — chỉ quan tâm AI ở chung bảng với AI (không quan tâm tên bảng).
 * @param {string[][]} groups @returns {string}
 */
function partitionKey(groups) {
  return groups.map((g) => [...g].sort().join(',')).sort().join('|');
}

/**
 * Bốc thăm NGẪU NHIÊN cho giải mở rộng (không dùng ELO/hạt giống).
 * Ràng buộc mềm: tách các đội cùng CLB ra các bảng khác nhau; CLB đông hơn số bảng thì chia đều.
 * Kích thước bảng lệch nhau tối đa 1.
 *
 * Thuật toán: xử lý CLB đông trước (thứ tự CLB bằng nhau xáo ngẫu nhiên), mỗi đội vào bảng còn chỗ
 * có ít đội cùng CLB nhất, hoà thì chọn ngẫu nhiên. Đội không có CLB được xáo và rải vào chỗ trống.
 *
 * @param {{ id: string, club?: string|null }[]} entries
 * @param {number} groupCount
 * @param {{ rng?: Rng, avoid?: string|null, maxAttempts?: number }} [opts]
 *        avoid = partitionKey của lần bốc trước → bốc lại tới khi khác (tối đa maxAttempts lần)
 * @returns {{ groups: DrawGroup[], lots: Map<string, number>, sameAsBefore: boolean }}
 */
function randomDraw(entries, groupCount, opts = {}) {
  const rng = opts.rng ?? cryptoRng;
  const maxAttempts = opts.maxAttempts ?? 50;
  if (!Number.isInteger(groupCount) || groupCount < 1) throw new RangeError('groupCount phải >= 1');
  if (entries.length < groupCount * 2) throw new RangeError('Mỗi bảng cần ít nhất 2 đội');

  const n = entries.length;
  const capacity = Array.from({ length: groupCount }, (_, i) => Math.floor(n / groupCount) + (i < n % groupCount ? 1 : 0));

  const once = () => {
    /** @type {Map<string, string[]>} */
    const byClub = new Map();
    const loose = [];
    for (const e of shuffle(entries, rng)) {
      const k = clubKey(e.club);
      if (!k) loose.push(e.id);
      else byClub.set(k, [...(byClub.get(k) ?? []), e.id]);
    }
    const clubs = shuffle([...byClub.entries()], rng).sort((x, y) => y[1].length - x[1].length);
    /** @type {string[][]} */
    const members = Array.from({ length: groupCount }, () => []);
    for (const [, ids] of clubs) {
      const count = new Array(groupCount).fill(0);
      for (const id of ids) {
        const open = members.map((m, i) => i).filter((i) => members[i].length < capacity[i]);
        const least = Math.min(...open.map((i) => count[i]));
        // Trong các bảng ít đội cùng CLB nhất, ưu tiên bảng còn nhiều chỗ (để chỗ trống cho CLB sau), hoà → ngẫu nhiên.
        const cand = open.filter((i) => count[i] === least);
        const room = Math.max(...cand.map((i) => capacity[i] - members[i].length));
        const best = cand.filter((i) => capacity[i] - members[i].length === room);
        const g = best[rng(best.length)];
        members[g].push(id);
        count[g] += 1;
      }
    }
    const slots = shuffle(members.flatMap((m, i) => Array(capacity[i] - m.length).fill(i)), rng);
    loose.forEach((id, k) => members[slots[k]].push(id));
    return members;
  };

  let members = once();
  let attempts = 1;
  while (opts.avoid && partitionKey(members) === opts.avoid && attempts < maxAttempts) {
    members = once();
    attempts += 1;
  }
  // Bốc thăm phụ: hoán vị ngẫu nhiên 1..n (số nhỏ hơn xếp trên khi mọi chỉ số đều hoà).
  const lots = new Map(shuffle(entries.map((e) => e.id), rng).map((id, i) => [id, i + 1]));
  return {
    groups: members.map((ids, i) => ({ name: groupName(i), entryIds: shuffle(ids, rng) })),
    lots,
    sameAsBefore: Boolean(opts.avoid) && partitionKey(members) === opts.avoid,
  };
}

/**
 * Lịch vòng tròn bằng phương pháp xoay vòng (circle method). Số lẻ thì thêm "bye".
 * Mỗi cặp gặp nhau đúng một lần; mỗi vòng mỗi đội đánh tối đa một trận.
 * @param {string[]} ids
 * @returns {Pairing[]}
 */
function roundRobin(ids) {
  if (ids.length < 2) return [];
  const BYE = null;
  /** @type {(string|null)[]} */
  const list = [...ids];
  if (list.length % 2 === 1) list.push(BYE);
  const n = list.length;
  /** @type {Pairing[]} */
  const out = [];
  let arr = list;
  for (let round = 1; round < n; round += 1) {
    for (let i = 0; i < n / 2; i += 1) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== BYE && b !== BYE) {
        // Đảo bên xen kẽ để đội 1 không luôn ở bên A.
        out.push(round % 2 === 0 && i === 0 ? { round, a: b, b: a } : { round, a, b });
      }
    }
    // Giữ cố định phần tử đầu, xoay phần còn lại.
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return out;
}

module.exports = { groupName, snakeDraw, randomDraw, partitionKey, shuffle, clubKey, roundRobin };

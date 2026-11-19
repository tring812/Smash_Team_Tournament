'use strict';
/**
 * Nhánh loại trực tiếp (single elimination) từ kết quả vòng bảng — thuần logic.
 */

/**
 * Thứ tự vị trí hạt giống chuẩn cho nhánh kích thước `size` (luỹ thừa 2):
 * size 8 → [1,8,4,5,2,7,3,6]. Hạt giống 1 và 2 chỉ gặp nhau ở chung kết.
 * @param {number} size
 * @returns {number[]}
 */
function seedOrder(size) {
  if (size < 1 || (size & (size - 1)) !== 0) throw new RangeError('size phải là luỹ thừa của 2');
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/**
 * Xếp danh sách hạt giống từ vòng bảng: nhất các bảng trước, rồi nhì (xoay vòng nửa số bảng
 * để nhì bảng A không gặp nhất bảng A ở vòng đầu và rơi vào nửa nhánh đối diện), rồi ba...
 * @param {string[][]} groupRankings  mỗi phần tử: danh sách entryId đã xếp hạng của 1 bảng
 * @param {number} advancePerGroup
 * @returns {string[]}  entryId theo thứ tự hạt giống 1..N
 */
function seedsFromGroups(groupRankings, advancePerGroup) {
  const g = groupRankings.length;
  /** @type {string[]} */
  const seeds = [];
  for (let place = 0; place < advancePerGroup; place += 1) {
    const shift = place % 2 === 1 ? Math.floor(g / 2) : 0;
    const tier = [];
    for (let k = 0; k < g; k += 1) {
      const grp = groupRankings[(k + shift) % g];
      if (grp[place] !== undefined) tier.push(grp[place]);
    }
    // Hạng nhì xếp ngược để seed thấp nhất (N) gặp seed 1 nhưng khác bảng.
    seeds.push(...(place % 2 === 1 ? tier.reverse() : tier));
  }
  return seeds;
}

/**
 * @typedef {Object} BracketMatch
 * @property {number} round        1 = vòng đầu
 * @property {number} position     0-based trong vòng
 * @property {string|null} a
 * @property {string|null} b
 * @property {boolean} bye         một bên trống → bên kia tự đi tiếp
 * @property {{ round: number, position: number, slot: 'a'|'b' }|null} next
 */

/**
 * Sinh toàn bộ cây nhánh. Đội thiếu (khi N không phải luỹ thừa 2) thành "bye" cho seed cao.
 * @param {string[]} seeds  entryId theo thứ tự hạt giống
 * @returns {BracketMatch[]}
 */
function buildBracket(seeds) {
  if (seeds.length < 2) throw new RangeError('Cần ít nhất 2 đội vào vòng loại trực tiếp');
  let size = 1;
  while (size < seeds.length) size *= 2;
  const order = seedOrder(size);
  const rounds = Math.log2(size);
  /** @type {BracketMatch[]} */
  const out = [];
  for (let r = 1; r <= rounds; r += 1) {
    const count = size / 2 ** r;
    for (let p = 0; p < count; p += 1) {
      const next = r < rounds ? { round: r + 1, position: Math.floor(p / 2), slot: /** @type {'a'|'b'} */ (p % 2 === 0 ? 'a' : 'b') } : null;
      if (r === 1) {
        const a = seeds[order[2 * p] - 1] ?? null;
        const b = seeds[order[2 * p + 1] - 1] ?? null;
        out.push({ round: r, position: p, a, b, bye: a === null || b === null, next });
      } else {
        out.push({ round: r, position: p, a: null, b: null, bye: false, next });
      }
    }
  }
  return out;
}

/**
 * Tên vòng hiển thị.
 * @param {number} round @param {number} totalRounds @returns {string}
 */
function roundLabel(round, totalRounds) {
  const left = totalRounds - round;
  if (left === 0) return 'Chung kết';
  if (left === 1) return 'Bán kết';
  if (left === 2) return 'Tứ kết';
  return `Vòng 1/${2 ** left}`;
}

module.exports = { seedOrder, seedsFromGroups, buildBracket, roundLabel };

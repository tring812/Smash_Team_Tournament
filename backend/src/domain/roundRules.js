'use strict';
/**
 * Luật điểm theo vòng — thuần logic.
 *
 * Thứ tự áp dụng cho một trận:
 *   vòng bảng      : round_rules.group                              → luật mặc định của nội dung
 *   loại trực tiếp : round_rules.knockout[<đếm ngược từ chung kết>] → round_rules.knockout["*"] → mặc định
 * Đếm ngược: 1 = Chung kết, 2 = Bán kết, 3 = Tứ kết, 4 = vòng 1/8, 5 = 1/16, 6 = 1/32.
 * Tranh hạng Ba–Tư dùng cùng luật với bán kết.
 */
const { assertRules } = require('./scoring');

/** @typedef {import('./scoring').ScoringRules} ScoringRules */
/** @typedef {{ group?: ScoringRules, knockout?: Record<string, ScoringRules> }} RoundRules */
/** @typedef {{ stage: 'group' } | { stage: 'knockout', fromEnd: number|null }} RuleScope */

const MAX_FROM_END = 6;

/** @param {any} cat hàng categories @returns {ScoringRules} */
const defaultRules = (cat) => ({ pointsToWin: cat.points_to_win, maxPoints: cat.max_points, gamesToWin: cat.games_to_win });

/**
 * Khoá luật áp cho một trận: 'group' | 'ko:<n>' (n đếm ngược từ chung kết).
 * @param {'group'|'knockout'} stage @param {number} round @param {number|null|undefined} koRounds tổng số vòng của nhánh
 * @param {boolean} [isThirdPlace]
 */
function scopeKey(stage, round, koRounds, isThirdPlace = false) {
  if (stage === 'group') return 'group';
  return `ko:${isThirdPlace ? 2 : (koRounds ?? round) - round + 1}`;
}

/**
 * Luật hiệu lực cho một trận.
 * @param {any} cat hàng categories (có round_rules) @param {'group'|'knockout'} stage @param {number} round
 * @param {number|null|undefined} koRounds @param {boolean} [isThirdPlace]
 * @returns {ScoringRules}
 */
function effectiveRules(cat, stage, round, koRounds, isThirdPlace = false) {
  /** @type {RoundRules} */
  const rr = cat.round_rules ?? {};
  if (stage === 'group') return rr.group ?? defaultRules(cat);
  const fromEnd = scopeKey(stage, round, koRounds, isThirdPlace).slice(3);
  return rr.knockout?.[fromEnd] ?? rr.knockout?.['*'] ?? defaultRules(cat);
}

/**
 * Danh sách luật từ client → JSON lưu DB (đã kiểm tra). Bỏ trống danh sách = bỏ mọi luật riêng.
 * @param {Array<RuleScope & ScoringRules>} list
 * @returns {RoundRules}
 */
function buildRoundRules(list) {
  /** @type {RoundRules} */
  const out = {};
  const seen = new Set();
  for (const item of list) {
    const rules = { pointsToWin: item.pointsToWin, maxPoints: item.maxPoints, gamesToWin: item.gamesToWin };
    assertRules(rules);
    let key;
    if (item.stage === 'group') {
      key = 'group';
      out.group = rules;
    } else {
      const fe = item.fromEnd;
      if (fe !== null && (!Number.isInteger(fe) || fe < 1 || fe > MAX_FROM_END)) throw new RangeError('Vòng loại trực tiếp không hợp lệ');
      key = `ko:${fe ?? '*'}`;
      out.knockout = { ...(out.knockout ?? {}), [fe === null ? '*' : String(fe)]: rules };
    }
    if (seen.has(key)) throw new RangeError('Mỗi vòng chỉ đặt một luật');
    seen.add(key);
  }
  return out;
}

/** Hai luật giống nhau? */
const sameRules = (a, b) => a.pointsToWin === b.pointsToWin && a.maxPoints === b.maxPoints && a.gamesToWin === b.gamesToWin;

/** Tên vòng theo đếm ngược. */
function fromEndLabel(n) {
  if (n === 1) return 'Chung kết';
  if (n === 2) return 'Bán kết';
  if (n === 3) return 'Tứ kết';
  return `Vòng 1/${2 ** (n - 1)}`;
}

module.exports = { MAX_FROM_END, defaultRules, scopeKey, effectiveRules, buildRoundRules, sameRules, fromEndLabel };

'use strict';
/**
 * Bảng xếp hạng vòng bảng — thuần logic.
 *
 * Thứ tự ưu tiên (theo tinh thần BWF General Competition Regulations, đơn giản hoá cho MVP):
 *  1. Số trận thắng.
 *  2. Nếu đúng 2 đội bằng nhau → đối đầu trực tiếp.
 *  3. Nếu >= 3 đội bằng nhau → hiệu số game, rồi hiệu số điểm (trong các trận giữa nhóm đội đó);
 *     nếu tách còn 2 đội → đối đầu; còn lại → rating/seed, cuối cùng theo id (tất định).
 * Trận bỏ cuộc (walkover) tính thắng cho bên kia, không cộng game/điểm.
 */

/**
 * @typedef {Object} FinishedMatch
 * @property {string} a
 * @property {string} b
 * @property {'a'|'b'} winner
 * @property {[number, number][]} games
 * @property {boolean} [walkover]
 */

/**
 * @typedef {Object} StandingRow
 * @property {string} entryId
 * @property {number} rank
 * @property {number} played
 * @property {number} won
 * @property {number} lost
 * @property {number} gamesFor
 * @property {number} gamesAgainst
 * @property {number} pointsFor
 * @property {number} pointsAgainst
 */

/**
 * @param {string[]} ids
 * @param {FinishedMatch[]} matches
 * @returns {Map<string, StandingRow>}
 */
function tally(ids, matches) {
  const set = new Set(ids);
  /** @type {Map<string, StandingRow>} */
  const rows = new Map(
    ids.map((id) => [id, { entryId: id, rank: 0, played: 0, won: 0, lost: 0, gamesFor: 0, gamesAgainst: 0, pointsFor: 0, pointsAgainst: 0 }]),
  );
  for (const m of matches) {
    if (!set.has(m.a) || !set.has(m.b)) continue;
    const ra = /** @type {StandingRow} */ (rows.get(m.a));
    const rb = /** @type {StandingRow} */ (rows.get(m.b));
    ra.played += 1;
    rb.played += 1;
    const [w, l] = m.winner === 'a' ? [ra, rb] : [rb, ra];
    w.won += 1;
    l.lost += 1;
    if (m.walkover) continue;
    for (const [ga, gb] of m.games) {
      ra.pointsFor += ga; ra.pointsAgainst += gb;
      rb.pointsFor += gb; rb.pointsAgainst += ga;
      if (ga > gb) { ra.gamesFor += 1; rb.gamesAgainst += 1; } else { rb.gamesFor += 1; ra.gamesAgainst += 1; }
    }
  }
  return rows;
}

/**
 * @param {string[]} entryIds
 * @param {FinishedMatch[]} matches
 * @param {Record<string, number>} [rating]  dùng phá hoà cuối cùng (cao hơn xếp trên)
 * @param {string[]} [unrankedIds]  đối thủ đã thi đấu nhưng không được xếp hạng
 * @returns {StandingRow[]}
 */
function computeStandings(entryIds, matches, rating = {}, unrankedIds = []) {
  const all = tally([...entryIds, ...unrankedIds], matches);

  /** @param {string} x @param {string} y @returns {number} */
  const fallback = (x, y) => (rating[y] ?? 0) - (rating[x] ?? 0) || (x < y ? -1 : 1);

  /**
   * Thắng đối đầu giữa 2 đội.
   * @param {string} x @param {string} y @returns {number}
   */
  const headToHead = (x, y) => {
    const m = matches.find((k) => (k.a === x && k.b === y) || (k.a === y && k.b === x));
    if (!m) return fallback(x, y);
    const winnerId = m.winner === 'a' ? m.a : m.b;
    return winnerId === x ? -1 : 1;
  };

  /**
   * Sắp xếp một cụm bằng điểm.
   * @param {string[]} cluster @returns {string[]}
   */
  const resolve = (cluster) => {
    if (cluster.length === 1) return cluster;
    if (cluster.length === 2) return [...cluster].sort(headToHead);
    const sub = tally(cluster, matches);
    /** @param {string} id */
    const key = (id) => {
      const r = /** @type {StandingRow} */ (sub.get(id));
      return [r.gamesFor - r.gamesAgainst, r.pointsFor - r.pointsAgainst];
    };
    const sorted = [...cluster].sort((x, y) => {
      const [gx, px] = key(x);
      const [gy, py] = key(y);
      return gy - gx || py - px || 0;
    });
    // Gom lại các cụm vẫn còn hoà và xử lý tiếp (2 đội → đối đầu, >=3 → fallback).
    /** @type {string[]} */
    const out = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      const [gi, pi] = key(sorted[i]);
      while (j < sorted.length && key(sorted[j])[0] === gi && key(sorted[j])[1] === pi) j += 1;
      const tie = sorted.slice(i, j);
      if (tie.length === 2) out.push(...tie.sort(headToHead));
      else out.push(...tie.sort(fallback));
      i = j;
    }
    return out;
  };

  const byWins = [...entryIds].sort((x, y) => all.get(y).won - all.get(x).won);
  /** @type {string[]} */
  const order = [];
  let i = 0;
  while (i < byWins.length) {
    let j = i + 1;
    while (j < byWins.length && all.get(byWins[j]).won === all.get(byWins[i]).won) j += 1;
    order.push(...resolve(byWins.slice(i, j)));
    i = j;
  }
  return order.map((id, idx) => ({ ...all.get(id), rank: idx + 1 }));
}

module.exports = { computeStandings };

'use strict';
/**
 * Luật tính điểm cầu lông (rally point) — thuần logic, không I/O.
 *
 * Mặc định BWF: game tới 21, phải hơn 2 điểm, chạm trần 30 thì 30-29 thắng.
 * Giải phong trào hay rút gọn (15 / trần 21, hoặc 11 / trần 15) — cấu hình theo nội dung.
 */

/** @typedef {{ pointsToWin: number, maxPoints: number, gamesToWin: number }} ScoringRules */
/** @typedef {[number, number]} GameScore  [điểm bên A, điểm bên B] */

/** @type {ScoringRules} */
const BWF_RULES = Object.freeze({ pointsToWin: 21, maxPoints: 30, gamesToWin: 2 });

/**
 * Kiểm tra cấu hình luật hợp lệ.
 * @param {ScoringRules} r
 * @returns {void}
 * @throws {RangeError}
 */
function assertRules(r) {
  if (!Number.isInteger(r.pointsToWin) || r.pointsToWin < 5 || r.pointsToWin > 50) {
    throw new RangeError('pointsToWin phải là số nguyên 5..50');
  }
  if (!Number.isInteger(r.maxPoints) || r.maxPoints < r.pointsToWin || r.maxPoints > 60) {
    throw new RangeError('maxPoints phải >= pointsToWin và <= 60');
  }
  if (!Number.isInteger(r.gamesToWin) || r.gamesToWin < 1 || r.gamesToWin > 3) {
    throw new RangeError('gamesToWin phải là 1..3');
  }
}

/**
 * Trạng thái một game.
 * @param {GameScore} g
 * @param {ScoringRules} r
 * @returns {'a'|'b'|'in_progress'|'invalid'}
 */
function gameState(g, r) {
  const [a, b] = g;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return 'invalid';
  if (a > r.maxPoints || b > r.maxPoints) return 'invalid';
  const P = r.pointsToWin;
  const M = r.maxPoints;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const winner = a > b ? 'a' : 'b';

  if (hi === lo) return hi < M ? 'in_progress' : 'invalid';

  // Kết thúc bình thường: chạm P khi đối thủ <= P-2, hoặc qua deuce và hơn đúng 2.
  const endedNormally = (hi === P && lo <= P - 2) || (hi > P && hi - lo === 2 && lo >= P - 1);
  // Chạm trần: người tới M trước thắng (vd 30-29). Nếu M === P thì không có deuce.
  const endedAtCap = M === P ? hi === M : hi === M && lo === M - 1;
  if (endedNormally || endedAtCap) return winner;

  if (hi < P) return 'in_progress';
  if (hi - lo === 1 && lo >= P - 1 && hi < M) return 'in_progress'; // đang deuce, vd 21-20
  return 'invalid'; // vd 25-15: không thể (game đã kết thúc ở 21-15)
}

/**
 * @typedef {Object} MatchEvaluation
 * @property {boolean} valid
 * @property {string|null} error
 * @property {'a'|'b'|null} winner     bên thắng trận nếu đã đủ số game
 * @property {number} gamesA
 * @property {number} gamesB
 * @property {number} pointsA
 * @property {number} pointsB
 * @property {boolean} complete
 */

/**
 * Đánh giá toàn bộ tỉ số trận. Chỉ game cuối được phép đang dở.
 * @param {GameScore[]} games
 * @param {ScoringRules} r
 * @returns {MatchEvaluation}
 */
function evaluateMatch(games, r) {
  assertRules(r);
  /** @type {MatchEvaluation} */
  const res = { valid: true, error: null, winner: null, gamesA: 0, gamesB: 0, pointsA: 0, pointsB: 0, complete: false };
  const maxGames = r.gamesToWin * 2 - 1;
  if (!Array.isArray(games) || games.length > maxGames) {
    return { ...res, valid: false, error: `Tối đa ${maxGames} game` };
  }
  for (let i = 0; i < games.length; i += 1) {
    const g = games[i];
    if (!Array.isArray(g) || g.length !== 2) return { ...res, valid: false, error: `Game ${i + 1} sai định dạng` };
    if (res.winner) return { ...res, valid: false, error: `Trận đã kết thúc trước game ${i + 1}` };
    const st = gameState(g, r);
    if (st === 'invalid') return { ...res, valid: false, error: `Tỉ số game ${i + 1} (${g[0]}-${g[1]}) không hợp lệ` };
    if (st === 'in_progress' && i !== games.length - 1) {
      return { ...res, valid: false, error: `Game ${i + 1} chưa kết thúc nhưng đã có game sau` };
    }
    res.pointsA += g[0];
    res.pointsB += g[1];
    if (st === 'a') res.gamesA += 1;
    if (st === 'b') res.gamesB += 1;
    if (res.gamesA === r.gamesToWin) res.winner = 'a';
    if (res.gamesB === r.gamesToWin) res.winner = 'b';
  }
  res.complete = res.winner !== null;
  return res;
}

module.exports = { BWF_RULES, assertRules, gameState, evaluateMatch };

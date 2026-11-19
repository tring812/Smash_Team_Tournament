'use strict';
/**
 * Log JSON một dòng / sự kiện ra stdout (Render/Cloud Run gom log). Không bao giờ log token, cookie, ticket.
 * Chuỗi được JSON.stringify escape nên CR/LF trong input không thể giả mạo dòng log (CWE-117).
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[/** @type {keyof LEVELS} */ (process.env.LOG_LEVEL ?? 'info')] ?? 20;

/**
 * @param {'debug'|'info'|'warn'|'error'} level @param {string} message @param {Record<string, unknown>} [fields]
 */
function log(level, message, fields = {}) {
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

module.exports = { log };

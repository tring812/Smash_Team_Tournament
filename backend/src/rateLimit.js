'use strict';
/**
 * Rate limiter cửa sổ trượt trong bộ nhớ (đủ cho 1 instance MVP).
 * TODO(Tier 2 / >1 instance): chuyển sang store dùng chung (Redis/Postgres) — trigger: scale ngang.
 */
const { HttpError } = require('./errors');

/** @param {{ windowMs: number, max: number }} opts */
function createRateLimiter({ windowMs, max }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, ts] of hits) {
      const live = ts.filter((t) => now - t < windowMs);
      if (live.length) hits.set(k, live); else hits.delete(k);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const ts = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (ts.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return next(new HttpError(429, 'RATE_LIMITED', 'Thao tác quá nhanh, thử lại sau ít phút'));
    }
    ts.push(now);
    hits.set(key, ts);
    return next();
  };
}

module.exports = { createRateLimiter };

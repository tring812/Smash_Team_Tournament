'use strict';
/**
 * Kênh "có thay đổi" theo giải cho Server-Sent Events: trang công khai / bảng điều phối / màn hình TV
 * tải lại NGAY khi có điểm, gọi trận, dời trận… thay vì chờ chu kỳ polling.
 *
 * Chỉ báo "giải X vừa đổi" (không mang dữ liệu) → client tự gọi lại API như cũ, nên quyền xem vẫn do API kiểm.
 * Bus nằm trong bộ nhớ: đúng với 1 instance API (giống rate limit). Nhiều instance → thay bằng Postgres
 * LISTEN/NOTIFY hoặc Redis pub/sub; client vẫn có polling làm dự phòng nên không sai, chỉ chậm hơn.
 */
const { EventEmitter } = require('node:events');

const MAX_SUBSCRIBERS = 1000;
const HEARTBEAT_MS = 25_000; // giữ kết nối qua proxy/load balancer hay cắt kết nối im lặng
const DEBOUNCE_MS = 250; // gộp nhiều thay đổi liên tiếp (vd xếp lịch cả giải) thành 1 tín hiệu

const bus = new EventEmitter();
bus.setMaxListeners(MAX_SUBSCRIBERS + 10);
let subscribers = 0;

/** Quá số trận này trong một lần gộp thì coi như "đổi nhiều" → client tải lại toàn bộ. */
const MAX_MATCH_IDS = 20;

/**
 * Phạm vi thay đổi:
 *  - `{ kind: 'match', matchId }`: chỉ tỉ số / biên bản / trọng tài của MỘT trận đổi (mỗi điểm) → client chỉ tải lại trận đó.
 *  - `{ kind: 'structure' }` (mặc định): lịch, sân, kết quả, bốc thăm… → client tải lại toàn bộ như cũ.
 * @typedef {{ kind: 'match', matchId: string } | { kind: 'structure' }} Scope
 * @typedef {{ kind: 'match', matchIds: string[] } | { kind: 'structure' }} Signal
 */

/**
 * Gộp một thay đổi vào tín hiệu đang chờ gửi (trong cửa sổ debounce).
 * @param {Signal|null} acc @param {Scope|undefined} scope @returns {Signal}
 */
function mergeScope(acc, scope) {
  const isMatch = scope?.kind === 'match' && typeof scope.matchId === 'string';
  if (!isMatch || acc?.kind === 'structure') return { kind: 'structure' };
  const ids = acc ? acc.matchIds : [];
  if (!ids.includes(scope.matchId)) {
    if (ids.length >= MAX_MATCH_IDS) return { kind: 'structure' };
    ids.push(scope.matchId);
  }
  return { kind: 'match', matchIds: ids };
}

/** Báo giải `tid` vừa thay đổi. @param {string|undefined} tid @param {Scope} [scope] */
function publish(tid, scope) {
  if (tid) bus.emit(`t:${tid}`, scope ?? { kind: 'structure' });
}

/**
 * Giữ một response SSE mở và đẩy `event: changed` mỗi khi giải đổi.
 * @param {import('express').Request} req @param {import('express').Response} res @param {string} tid
 * @returns {boolean} false nếu đã quá số kết nối (caller trả 503)
 */
function subscribe(req, res, tid) {
  if (subscribers >= MAX_SUBSCRIBERS) return false;
  subscribers += 1;
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: không gom bộ đệm
  res.flushHeaders();
  res.write('retry: 5000\n: connected\n\n');

  /** @type {NodeJS.Timeout|null} */ let pending = null;
  /** @type {Signal|null} */ let acc = null;
  // data: {"kind":"match","matchIds":[…]} | {"kind":"structure"} — chỉ là phạm vi, không mang dữ liệu trận.
  /** @param {Scope} [scope] */
  const onChange = (scope) => {
    acc = mergeScope(acc, scope);
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const out = acc;
      acc = null;
      res.write(`event: changed\ndata: ${JSON.stringify(out)}\n\n`);
    }, DEBOUNCE_MS);
  };
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  bus.on(`t:${tid}`, onChange);
  req.on('close', () => {
    subscribers -= 1;
    clearInterval(beat);
    if (pending) clearTimeout(pending);
    bus.off(`t:${tid}`, onChange);
  });
  return true;
}

module.exports = { publish, subscribe, mergeScope, bus };

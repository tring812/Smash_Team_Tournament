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
 *  - `{ kind: 'match', matchId | matchIds }`: chỉ MỘT VÀI trận đổi — tỉ số / biên bản (mỗi điểm), trọng tài, gọi sân,
 *    rút về, dời trận, bắt đầu → client chỉ tải lại các trận đó (`GET /matches/:id`).
 *    Thêm `categoryId` khi kết quả của nội dung đó đổi (xác nhận / bỏ cuộc) → client tải lại bảng xếp hạng / nhánh
 *    của nội dung, KHÔNG tải lại cả lịch.
 *  - `{ kind: 'structure' }` (mặc định): bốc thăm, xếp lịch, sửa đội / nội dung / giải… → client tải lại toàn bộ như cũ.
 * @typedef {{ kind: 'match', matchId?: string, matchIds?: string[], categoryId?: string } | { kind: 'structure' }} Scope
 * @typedef {{ kind: 'match', matchIds: string[], categoryIds?: string[] } | { kind: 'structure' }} Signal
 */

const isId = (v) => typeof v === 'string' && v.length > 0;

/**
 * Gộp một thay đổi vào tín hiệu đang chờ gửi (trong cửa sổ debounce).
 * @param {Signal|null} acc @param {Scope|undefined} scope @returns {Signal}
 */
function mergeScope(acc, scope) {
  if (scope?.kind !== 'match' || acc?.kind === 'structure') return { kind: 'structure' };
  const incoming = [...(isId(scope.matchId) ? [scope.matchId] : []), ...(Array.isArray(scope.matchIds) ? scope.matchIds.filter(isId) : [])];
  if (!incoming.length) return { kind: 'structure' };
  const ids = acc ? acc.matchIds : [];
  for (const id of incoming) {
    if (ids.includes(id)) continue;
    if (ids.length >= MAX_MATCH_IDS) return { kind: 'structure' };
    ids.push(id);
  }
  const cats = acc?.categoryIds ?? [];
  if (isId(scope.categoryId) && !cats.includes(scope.categoryId)) cats.push(scope.categoryId);
  return cats.length ? { kind: 'match', matchIds: ids, categoryIds: cats } : { kind: 'match', matchIds: ids };
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
  // data: {"kind":"match","matchIds":[…],"categoryIds"?:[…]} | {"kind":"structure"} — chỉ là phạm vi, không mang dữ liệu trận.
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

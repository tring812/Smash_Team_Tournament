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

/** Báo giải `tid` vừa thay đổi. */
function publish(tid) {
  if (tid) bus.emit(`t:${tid}`);
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
  const onChange = () => {
    if (pending) return;
    pending = setTimeout(() => { pending = null; res.write(`event: changed\ndata: ${Date.now()}\n\n`); }, DEBOUNCE_MS);
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

module.exports = { publish, subscribe, bus };

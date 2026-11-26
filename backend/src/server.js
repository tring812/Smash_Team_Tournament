'use strict';
/** Điểm vào production: đọc config, mở pool, listen, tắt êm khi SIGTERM. */
const { createPool } = require('./db');
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { log } = require('./log');
const live = require('./liveBus');
const { purgeDeletedTournaments } = require('./services/tournamentService');

const config = loadConfig();
const pool = createPool(config.databaseUrl, {
  max: 10,
  // Giữ kết nối rảnh 5 phút: trọng tài bấm điểm cách nhau > 10s, mở kết nối mới (TCP + TLS + xác thực tới
  // DB ở xa) tốn 0,5–4s mỗi lần. keepAlive để NAT / pooler không cắt ngầm kết nối đang rảnh.
  idleTimeoutMillis: 300_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000, // không để 1 query treo giữ connection
});
pool.on('error', (err) => log('warn', 'pg_idle_client_error', { error: err.message }));

const server = createApp({ pool, config }).listen(config.port, () => {
  log('info', 'server_started', { port: config.port, env: config.nodeEnv });
});

// Giải đã xoá quá 7 ngày → xoá hẳn (lúc khởi động và mỗi 6 giờ).
const purge = () => purgeDeletedTournaments(pool)
  .then((n) => { if (n) log('info', 'tournaments_purged', { count: n }); })
  .catch((err) => log('warn', 'tournaments_purge_failed', { error: err.message }));
void purge();
setInterval(purge, 6 * 3_600_000).unref();

function shutdown(signal) {
  log('info', 'shutdown', { signal });
  // Đóng luồng SSE TRƯỚC server.close: close chỉ cắt kết nối đang rảnh lúc được gọi, luồng SSE không bao giờ rảnh
  // → nếu không, server.close chờ tới hạn 10s rồi thoát mã 1, bỏ qua đóng pool DB. Cùng một tick nên không lọt
  // kết nối SSE mới vào giữa hai lệnh. Client tự kết nối lại (retry 5s) vào máy chủ mới.
  log('info', 'live_streams_closed', { count: live.closeAll() });
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

'use strict';
/** Điểm vào production: đọc config, mở pool, listen, tắt êm khi SIGTERM. */
const { createPool } = require('./db');
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { log } = require('./log');
const { purgeDeletedTournaments } = require('./services/tournamentService');

const config = loadConfig();
const pool = createPool(config.databaseUrl, {
  max: 10,
  idleTimeoutMillis: 10_000,
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
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

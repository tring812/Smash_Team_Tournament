'use strict';
/** Điểm vào production: đọc config, mở pool, listen, tắt êm khi SIGTERM. */
const { createPool } = require('./db');
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { log } = require('./log');

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

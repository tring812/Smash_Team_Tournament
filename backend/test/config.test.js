'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

const good = {
  NODE_ENV: 'production', DATABASE_URL: 'postgres://u@h/db', SESSION_SECRET: 'x'.repeat(48),
  PUBLIC_ORIGIN: 'https://giai.example.com',
};

test('accepts a complete production config', () => {
  const c = loadConfig(good);
  assert.equal(c.cookieSecure, true);
  assert.equal(c.devLogin, false);
});
test('fails closed on a short session secret', () => {
  assert.throws(() => loadConfig({ ...good, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
});
test('requires https origin in production and rejects origins with a path', () => {
  assert.throws(() => loadConfig({ ...good, PUBLIC_ORIGIN: 'http://giai.example.com' }), /https/);
  assert.throws(() => loadConfig({ ...good, PUBLIC_ORIGIN: 'https://giai.example.com/x' }), /path/);
});
test('rejects non-postgres database URLs, pglite and DEV_LOGIN in production', () => {
  assert.throws(() => loadConfig({ ...good, DATABASE_URL: 'mysql://x' }), /DATABASE_URL/);
  assert.throws(() => loadConfig({ ...good, DATABASE_URL: 'pglite:.pgdata' }), /pglite/);
  assert.throws(() => loadConfig({ ...good, DEV_LOGIN: '1' }), /DEV_LOGIN/);
});

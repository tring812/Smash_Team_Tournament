'use strict';
/**
 * Áp dụng migrations/*.sql theo thứ tự tên. Mỗi file tự bọc BEGIN/COMMIT và idempotent,
 * nên chạy lại an toàn. Bỏ qua file đã ghi trong schema_migrations.
 * Dùng: DATABASE_URL=postgres://... (hoặc pglite:.pgdata khi dev) npm run migrate
 */
const fs = require('node:fs');
const path = require('node:path');
const { createPool } = require('../src/db');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu DATABASE_URL');
  const pool = createPool(url);
  const client = await pool.connect();
  try {
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    let applied = new Set();
    try {
      applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    } catch { /* bảng chưa có ở lần chạy đầu */ }
    for (const f of files) {
      const version = f.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      process.stdout.write(`→ ${f}\n`);
      // Runner tự ghi phiên bản (file không cần tự INSERT); file vẫn tự bọc BEGIN/COMMIT.
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
    }
    process.stdout.write('Migrations OK\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { process.stderr.write(`Migration thất bại: ${err.message}\n`); process.exit(1); });

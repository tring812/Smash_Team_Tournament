'use strict';
/**
 * Tạo "pool" Postgres theo DATABASE_URL.
 *  - postgres://...  → `pg.Pool` (production / CI).
 *  - pglite:<thư mục> hoặc pglite:memory → PGlite (Postgres WASM chạy trong tiến trình) — CHỈ DÙNG KHI DEV
 *    trên máy không có Docker/Postgres. PGlite chỉ có 1 phiên nên adapter xếp hàng mọi truy vấn:
 *    một transaction (`connect()`) giữ độc quyền tới khi `release()`.
 */
const path = require('node:path');

/**
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number|null }> }} Queryable
 * @typedef {Queryable & { connect: () => Promise<Queryable & { release: () => void }>, end: () => Promise<void>, on: (ev: string, fn: Function) => void }} DbPool
 */

/**
 * @param {string} databaseUrl
 * @param {Record<string, unknown>} [pgOptions]
 * @returns {DbPool}
 */
function createPool(databaseUrl, pgOptions = {}) {
  if (databaseUrl.startsWith('pglite:')) return createPglitePool(databaseUrl.slice('pglite:'.length));
  // eslint-disable-next-line global-require
  const { Pool } = require('pg');
  return new Pool({ connectionString: databaseUrl, ...pgOptions });
}

/**
 * @param {string} target  'memory' | đường dẫn thư mục dữ liệu (tương đối với thư mục backend)
 * @returns {DbPool}
 */
function createPglitePool(target) {
  // eslint-disable-next-line global-require
  const { PGlite } = require('@electric-sql/pglite');
  const db = target === 'memory' || target === '' ? new PGlite() : new PGlite(path.resolve(__dirname, '..', target));

  /** Hàng đợi tuần tự: trả về hàm release khi tới lượt. */
  let tail = Promise.resolve();
  const acquire = () => {
    /** @type {() => void} */
    let release = () => {};
    const turn = new Promise((r) => { release = r; });
    const prev = tail;
    tail = prev.then(() => turn);
    return prev.then(() => release);
  };

  /** @param {string} text @param {unknown[]} [params] */
  const run = async (text, params) => {
    if (params && params.length) {
      const r = await db.query(text, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    }
    // Không tham số → simple query (cho phép nhiều câu lệnh, như file migration).
    const rs = await db.exec(text);
    const last = rs[rs.length - 1] ?? { rows: [], affectedRows: 0 };
    return { rows: last.rows, rowCount: last.affectedRows ?? last.rows.length };
  };

  return {
    async query(text, params) {
      const release = await acquire();
      try { return await run(text, params); } finally { release(); }
    },
    async connect() {
      const release = await acquire();
      let released = false;
      return {
        query: run,
        release() { if (!released) { released = true; release(); } },
      };
    },
    async end() { await db.close(); },
    on() {},
  };
}

module.exports = { createPool };

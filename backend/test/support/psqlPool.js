'use strict';
/**
 * CHỈ DÙNG CHO TEST: một "pool" giả lập interface tối thiểu của `pg` (query/connect/release)
 * bằng một tiến trình `psql` lâu dài. Lý do tồn tại: môi trường CI/sandbox có Postgres nhưng
 * không cài được driver `pg`; adapter này cho phép test SQL thật của service layer.
 *
 * Tham số được nội suy thành literal đã escape — an toàn vì dữ liệu do chính test sinh ra.
 * KHÔNG BAO GIỜ dùng ở production (production dùng `pg` với parameterized query thật).
 */
const { spawn } = require('node:child_process');

/** @param {unknown} v @returns {string} */
function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('non-finite number');
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return quote(v.toISOString());
  if (Array.isArray(v)) return quote(`{${v.map((x) => `"${String(x).replace(/["\\]/g, '\\$&')}"`).join(',')}}`);
  if (typeof v === 'object') return quote(JSON.stringify(v));
  return quote(String(v));
}
/** @param {string} s */
function quote(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

/** @param {string} text @param {unknown[]} params */
function interpolate(text, params) {
  return text.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));
}

/**
 * @param {{ host: string, port: number, database: string, user?: string }} conn
 */
function createPsqlPool(conn) {
  const proc = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=0',
    '-h', conn.host, '-p', String(conn.port), '-U', conn.user ?? 'postgres', '-d', conn.database], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PGTZ: 'UTC', PGCLIENTENCODING: 'UTF8' },
  });
  let buf = '';
  /** @type {Array<(out: string) => void>} */
  const waiters = [];
  proc.stdout.setEncoding('utf8');
  /** @type {string[]} */
  let body = [];
  proc.stdout.on('data', (d) => {
    buf += d;
    let eol;
    while ((eol = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, eol);
      buf = buf.slice(eol + 1);
      if (line.startsWith('__END__|')) {
        const w = waiters.shift();
        if (w) w(`${line}\u0000${body.join('\n')}`);
        body = [];
      } else {
        body.push(line);
      }
    }
  });
  proc.stderr.resume(); // lỗi được đọc qua biến psql, không qua stderr

  let chain = Promise.resolve();

  /**
   * @param {string} text @param {unknown[]} [params]
   * @returns {Promise<{ rows: any[], rowCount: number }>}
   */
  function query(text, params = []) {
    const run = () => new Promise((resolve, reject) => {
      const sql = interpolate(text, params).trim().replace(/;\s*$/, '');
      const returnsRows = /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
      const stmt = returnsRows
        ? `WITH __t AS (${sql}) SELECT coalesce(json_agg(row_to_json(__t)), '[]'::json) FROM __t;`
        : `${sql};`;
      waiters.push((out) => {
        const [marker, body] = out.split('\u0000');
        const [, isErr, sqlstate, ...msg] = marker.split('|');
        if (isErr === 'true') {
          const e = new Error(msg.join('|'));
          // @ts-ignore — giống pg: err.code = SQLSTATE
          e.code = sqlstate;
          reject(e);
          return;
        }
        const rows = returnsRows ? JSON.parse(body.trim() || '[]') : [];
        resolve({ rows, rowCount: rows.length });
      });
      proc.stdin.write(`${stmt}\n\\echo __END__|:ERROR|:SQLSTATE|:LAST_ERROR_MESSAGE\n`);
    });
    const p = chain.then(run, run);
    chain = p.then(() => undefined, () => undefined);
    return p;
  }

  const client = { query, release: () => {} };
  return {
    query,
    connect: async () => client,
    end: () => new Promise((r) => { proc.on('close', r); proc.stdin.end('\\q\n'); }),
  };
}

module.exports = { createPsqlPool };

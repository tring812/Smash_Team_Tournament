'use strict';
/**
 * Tạo (hoặc đặt lại mật khẩu cho) một tài khoản từ dòng lệnh — dùng để tạo QUẢN TRỊ VIÊN ĐẦU TIÊN khi triển khai.
 *
 *   npm run user:create -- --username admin --name "Ban tổ chức" --role admin
 *
 * Mật khẩu lấy từ biến môi trường NEW_USER_PASSWORD (không đưa vào tham số để khỏi lọt vào lịch sử shell);
 * nếu không đặt, script sinh mật khẩu ngẫu nhiên và in ra MỘT lần — đổi lại sau khi đăng nhập.
 * Tài khoản đã tồn tại → đặt lại mật khẩu, mở khoá, đăng xuất mọi phiên cũ.
 */
const crypto = require('node:crypto');
const { parseArgs } = require('node:util');
const { createPool } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { schemas } = require('../src/schemas');

async function main() {
  const { values } = parseArgs({
    options: { username: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'admin' } },
  });
  const generated = !process.env.NEW_USER_PASSWORD;
  const password = process.env.NEW_USER_PASSWORD || crypto.randomBytes(12).toString('base64url');
  const input = schemas.createUser.parse({
    username: values.username, fullName: values.name ?? values.username, role: values.role, password,
  });
  if (!process.env.DATABASE_URL) throw new Error('Thiếu DATABASE_URL');
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, full_name, role, password_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
         disabled_at = NULL, session_version = users.session_version + 1
       RETURNING id, (xmax = 0) AS created`,
      [input.username, input.fullName, input.role, await hashPassword(input.password)],
    );
    process.stdout.write(`${rows[0].created ? 'Đã tạo' : 'Đã đặt lại mật khẩu cho'} tài khoản "${input.username}" (${input.role}).\n`);
    if (generated) process.stdout.write(`Mật khẩu tạm (chỉ hiện 1 lần, hãy đổi sau khi đăng nhập): ${password}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  const msg = err?.issues ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : err.message;
  process.stderr.write(`Lỗi: ${msg}\n`);
  process.exit(1);
});

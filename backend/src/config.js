'use strict';
/**
 * Đọc & kiểm tra cấu hình từ biến môi trường một lần lúc khởi động — thiếu/sai thì fail ngay
 * (fail closed) thay vì chạy với giá trị mặc định nguy hiểm.
 * Giá trị bí mật lấy từ secret manager (Render/Vercel env, 1Password `op run`…), KHÔNG commit.
 */

/**
 * @typedef {Object} AppConfig
 * @property {'development'|'test'|'production'} nodeEnv
 * @property {number} port
 * @property {string} databaseUrl
 * @property {string} sessionSecret        HS256 cho cookie phiên của app giải (>= 32 ký tự)
 * @property {string} publicOrigin         vd https://giai.example.com (CSRF origin check)
 * @property {boolean} cookieSecure
 * @property {boolean} devLogin           bật /api/auth/dev-login (chỉ dev, DEV_LOGIN=1)
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {AppConfig}
 */
function loadConfig(env = process.env) {
  const errors = [];
  const nodeEnv = /** @type {AppConfig['nodeEnv']} */ (env.NODE_ENV ?? 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) errors.push('NODE_ENV không hợp lệ');

  const port = Number(env.PORT ?? 5100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT không hợp lệ');

  const databaseUrl = env.DATABASE_URL ?? '';
  const isPglite = databaseUrl.startsWith('pglite:');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl) && !isPglite) errors.push('DATABASE_URL phải là postgres://... (hoặc pglite:<thư mục> khi dev)');
  if (isPglite && nodeEnv === 'production') errors.push('DATABASE_URL pglite: chỉ dùng khi dev');

  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) errors.push('SESSION_SECRET phải >= 32 ký tự (tạo bằng: openssl rand -base64 48)');

  const publicOrigin = env.PUBLIC_ORIGIN ?? 'http://localhost:3100';
  try {
    const u = new URL(publicOrigin);
    if (u.origin !== publicOrigin) errors.push('PUBLIC_ORIGIN chỉ gồm scheme://host[:port], không có path');
    if (nodeEnv === 'production' && u.protocol !== 'https:') errors.push('PUBLIC_ORIGIN phải https ở production');
  } catch {
    errors.push('PUBLIC_ORIGIN không phải URL');
  }

  const devLogin = env.DEV_LOGIN === '1';
  if (devLogin && nodeEnv === 'production') errors.push('DEV_LOGIN không được bật ở production');

  if (errors.length) {
    throw new Error(`Cấu hình không hợp lệ:\n - ${errors.join('\n - ')}`);
  }
  return { nodeEnv, port, databaseUrl, sessionSecret, publicOrigin, cookieSecure: nodeEnv === 'production', devLogin };
}

module.exports = { loadConfig };

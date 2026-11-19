-- 004_standalone_auth.sql — Web giải chạy ĐỘC LẬP: bỏ SSO SmashTeam, tài khoản riêng (tên đăng nhập + mật khẩu).
--  * users: role 'admin' | 'user'; username duy nhất (không phân biệt hoa thường); password_hash scrypt;
--    session_version tăng khi đổi mật khẩu/khoá → mọi phiên cũ mất hiệu lực; disabled_at = khoá tài khoản.
--  * Bỏ elo (giải mở rộng không dùng), bỏ bảng chống replay ticket SSO và cột liên kết sự kiện SmashTeam.
-- User cũ (tạo qua SSO/dev) giữ nguyên id → lịch sử BTC/trọng tài/nhật ký không mất; chưa có mật khẩu
-- thì chưa đăng nhập được cho tới khi admin đặt mật khẩu.

BEGIN;

ALTER TABLE users RENAME COLUMN smash_role TO role;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_smash_role_check;
UPDATE users SET role = 'user' WHERE role <> 'admin';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'));
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE users DROP COLUMN IF EXISTS elo;

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT
  CHECK (username ~ '^[a-z0-9._-]{3,40}$');
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT CHECK (length(password_hash) <= 512);
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ALTER COLUMN last_login_at DROP NOT NULL;
ALTER TABLE users ALTER COLUMN last_login_at DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username);

DROP TABLE IF EXISTS sso_ticket_uses;
ALTER TABLE tournaments DROP COLUMN IF EXISTS smashteam_event_id;

COMMIT;

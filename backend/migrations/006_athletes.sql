-- 006_athletes.sql — Hồ sơ VĐV theo giải: phân biệt người bằng MSSV (thẻ sinh viên) + số điện thoại.
--  * Một VĐV đánh nhiều nội dung là MỘT hồ sơ → chống trùng lịch / gọi sân theo NGƯỜI, không theo chuỗi tên
--    (gõ sai 1 chữ không còn "tách" một người thành hai; hai người trùng tên không còn bị gộp).
--  * MSSV, SĐT, email là dữ liệu cá nhân: chỉ BTC xem (API công khai không trả các cột này).
--  * Dữ liệu cũ: mỗi tên (chuẩn hoá) trong một giải → một hồ sơ (đúng như cách chống trùng theo tên trước đây).
-- Idempotent. Runner tự ghi schema_migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS athletes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  full_name      TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  name_key       TEXT NOT NULL,                       -- tên chuẩn hoá (NFC, thường, gộp khoảng trắng)
  student_id     TEXT CHECK (student_id ~ '^[A-Z0-9]{4,20}$'),
  phone          TEXT CHECK (phone ~ '^0[0-9]{9,10}$'),
  email          TEXT CHECK (length(email) <= 254),
  club           TEXT NOT NULL DEFAULT '' CHECK (length(club) <= 120),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS athletes_student_id_key ON athletes (tournament_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS athletes_phone_key ON athletes (tournament_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS athletes_name_idx ON athletes (tournament_id, name_key);

ALTER TABLE entries ADD COLUMN IF NOT EXISTS player1_athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS player2_athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS entries_p1_athlete_idx ON entries (player1_athlete_id);
CREATE INDEX IF NOT EXISTS entries_p2_athlete_idx ON entries (player2_athlete_id);

-- Backfill: hồ sơ cho mọi tên đã có (khoá tên khớp nameKey() bên JS).
INSERT INTO athletes (tournament_id, full_name, name_key, club)
SELECT DISTINCT ON (x.tournament_id, x.k) x.tournament_id, x.n, x.k, x.club
  FROM (
    SELECT c.tournament_id, p.n, lower(regexp_replace(btrim(normalize(p.n, NFC)), '\s+', ' ', 'g')) AS k, e.club, e.created_at
      FROM entries e JOIN categories c ON c.id = e.category_id
      CROSS JOIN LATERAL (VALUES (e.player1_name), (e.player2_name)) AS p(n)
     WHERE p.n IS NOT NULL
  ) x
 WHERE NOT EXISTS (SELECT 1 FROM athletes a WHERE a.tournament_id = x.tournament_id AND a.name_key = x.k)
 ORDER BY x.tournament_id, x.k, x.created_at;

UPDATE entries e SET player1_athlete_id = a.id
  FROM categories c, athletes a
 WHERE c.id = e.category_id AND a.tournament_id = c.tournament_id AND e.player1_athlete_id IS NULL
   AND a.name_key = lower(regexp_replace(btrim(normalize(e.player1_name, NFC)), '\s+', ' ', 'g'));
UPDATE entries e SET player2_athlete_id = a.id
  FROM categories c, athletes a
 WHERE c.id = e.category_id AND a.tournament_id = c.tournament_id AND e.player2_athlete_id IS NULL
   AND e.player2_name IS NOT NULL
   AND a.name_key = lower(regexp_replace(btrim(normalize(e.player2_name, NFC)), '\s+', ' ', 'g'));

ALTER TABLE tournament_events DROP CONSTRAINT IF EXISTS tournament_events_action_check;
ALTER TABLE tournament_events ADD CONSTRAINT tournament_events_action_check CHECK (action IN
  ('draw', 'redraw', 'disqualify', 'reinstate', 'swap', 'edit_entry', 'schedule',
   'category_create', 'category_update', 'category_delete',
   'call_match', 'uncall_match', 'move_match', 'court_referee', 'athlete_update'));

COMMIT;

-- 001_init.sql — Schema SmashTeam Tournament (database RIÊNG, không dùng chung DB CLB).
-- Idempotent: chạy lại không lỗi. Chạy qua `npm run migrate`.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bản sao tối thiểu của tài khoản SmashTeam, cập nhật mỗi lần SSO.
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY,                 -- = users.id bên SmashTeam
  full_name    TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 255),
  smash_role   TEXT NOT NULL CHECK (smash_role IN ('admin', 'member', 'candidate', 'guest')),
  elo          INTEGER NOT NULL DEFAULT 950 CHECK (elo BETWEEN 0 AND 5000),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chống dùng lại ticket SSO (replay). Dọn bản ghi > 1 ngày bằng job/khởi động.
CREATE TABLE IF NOT EXISTS sso_ticket_uses (
  jti      TEXT PRIMARY KEY CHECK (length(jti) BETWEEN 16 AND 128),
  used_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournaments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 200),
  venue         TEXT NOT NULL DEFAULT '' CHECK (length(venue) <= 200),
  starts_at     TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'ongoing', 'completed')),
  courts        INTEGER NOT NULL DEFAULT 4 CHECK (courts BETWEEN 1 AND 50),
  slot_minutes  INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
  smashteam_event_id UUID,                       -- liên kết club_events.id bên SmashTeam (tuỳ chọn)
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ban tổ chức & trọng tài theo từng giải (admin CLB luôn có toàn quyền).
CREATE TABLE IF NOT EXISTS tournament_staff (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('organizer', 'referee')),
  PRIMARY KEY (tournament_id, user_id)
);

-- Nội dung thi đấu: Đơn nam, Đôi nam nữ...
CREATE TABLE IF NOT EXISTS categories (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id      UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  code               TEXT NOT NULL CHECK (code ~ '^[A-Z0-9]{1,10}$'),
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  is_doubles         BOOLEAN NOT NULL,
  group_count        INTEGER NOT NULL DEFAULT 2 CHECK (group_count BETWEEN 1 AND 32),
  advance_per_group  INTEGER NOT NULL DEFAULT 2 CHECK (advance_per_group BETWEEN 1 AND 4),
  points_to_win      INTEGER NOT NULL DEFAULT 21 CHECK (points_to_win BETWEEN 5 AND 50),
  max_points         INTEGER NOT NULL DEFAULT 30 CHECK (max_points BETWEEN 5 AND 60),
  games_to_win       INTEGER NOT NULL DEFAULT 2 CHECK (games_to_win BETWEEN 1 AND 3),
  stage              TEXT NOT NULL DEFAULT 'setup' CHECK (stage IN ('setup', 'groups', 'knockout', 'completed')),
  UNIQUE (tournament_id, code),
  CHECK (max_points >= points_to_win)
);

CREATE TABLE IF NOT EXISTS entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  player1_name     TEXT NOT NULL CHECK (length(player1_name) BETWEEN 1 AND 120),
  player2_name     TEXT CHECK (player2_name IS NULL OR length(player2_name) BETWEEN 1 AND 120),
  player1_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  player2_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  club             TEXT NOT NULL DEFAULT '' CHECK (length(club) <= 120),
  rating           INTEGER NOT NULL DEFAULT 950 CHECK (rating BETWEEN 0 AND 5000),
  seed             INTEGER CHECK (seed IS NULL OR seed BETWEEN 1 AND 64),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entries_category_idx ON entries(category_id);

CREATE TABLE IF NOT EXISTS groups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 4),
  sort_order   INTEGER NOT NULL,
  UNIQUE (category_id, name)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  entry_id  UUID NOT NULL UNIQUE REFERENCES entries(id) ON DELETE CASCADE, -- 1 đội chỉ ở 1 bảng
  PRIMARY KEY (group_id, entry_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id    UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id      UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  stage            TEXT NOT NULL CHECK (stage IN ('group', 'knockout')),
  group_id         UUID REFERENCES groups(id) ON DELETE CASCADE,
  round            INTEGER NOT NULL CHECK (round >= 1),
  position         INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  entry_a_id       UUID REFERENCES entries(id) ON DELETE CASCADE,
  entry_b_id       UUID REFERENCES entries(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'scheduled', 'live', 'finished', 'walkover', 'bye')),
  games            JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(games) = 'array'),
  winner_entry_id  UUID REFERENCES entries(id) ON DELETE SET NULL,
  court            INTEGER CHECK (court IS NULL OR court BETWEEN 1 AND 50),
  scheduled_at     TIMESTAMPTZ,
  referee_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  next_match_id    UUID REFERENCES matches(id) ON DELETE SET NULL,
  next_slot        CHAR(1) CHECK (next_slot IS NULL OR next_slot IN ('a', 'b')),
  version          INTEGER NOT NULL DEFAULT 1,      -- optimistic locking cho nhập điểm đồng thời
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  CHECK ((stage = 'group') = (group_id IS NOT NULL)),
  CHECK (entry_a_id IS NULL OR entry_a_id <> entry_b_id),
  CHECK (winner_entry_id IS NULL OR winner_entry_id IN (entry_a_id, entry_b_id)),
  CHECK ((status IN ('finished', 'walkover', 'bye')) = (winner_entry_id IS NOT NULL)),
  CHECK ((next_match_id IS NULL) = (next_slot IS NULL))
);
CREATE INDEX IF NOT EXISTS matches_tournament_idx ON matches(tournament_id, scheduled_at);
CREATE INDEX IF NOT EXISTS matches_category_idx ON matches(category_id, stage, round);
CREATE UNIQUE INDEX IF NOT EXISTS matches_knockout_slot_uq
  ON matches(category_id, round, position) WHERE stage = 'knockout';

-- Nhật ký nhập điểm append-only (audit tranh chấp tỉ số).
CREATE TABLE IF NOT EXISTS match_score_events (
  id             BIGSERIAL PRIMARY KEY,
  match_id       UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  actor_user_id  UUID NOT NULL REFERENCES users(id),
  action         TEXT NOT NULL CHECK (action IN ('save', 'finish', 'walkover', 'reopen', 'assign_referee')),
  games          JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_score_events_match_idx ON match_score_events(match_id, id);

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Cho phép xoá dây chuyền khi xoá cả giải (RI trigger → depth > 1); cấm sửa/xoá trực tiếp.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'match_score_events is append-only';
END $$;
DROP TRIGGER IF EXISTS match_score_events_append_only ON match_score_events;
CREATE TRIGGER match_score_events_append_only
  BEFORE UPDATE OR DELETE ON match_score_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

INSERT INTO schema_migrations(version) VALUES ('001_init') ON CONFLICT DO NOTHING;

COMMIT;

-- 005_court_ops.sql — Điều phối theo SÂN (giải phong trào luôn trễ giờ):
--  * matches.called_at: BTC đã "gọi vào sân" (sân đó coi như bận, VĐV coi như đang ở sân) — chưa có điểm.
--  * court_referees: trọng tài phụ trách cả một sân; trận chưa gán trọng tài riêng thì thuộc trọng tài của sân.
--  * Nhật ký BTC thêm thao tác gọi / rút / dời trận và gán trọng tài sân.
-- Idempotent. Runner tự ghi schema_migrations.

BEGIN;

ALTER TABLE matches ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS matches_court_busy_idx ON matches (tournament_id, court)
  WHERE status = 'live' OR called_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS court_referees (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  court         INTEGER NOT NULL CHECK (court BETWEEN 1 AND 50),
  user_id       UUID NOT NULL REFERENCES users(id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, court)
);

ALTER TABLE tournament_events DROP CONSTRAINT IF EXISTS tournament_events_action_check;
ALTER TABLE tournament_events ADD CONSTRAINT tournament_events_action_check CHECK (action IN
  ('draw', 'redraw', 'disqualify', 'reinstate', 'swap', 'edit_entry', 'schedule',
   'category_create', 'category_update', 'category_delete',
   'call_match', 'uncall_match', 'move_match', 'court_referee'));

COMMIT;

-- 010_match_rallies.sql — Biên bản diễn biến điểm:
--  * match_rallies: từng sự kiện của trận theo thứ tự (chọn người giao/nhận, pha cầu, sửa người giao, BTC sửa tay).
--    Chỉ thêm vào cuối; "Hoàn tác" xoá sự kiện cuối. matches.games vẫn là bản cache, cập nhật cùng giao dịch.
--  * Nhật ký BTC thêm: sửa người giao, hoàn tác pha cầu, xác nhận kết quả (không ghi từng điểm).
-- Idempotent. Runner tự ghi schema_migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS match_rallies (
  match_id      UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL CHECK (seq >= 1),
  game          INTEGER NOT NULL CHECK (game BETWEEN 1 AND 5),
  type          TEXT NOT NULL CHECK (type IN ('start', 'point', 'fix_server', 'override')),
  side          TEXT CHECK (side IN ('a', 'b')),
  server_slot   TEXT CHECK (server_slot IN ('a1', 'a2', 'b1', 'b2')),
  receiver_slot TEXT CHECK (receiver_slot IN ('a1', 'a2', 'b1', 'b2')),
  score_a       INTEGER,
  score_b       INTEGER,
  games         JSONB,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seq)
);

ALTER TABLE tournament_events DROP CONSTRAINT IF EXISTS tournament_events_action_check;
ALTER TABLE tournament_events ADD CONSTRAINT tournament_events_action_check CHECK (action IN
  ('draw', 'redraw', 'disqualify', 'reinstate', 'swap', 'edit_entry', 'schedule',
   'category_create', 'category_update', 'category_delete',
   'call_match', 'uncall_match', 'move_match', 'court_referee', 'athlete_update', 'rules_update',
   'referee_create', 'referee_update', 'referee_remove',
   'rally_fix_server', 'rally_undo', 'score_confirm'));

COMMIT;

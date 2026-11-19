-- 007_round_rules.sql — Luật điểm THEO VÒNG trong một nội dung (vd vòng bảng 15 điểm 1 game cho nhanh,
-- loại trực tiếp 21 điểm 2/3 game, chung kết đủ luật BWF).
--  round_rules = { "group": {...}, "knockout": { "*": {...}, "1": {...}, "2": {...} } }
--   "knockout"."*" = mọi vòng loại trực tiếp; "1" = chung kết, "2" = bán kết, "3" = tứ kết, "4" = vòng 1/8…
--   (đếm NGƯỢC từ chung kết nên đặt được trước khi có nhánh, dù nhánh 8 hay 16 đội).
--  Mỗi luật: { "pointsToWin": 5..50, "maxPoints": pointsToWin..60, "gamesToWin": 1..3 } — kiểm tra ở domain/roundRules.js.
--  Không có khoá nào khớp → dùng luật mặc định của nội dung (points_to_win / max_points / games_to_win).
-- Idempotent. Runner tự ghi schema_migrations.

BEGIN;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS round_rules JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_round_rules_object;
ALTER TABLE categories ADD CONSTRAINT categories_round_rules_object CHECK (jsonb_typeof(round_rules) = 'object');

ALTER TABLE tournament_events DROP CONSTRAINT IF EXISTS tournament_events_action_check;
ALTER TABLE tournament_events ADD CONSTRAINT tournament_events_action_check CHECK (action IN
  ('draw', 'redraw', 'disqualify', 'reinstate', 'swap', 'edit_entry', 'schedule',
   'category_create', 'category_update', 'category_delete',
   'call_match', 'uncall_match', 'move_match', 'court_referee', 'athlete_update', 'rules_update'));

COMMIT;

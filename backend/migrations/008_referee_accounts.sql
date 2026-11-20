-- 008_referee_accounts.sql — BTC tạo / sửa / khoá tài khoản trọng tài ngay trong trang quản trị giải.
-- Chỉ thêm loại thao tác vào nhật ký BTC. Idempotent. Runner tự ghi schema_migrations.

BEGIN;

ALTER TABLE tournament_events DROP CONSTRAINT IF EXISTS tournament_events_action_check;
ALTER TABLE tournament_events ADD CONSTRAINT tournament_events_action_check CHECK (action IN
  ('draw', 'redraw', 'disqualify', 'reinstate', 'swap', 'edit_entry', 'schedule',
   'category_create', 'category_update', 'category_delete',
   'call_match', 'uncall_match', 'move_match', 'court_referee', 'athlete_update', 'rules_update',
   'referee_create', 'referee_update', 'referee_remove'));

COMMIT;

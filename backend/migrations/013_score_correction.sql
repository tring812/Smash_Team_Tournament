-- Nhật ký ghi riêng việc sửa kết quả đã chốt, không xoá các bản ghi cũ.
BEGIN;

ALTER TABLE match_score_events DROP CONSTRAINT IF EXISTS match_score_events_action_check;
ALTER TABLE match_score_events ADD CONSTRAINT match_score_events_action_check CHECK (action IN
  ('save', 'finish', 'walkover', 'reopen', 'assign_referee', 'start', 'score_correct'));

ALTER TABLE tournament_events DROP CONSTRAINT IF EXISTS tournament_events_action_check;
ALTER TABLE tournament_events ADD CONSTRAINT tournament_events_action_check CHECK (action IN
  ('draw', 'redraw', 'disqualify', 'reinstate', 'swap', 'edit_entry', 'schedule',
   'category_create', 'category_update', 'category_delete',
   'call_match', 'uncall_match', 'move_match', 'court_referee', 'athlete_update', 'rules_update',
   'referee_create', 'referee_update', 'referee_remove',
   'rally_fix_server', 'rally_undo', 'score_confirm', 'start_match', 'score_correct'));

COMMIT;

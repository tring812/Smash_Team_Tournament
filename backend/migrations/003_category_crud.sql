-- 003_category_crud.sql — BTC sửa/xoá nội dung thi đấu; nhật ký giữ lại khi nội dung bị xoá.
-- Idempotent. Runner tự ghi schema_migrations.

BEGIN;

-- Thêm các thao tác nội dung vào nhật ký BTC.
ALTER TABLE tournament_events DROP CONSTRAINT IF EXISTS tournament_events_action_check;
ALTER TABLE tournament_events ADD CONSTRAINT tournament_events_action_check CHECK (action IN
  ('draw', 'redraw', 'disqualify', 'reinstate', 'swap', 'edit_entry', 'schedule',
   'category_create', 'category_update', 'category_delete'));

-- Xoá nội dung KHÔNG được xoá nhật ký của nó: category_id → NULL (mã nội dung vẫn nằm trong details).
ALTER TABLE tournament_events DROP CONSTRAINT IF EXISTS tournament_events_category_id_fkey;
ALTER TABLE tournament_events ADD CONSTRAINT tournament_events_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;

-- Bảng append-only vẫn cấm sửa/xoá trực tiếp; chỉ cho phép thao tác dây chuyền của khoá ngoại
-- (RI trigger chạy ở depth > 1): xoá cả giải (CASCADE) và SET NULL khi xoá nội dung.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

COMMIT;

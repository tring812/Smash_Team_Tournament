-- 011_tournament_soft_delete.sql — Xoá giải (xoá mềm, khôi phục trong 7 ngày):
--  * tournaments.deleted_at / deleted_by: giải đã xoá biến khỏi mọi danh sách, đường dẫn và quyền thao tác.
--  * Quá 7 ngày máy chủ xoá hẳn (DELETE tournaments → dây chuyền: nội dung, đội, VĐV, trận, biên bản,
--    nhật ký, phân công trọng tài — các bảng con đều ON DELETE CASCADE).
-- Idempotent. Runner tự ghi schema_migrations.

BEGIN;

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tournaments_deleted_idx ON tournaments (deleted_at) WHERE deleted_at IS NOT NULL;

COMMIT;

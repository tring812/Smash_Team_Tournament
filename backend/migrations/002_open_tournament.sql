-- 002_open_tournament.sql — Giải mở rộng: bốc thăm ngẫu nhiên, truất quyền, nhật ký thao tác BTC.
-- Idempotent. Runner tự ghi schema_migrations.

BEGIN;

-- Bốc thăm phụ (phá hoà cuối cùng ở BXH) + truất quyền thi đấu.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS draw_lot INTEGER CHECK (draw_lot IS NULL OR draw_lot >= 1);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS disqualified_at TIMESTAMPTZ;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS dq_reason TEXT CHECK (dq_reason IS NULL OR length(dq_reason) BETWEEN 3 AND 300);

-- Trạng thái 'cancelled': trận vòng bảng bị huỷ do một đội bị truất quyền (không tính vào BXH).
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('pending', 'scheduled', 'live', 'finished', 'walkover', 'bye', 'cancelled'));
-- Trạng thái trước khi huỷ, để khôi phục khi BTC huỷ truất quyền.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS pre_cancel JSONB;

-- Nhật ký thao tác của BTC (bốc thăm, bốc lại, truất quyền, đổi bảng, sửa đội, xếp lịch). Append-only.
CREATE TABLE IF NOT EXISTS tournament_events (
  id             BIGSERIAL PRIMARY KEY,
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id    UUID REFERENCES categories(id) ON DELETE CASCADE,
  actor_user_id  UUID NOT NULL REFERENCES users(id),
  action         TEXT NOT NULL CHECK (action IN
                   ('draw', 'redraw', 'disqualify', 'reinstate', 'swap', 'edit_entry', 'schedule')),
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournament_events_t_idx ON tournament_events(tournament_id, id DESC);

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS tournament_events_append_only ON tournament_events;
CREATE TRIGGER tournament_events_append_only
  BEFORE UPDATE OR DELETE ON tournament_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMIT;

-- Trận tranh hạng Ba–Tư là một trận loại trực tiếp riêng, nhận đội thua từ hai bán kết.
BEGIN;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS third_place BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_third_place BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS loser_next_match_id UUID REFERENCES matches(id) ON DELETE SET NULL;

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_third_place_check;
ALTER TABLE matches ADD CONSTRAINT matches_third_place_check CHECK (
  NOT is_third_place OR (stage = 'knockout' AND next_match_id IS NULL AND loser_next_match_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS matches_third_place_uq ON matches(category_id) WHERE is_third_place;

COMMIT;

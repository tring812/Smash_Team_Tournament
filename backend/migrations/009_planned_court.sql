-- 009_planned_court.sql — "Gọi vào sân" không còn ghi đè giờ / sân dự kiến:
--  * matches.scheduled_at giữ nguyên giờ dự kiến; giờ gọi nằm ở called_at.
--  * matches.planned_court: sân dự kiến lúc được gọi (court = sân đang dùng) → "Rút về" trả lại sân này.
--  * Sửa dữ liệu cũ: trận có scheduled_at vẫn là giờ gọi (±10 giây so với một lần call_match trong nhật ký)
--    lấy lại giờ / sân dự kiến (details.plannedAt / details.fromCourt) — lùi qua các lần gọi lại liên tiếp.
-- Idempotent. Runner tự ghi schema_migrations.

BEGIN;

ALTER TABLE matches ADD COLUMN IF NOT EXISTS planned_court INTEGER;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_planned_court_check;
ALTER TABLE matches ADD CONSTRAINT matches_planned_court_check CHECK (planned_court IS NULL OR planned_court BETWEEN 1 AND 50);

WITH RECURSIVE calls AS (
  SELECT id, details->>'matchId' AS match_id, created_at,
         NULLIF(details->>'plannedAt', '')::timestamptz AS planned_at,
         CASE WHEN details->>'fromCourt' ~ '^[0-9]+$' THEN (details->>'fromCourt')::int END AS planned_court
    FROM tournament_events
   WHERE action = 'call_match' AND details ? 'matchId'
), chain AS (
  -- Lần gọi đã tạo ra giờ hiện tại (scheduled_at = giờ gọi ±10 giây).
  SELECT m.id AS mid, c.id AS cid, c.planned_at, c.planned_court, 0 AS depth
    FROM matches m
    JOIN LATERAL (SELECT * FROM calls c WHERE c.match_id = m.id::text
                    AND abs(extract(epoch FROM c.created_at - m.scheduled_at)) < 10
                  ORDER BY c.id DESC LIMIT 1) c ON true
   WHERE m.planned_court IS NULL AND m.scheduled_at IS NOT NULL
  UNION ALL
  -- Giờ "dự kiến" ghi trong lần gọi đó lại là giờ của một lần gọi trước (gọi → rút → gọi lại) → lùi tiếp.
  SELECT ch.mid, p.id, p.planned_at, p.planned_court, ch.depth + 1
    FROM chain ch
    JOIN LATERAL (SELECT * FROM calls c WHERE c.match_id = ch.mid::text AND c.id < ch.cid
                    AND abs(extract(epoch FROM c.created_at - ch.planned_at)) < 10
                  ORDER BY c.id DESC LIMIT 1) p ON true
   WHERE ch.planned_at IS NOT NULL AND ch.depth < 50
), overwritten AS (
  SELECT DISTINCT ON (ch.mid) ch.mid AS id, ch.planned_at, ch.planned_court,
         -- Trận đang chờ và KHÔNG ở sân (đã rút về) → trả hẳn về sân dự kiến.
         (m.called_at IS NULL AND m.status IN ('pending', 'scheduled')) AS back_in_queue
    FROM chain ch JOIN matches m ON m.id = ch.mid
   ORDER BY ch.mid, ch.depth DESC
)
UPDATE matches m SET
  scheduled_at  = o.planned_at,
  court         = CASE WHEN o.back_in_queue THEN o.planned_court ELSE m.court END,
  planned_court = CASE WHEN o.back_in_queue THEN NULL ELSE o.planned_court END,
  status        = CASE WHEN o.back_in_queue AND o.planned_at IS NULL THEN 'pending' ELSE m.status END
  FROM overwritten o
 WHERE m.id = o.id;

COMMIT;

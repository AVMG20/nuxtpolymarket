-- A one-off gift: runs last settled between midnight and 08:00 (Amsterdam) on 2026-10-13 count from midnight, so their next settle pays the extra as time away.
-- Skipped: a Battle Speed block running past midnight (it would boost the credited hours) and an open raid session (the gap would close it).
UPDATE "hq_state"
SET "last_settled_at" = GREATEST(('2026-10-13 00:00'::timestamp AT TIME ZONE 'Europe/Amsterdam') AT TIME ZONE 'UTC', "created_at")
WHERE "last_settled_at" > ('2026-10-13 00:00'::timestamp AT TIME ZONE 'Europe/Amsterdam') AT TIME ZONE 'UTC'
  AND "last_settled_at" <= ('2026-10-13 08:00'::timestamp AT TIME ZONE 'Europe/Amsterdam') AT TIME ZONE 'UTC'
  AND ("speed_boost_expires_at" IS NULL OR "speed_boost_expires_at" <= ('2026-10-13 00:00'::timestamp AT TIME ZONE 'Europe/Amsterdam') AT TIME ZONE 'UTC')
  AND "pre_raid_snapshot" IS NULL;

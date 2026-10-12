-- The Prestige scene became the Shop (2026-10-10): its tutorials are `shop:*` now, so rename the ones already seen.
UPDATE "hq_state"
SET "tutorials_seen" = (
    SELECT COALESCE(jsonb_agg(
        CASE e
            WHEN 'prestige:unlock' THEN 'shop:unlock'
            WHEN 'prestige:visit' THEN 'shop:visit'
            ELSE e
        END), '[]'::jsonb)
    FROM jsonb_array_elements_text("tutorials_seen") AS e
)
WHERE "tutorials_seen" ?| array['prestige:unlock', 'prestige:visit'];

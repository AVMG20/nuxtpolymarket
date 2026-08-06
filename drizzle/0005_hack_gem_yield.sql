-- Converts the retired gem_bonus / gem_chance stats into the single multiplicative
-- gem_yield stat. Without this, stored rows keep their old values and the new code
-- reads a gem_bonus of 2 as "+2%", while MOD_RANGES / AGENT_TRAIT_RANGES have no
-- entry for the old keys at all — which hard-500s /hack/loadout and /hack/upgrade on
-- `range.max`. It runs from docker-entrypoint.sh before the server accepts traffic.
--
-- Conversion is percentile-preserving but floored at the MIDPOINT of the new band, so
-- no existing roll converts into a below-average one. That costs the endgame economy
-- ~2% (maxed rolls already sit near the band top, so the floor barely binds) and fully
-- protects mid-tier players, who are the ones a straight percentile map would punish.
--
-- Merging two stats into one must never cost a slot: an item or agent carrying BOTH old
-- stats sums the two conversions (capped at the band max) and the freed slot is refilled
-- with a fresh roll of a type it doesn't already have.
--
-- Re-runnable: once converted no gem_bonus/gem_chance rows remain, so every WHERE below
-- matches nothing on a second pass.
--
-- Deliberately carries NO breakpoint markers, unlike the generated schema migrations
-- either side of it. Drizzle splits a file on those markers and runs each piece
-- separately; with none, the whole file goes as one simple query, which Postgres
-- executes as a single implicit transaction — so a failure part way through rolls the
-- entire conversion back instead of leaving half the gear rewritten and half on the old
-- keys. Adding breakpoints here would silently trade that away. Do not write the marker
-- text out even inside a comment: the splitter matches it anywhere in the file and will
-- cut this migration in half.

-- ─── Item mods: old bands gem_bonus [1,3] and gem_chance [0.001,0.02] → [25,40] ──────
WITH legacy AS (
    SELECT
        id,
        (SELECT (m->>'value')::numeric FROM jsonb_array_elements(mods) m WHERE m->>'type' = 'gem_bonus')  AS bonus_val,
        (SELECT (m->>'value')::numeric FROM jsonb_array_elements(mods) m WHERE m->>'type' = 'gem_chance') AS chance_val,
        (SELECT coalesce(jsonb_agg(m), '[]'::jsonb) FROM jsonb_array_elements(mods) m
          WHERE m->>'type' NOT IN ('gem_bonus', 'gem_chance'))                                            AS kept
    FROM hack_items
    WHERE mods @> '[{"type":"gem_bonus"}]' OR mods @> '[{"type":"gem_chance"}]'
), converted AS (
    SELECT
        id, kept, bonus_val, chance_val,
        LEAST(40, round(
            CASE WHEN bonus_val  IS NULL THEN 0 ELSE 25 + 15 * LEAST(1, GREATEST(0, (bonus_val  - 1)     / 2))       END +
            CASE WHEN chance_val IS NULL THEN 0 ELSE 25 + 15 * LEAST(1, GREATEST(0, (chance_val - 0.001) / 0.019))   END
        , 1)) AS yield_val
    FROM legacy
)
UPDATE hack_items i SET mods =
    c.kept
    || jsonb_build_array(jsonb_build_object('type', 'gem_yield', 'value', c.yield_val))
    || CASE WHEN c.bonus_val IS NOT NULL AND c.chance_val IS NOT NULL THEN coalesce((
            -- A slot freed by the merge is refilled so the item keeps its rarity's mod
            -- count. coalesce guards the array concat: `jsonb || NULL` is NULL, which
            -- would blank the whole mods column rather than skip the refill.
            SELECT jsonb_build_array(jsonb_build_object(
                'type', t.type,
                'value', round((t.lo + random() * (t.hi - t.lo))::numeric, t.dec)))
            FROM (VALUES
                ('loot_percent',  1::numeric, 12::numeric,   1),
                ('speed_percent', 1::numeric, 12::numeric,   1),
                ('xp_flat',       1::numeric, 7::numeric,    0),
                ('power_flat',    4::numeric, 28::numeric,   0),
                ('item_chance',   0.01::numeric, 0.10::numeric, 3)
            ) AS t(type, lo, hi, dec)
            WHERE NOT (c.kept @> jsonb_build_array(jsonb_build_object('type', t.type)))
            ORDER BY random() LIMIT 1
        ), '[]'::jsonb) ELSE '[]'::jsonb END
FROM converted c
WHERE i.id = c.id;

-- ─── Agent traits: old bands gem_bonus [1,3] and gem_chance [0.005,0.05] → [35,60] ──
WITH legacy AS (
    SELECT
        id,
        (SELECT (t->>'value')::numeric FROM jsonb_array_elements(traits) t WHERE t->>'type' = 'gem_bonus')  AS bonus_val,
        (SELECT (t->>'value')::numeric FROM jsonb_array_elements(traits) t WHERE t->>'type' = 'gem_chance') AS chance_val,
        (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM jsonb_array_elements(traits) t
          WHERE t->>'type' NOT IN ('gem_bonus', 'gem_chance'))                                             AS kept
    FROM hack_agents
    WHERE traits @> '[{"type":"gem_bonus"}]' OR traits @> '[{"type":"gem_chance"}]'
), converted AS (
    SELECT
        id, kept, bonus_val, chance_val,
        LEAST(60, round(
            CASE WHEN bonus_val  IS NULL THEN 0 ELSE 35 + 25 * LEAST(1, GREATEST(0, (bonus_val  - 1)     / 2))       END +
            CASE WHEN chance_val IS NULL THEN 0 ELSE 35 + 25 * LEAST(1, GREATEST(0, (chance_val - 0.005) / 0.045))   END
        , 1)) AS yield_val
    FROM legacy
)
UPDATE hack_agents a SET traits =
    c.kept
    || jsonb_build_array(jsonb_build_object('type', 'gem_yield', 'value', c.yield_val))
    || CASE WHEN c.bonus_val IS NOT NULL AND c.chance_val IS NOT NULL THEN coalesce((
            SELECT jsonb_build_array(jsonb_build_object(
                'type', t.type,
                'value', round((t.lo + random() * (t.hi - t.lo))::numeric, t.dec)))
            FROM (VALUES
                ('speed_percent', 3::numeric,  10::numeric, 1),
                ('loot_percent',  3::numeric,  6::numeric,  1),
                ('xp_boost',      5::numeric,  50::numeric, 0),
                ('power_flat',    10::numeric, 60::numeric, 0),
                ('power_percent', 5::numeric,  30::numeric, 0)
            ) AS t(type, lo, hi, dec)
            WHERE NOT (c.kept @> jsonb_build_array(jsonb_build_object('type', t.type)))
            ORDER BY random() LIMIT 1
        ), '[]'::jsonb) ELSE '[]'::jsonb END
FROM converted c
WHERE a.id = c.id;

-- ─── Unapplied artifact stacks ──────────────────────────────────────────────────────
-- Applied artifacts need no work: artifacts/apply.post.ts folds their value straight
-- into the agent's trait, so the trait conversion above already carried them across.
-- Merge BEFORE retyping. A user holding gem_bonus and gem_chance at the same rarity
-- would, under a blind retype, momentarily hold two gem_yield stacks on the same
-- (user_id, trait_type, rarity) — which aborts the whole migration on any database
-- carrying a unique index there, and `set -e` in docker-entrypoint.sh then stops the
-- container booting at all. Summing into a survivor and dropping the rest first means
-- that duplicate never exists, with or without the index.

-- 1. Sum every gem-flavoured stack into the survivor. count is not part of any index,
--    so this is safe to do while the old trait_type values are still in place.
UPDATE hack_artifacts a SET count = s.total
FROM (
    SELECT user_id, rarity, sum(count) AS total, min(id) AS keep_id
    FROM hack_artifacts WHERE trait_type IN ('gem_bonus', 'gem_chance', 'gem_yield')
    GROUP BY user_id, rarity
) s
WHERE a.id = s.keep_id AND a.count <> s.total;

-- 2. Drop the stacks whose counts were just absorbed.
DELETE FROM hack_artifacts a
USING (
    SELECT user_id, rarity, min(id) AS keep_id
    FROM hack_artifacts WHERE trait_type IN ('gem_bonus', 'gem_chance', 'gem_yield')
    GROUP BY user_id, rarity
) s
WHERE a.trait_type IN ('gem_bonus', 'gem_chance', 'gem_yield')
  AND a.user_id = s.user_id AND a.rarity = s.rarity AND a.id <> s.keep_id;

-- 3. Retype the survivors, now provably one per (user_id, rarity).
UPDATE hack_artifacts SET trait_type = 'gem_yield' WHERE trait_type IN ('gem_bonus', 'gem_chance');

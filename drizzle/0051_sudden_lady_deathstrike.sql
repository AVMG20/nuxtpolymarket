-- Monuments replace the Polytown research board. Each branch became one
-- monument whose first six stages give exactly what the branch's six projects
-- gave, so before the board's tables go, every mayor is credited their
-- furthest project in each branch as a monument stage. Placing that monument
-- later puts it up at the credited stage at once, for free. A project still
-- running was already paid for, so it counts as finished.
WITH branches(branch, monument) AS (
	VALUES
		('yield', 'eiffel'),
		('logistics', 'arc'),
		('construction', 'pyramid'),
		('civics', 'colosseum'),
		('trade', 'lighthouse')
),
projects AS (
	SELECT "user_id", "research_id" FROM "town_research"
	UNION
	SELECT "user_id", "research_id" FROM "town_state" WHERE "research_id" IS NOT NULL
),
furthest AS (
	SELECT p."user_id", b."monument", max(split_part(p."research_id", '-', 2)::int) AS "stage"
	FROM projects p
	JOIN branches b ON b."branch" = split_part(p."research_id", '-', 1)
	WHERE p."research_id" ~ '^[a-z]+-[1-6]$'
	GROUP BY p."user_id", b."monument"
),
credit AS (
	SELECT "user_id", jsonb_object_agg("monument", "stage") AS "stages" FROM furthest GROUP BY "user_id"
)
UPDATE "town_state" s SET "monument_credit" = c."stages"
FROM credit c WHERE s."user_id" = c."user_id";--> statement-breakpoint
DELETE FROM "town_events" WHERE "kind" = 'research';--> statement-breakpoint
DROP TABLE "town_research" CASCADE;--> statement-breakpoint
ALTER TABLE "town_state" DROP COLUMN "research_id";--> statement-breakpoint
ALTER TABLE "town_state" DROP COLUMN "research_completes_at";

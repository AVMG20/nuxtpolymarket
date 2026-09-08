ALTER TABLE "town_state" ALTER COLUMN "builders" SET DEFAULT 3;
--> statement-breakpoint
-- Towns founded on two crews get the third for free along with everyone else.
UPDATE "town_state" SET "builders" = 3 WHERE "builders" = 2;

CREATE TABLE "colony_builder_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "colony_builder_jobs_unique" UNIQUE("user_id","track_id")
);
--> statement-breakpoint
ALTER TABLE "colony_builder_jobs" ADD CONSTRAINT "colony_builder_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "colony_builder_jobs_userId_idx" ON "colony_builder_jobs" USING btree ("user_id");--> statement-breakpoint
-- Carry every builder that is mid-job right now into the new table BEFORE the
-- columns holding it are dropped. Without this, anyone with construction in
-- flight at deploy time silently loses the coins and items they already paid.
INSERT INTO "colony_builder_jobs" ("id", "user_id", "track_id", "started_at")
SELECT gen_random_uuid()::text, "user_id", "builder_track_id", "builder_started_at"
FROM "colony_state"
WHERE "builder_track_id" IS NOT NULL AND "builder_started_at" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "colony_state" DROP COLUMN "builder_track_id";--> statement-breakpoint
ALTER TABLE "colony_state" DROP COLUMN "builder_started_at";
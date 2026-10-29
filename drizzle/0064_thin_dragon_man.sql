CREATE TABLE "riftborn_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"shards" integer DEFAULT 0 NOT NULL,
	"unlocked_classes" jsonb DEFAULT '["knight"]'::jsonb NOT NULL,
	"meta_levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"victories" integer DEFAULT 0 NOT NULL,
	"best_time" integer DEFAULT 0 NOT NULL,
	"best_kills" integer DEFAULT 0 NOT NULL,
	"best_level" integer DEFAULT 0 NOT NULL,
	"total_kills" integer DEFAULT 0 NOT NULL,
	"total_shards_earned" integer DEFAULT 0 NOT NULL,
	"total_coins_earned" numeric(19, 4) DEFAULT '0' NOT NULL,
	"run_id" text,
	"run_class" text,
	"run_started_at" timestamp,
	"run_meta" jsonb,
	CONSTRAINT "riftborn_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "riftborn_state" ADD CONSTRAINT "riftborn_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
-- The first Void Runner prototype was only ever db:push-ed; clear any leftovers.
DROP TABLE IF EXISTS "void_weapons", "void_run_history", "void_state" CASCADE;--> statement-breakpoint
CREATE TABLE "void_run_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sector" integer DEFAULT 1 NOT NULL,
	"ship_id" text DEFAULT 'sparrow' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"haul" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"haul_value" integer DEFAULT 0 NOT NULL,
	"extracted" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"warden_killed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "void_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owned_ship_ids" jsonb DEFAULT '["sparrow"]'::jsonb NOT NULL,
	"equipped_ship_id" text DEFAULT 'sparrow' NOT NULL,
	"loadouts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unlocked_turrets" jsonb DEFAULT '["pulse"]'::jsonb NOT NULL,
	"unlocked_guns" jsonb DEFAULT '["blaster"]'::jsonb NOT NULL,
	"equipped_gun" text DEFAULT 'blaster' NOT NULL,
	"upgrade_levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"highest_sector_cleared" integer DEFAULT 0 NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"extractions" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"wardens_killed" integer DEFAULT 0 NOT NULL,
	"best_haul_value" integer DEFAULT 0 NOT NULL,
	"total_sold" bigint DEFAULT 0 NOT NULL,
	"run_started_at" timestamp,
	"run_sector" integer,
	"run_ship_id" text,
	"run_cargo" integer,
	CONSTRAINT "void_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "void_run_history" ADD CONSTRAINT "void_run_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "void_state" ADD CONSTRAINT "void_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "void_run_history_userId_createdAt_idx" ON "void_run_history" USING btree ("user_id","created_at");
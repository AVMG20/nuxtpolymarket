CREATE TABLE "hq_arena_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"opponent_user_id" text,
	"role" text NOT NULL,
	"won" boolean NOT NULL,
	"rating_change" integer DEFAULT 0 NOT NULL,
	"medals_earned" integer DEFAULT 0 NOT NULL,
	"is_dummy" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hq_arena_season_results" (
	"id" text PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"rank" integer NOT NULL,
	"medals" integer NOT NULL,
	"claimed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "hq_arena_season_results_unique" UNIQUE("season_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hq_arena_seasons" (
	"season_id" integer PRIMARY KEY NOT NULL,
	"closed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "global_power_number" text;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "defense_loadout" jsonb;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "defense_gpn" text;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_rating" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_season_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_season_matches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_medals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_attempts_used_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_extra_attempts_purchased_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_attempt_date" text;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_refreshes_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_refresh_date" text;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "arena_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_arena_log" ADD CONSTRAINT "hq_arena_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_arena_log" ADD CONSTRAINT "hq_arena_log_opponent_user_id_user_id_fk" FOREIGN KEY ("opponent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_arena_season_results" ADD CONSTRAINT "hq_arena_season_results_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hq_arena_log_userId_createdAt_idx" ON "hq_arena_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "hq_arena_season_results_userId_idx" ON "hq_arena_season_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_state_arena_rating_idx" ON "hq_state" USING btree ("arena_season_id","arena_rating");
CREATE TABLE "meadowbrawl_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"weapon" text NOT NULL,
	"pet" text,
	"waves_cleared" integer DEFAULT 0 NOT NULL,
	"won" boolean DEFAULT false NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"awarded" integer DEFAULT 0 NOT NULL,
	"capped" boolean DEFAULT false NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meadowbrawl_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"prosperity_level" integer DEFAULT 0 NOT NULL,
	"pet_levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_pet" text,
	"unlocked_weapons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"best_wave_by_weapon" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"victories" integer DEFAULT 0 NOT NULL,
	"total_earned" numeric(19, 4) DEFAULT '0' NOT NULL,
	"best_earned" integer DEFAULT 0 NOT NULL,
	"best_wave" integer DEFAULT 0 NOT NULL,
	"run_started_at" timestamp,
	"run_weapon" text,
	"run_pet" text,
	"run_pet_level" integer DEFAULT 0 NOT NULL,
	"run_coin_mult" numeric(10, 4),
	"run_save" jsonb,
	"run_save_revision" integer DEFAULT 0 NOT NULL,
	"last_run_finished_at" timestamp,
	CONSTRAINT "meadowbrawl_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "meadowbrawl_runs" ADD CONSTRAINT "meadowbrawl_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meadowbrawl_state" ADD CONSTRAINT "meadowbrawl_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meadowbrawl_runs_userId_createdAt_idx" ON "meadowbrawl_runs" USING btree ("user_id","created_at");
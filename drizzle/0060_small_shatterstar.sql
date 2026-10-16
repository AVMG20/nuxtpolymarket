CREATE TABLE "hackerz_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"save_version" integer NOT NULL,
	"run_state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hackerz_runs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "hackerz_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bulwark_level" integer DEFAULT 0 NOT NULL,
	"munitions_level" integer DEFAULT 0 NOT NULL,
	"foundry_level" integer DEFAULT 0 NOT NULL,
	"grant_level" integer DEFAULT 0 NOT NULL,
	"salvage_level" integer DEFAULT 0 NOT NULL,
	"capacitor_level" integer DEFAULT 0 NOT NULL,
	"charter_level" integer DEFAULT 0 NOT NULL,
	"arsenal_level" integer DEFAULT 0 NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"total_coins_earned" numeric(19, 4) DEFAULT '0' NOT NULL,
	"best_wave" integer DEFAULT 0 NOT NULL,
	"best_kills" integer DEFAULT 0 NOT NULL,
	"best_payout" integer DEFAULT 0 NOT NULL,
	"victories" integer DEFAULT 0 NOT NULL,
	"run_started_at" timestamp,
	"run_difficulty_snapshot" text,
	"run_power_snapshot" integer,
	"run_coin_multiplier_snapshot" numeric(10, 4),
	"last_run_finished_at" timestamp,
	CONSTRAINT "hackerz_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "hackerz_runs" ADD CONSTRAINT "hackerz_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hackerz_state" ADD CONSTRAINT "hackerz_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
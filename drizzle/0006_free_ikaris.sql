CREATE TABLE "call_of_xeno_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"war_chest_level" integer DEFAULT 0 NOT NULL,
	"body_armor_level" integer DEFAULT 0 NOT NULL,
	"adrenaline_level" integer DEFAULT 0 NOT NULL,
	"scavenger_level" integer DEFAULT 0 NOT NULL,
	"contract_level" integer DEFAULT 0 NOT NULL,
	"sidearm_level" integer DEFAULT 0 NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"total_earned" numeric(19, 4) DEFAULT '0' NOT NULL,
	"best_earned" integer DEFAULT 0 NOT NULL,
	"best_round_recruit" integer DEFAULT 0 NOT NULL,
	"best_round_veteran" integer DEFAULT 0 NOT NULL,
	"best_round_survivor" integer DEFAULT 0 NOT NULL,
	"best_round_nightmare" integer DEFAULT 0 NOT NULL,
	"run_started_at" timestamp,
	"run_difficulty_snapshot" text,
	"run_payout_mult_snapshot" numeric(10, 4),
	"last_run_finished_at" timestamp,
	CONSTRAINT "call_of_xeno_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "call_of_xeno_state" ADD CONSTRAINT "call_of_xeno_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
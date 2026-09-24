CREATE TABLE "gold_miner_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"best_level" integer DEFAULT 0 NOT NULL,
	"best_payout" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total_staked" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total_paid" numeric(19, 4) DEFAULT '0' NOT NULL,
	"phase" text,
	"stake" numeric(19, 4) DEFAULT '0' NOT NULL,
	"secret" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"cash" integer DEFAULT 0 NOT NULL,
	"dynamite" integer DEFAULT 0 NOT NULL,
	"strength" boolean DEFAULT false NOT NULL,
	"clover" boolean DEFAULT false NOT NULL,
	"book" boolean DEFAULT false NOT NULL,
	"polish" boolean DEFAULT false NOT NULL,
	"level_starts_at" timestamp,
	"offers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bought" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gold_miner_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "gold_miner_state" ADD CONSTRAINT "gold_miner_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
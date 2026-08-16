ALTER TABLE "call_of_xeno_state" ADD COLUMN "best_run_rounds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "call_of_xeno_state" ADD COLUMN "best_run_duration_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "call_of_xeno_state" ADD COLUMN "best_run_difficulty" text;
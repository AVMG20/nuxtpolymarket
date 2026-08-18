ALTER TABLE "call_of_xeno_state" ADD COLUMN "run_save" jsonb;--> statement-breakpoint
ALTER TABLE "call_of_xeno_state" ADD COLUMN "run_save_revision" integer DEFAULT 0 NOT NULL;
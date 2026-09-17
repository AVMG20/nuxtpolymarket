ALTER TABLE "void_state" ADD COLUMN "supplies" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "run_supplies" jsonb;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "contracts_day" text;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "contracts_done" jsonb DEFAULT '[]'::jsonb NOT NULL;
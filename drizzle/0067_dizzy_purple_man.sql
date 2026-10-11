ALTER TABLE "hq_state" ADD COLUMN "passive_tree" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "passive_respec_free" boolean DEFAULT false NOT NULL;
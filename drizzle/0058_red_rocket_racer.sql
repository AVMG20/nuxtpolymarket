ALTER TABLE "hq_loadouts" ADD COLUMN "ascendant_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "prestiged_class_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "ascendant_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
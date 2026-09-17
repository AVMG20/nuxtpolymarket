ALTER TABLE "void_state" ADD COLUMN "pilot_xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "unlocked_skills" jsonb DEFAULT '["seeker"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "equipped_skill" text DEFAULT 'seeker' NOT NULL;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "skill_nodes" jsonb DEFAULT '{}'::jsonb NOT NULL;
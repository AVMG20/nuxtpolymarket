ALTER TABLE "void_state" ADD COLUMN "marks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "perks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "blueprints" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "lore" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "void_state" ADD COLUMN "rewards_day" text;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "marks_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "blueprints_today" integer DEFAULT 0 NOT NULL;
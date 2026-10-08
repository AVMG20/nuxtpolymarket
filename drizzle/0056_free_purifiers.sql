ALTER TABLE "hq_state" ADD COLUMN "calendar_start" integer;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "calendar_claimed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "calendar_makeups" integer DEFAULT 0 NOT NULL;
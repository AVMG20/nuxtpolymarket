ALTER TABLE "rail_tycoon_worlds" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rail_tycoon_worlds" ADD COLUMN "avatar" text;--> statement-breakpoint
CREATE INDEX "rail_tycoon_worlds_public_idx" ON "rail_tycoon_worlds" USING btree ("last_active_at") WHERE "rail_tycoon_worlds"."is_public" and "rail_tycoon_worlds"."status" = 'open';
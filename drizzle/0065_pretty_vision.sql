ALTER TABLE "riftborn_state" ADD COLUMN "xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "riftborn_state" ADD COLUMN "achievements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "riftborn_state" ADD COLUMN "skills" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "riftborn_state" ADD COLUMN "run_skills" jsonb;--> statement-breakpoint
ALTER TABLE "riftborn_state" DROP COLUMN "shards";--> statement-breakpoint
ALTER TABLE "riftborn_state" DROP COLUMN "unlocked_classes";--> statement-breakpoint
ALTER TABLE "riftborn_state" DROP COLUMN "meta_levels";--> statement-breakpoint
ALTER TABLE "riftborn_state" DROP COLUMN "total_shards_earned";--> statement-breakpoint
ALTER TABLE "riftborn_state" DROP COLUMN "total_coins_earned";--> statement-breakpoint
ALTER TABLE "riftborn_state" DROP COLUMN "run_meta";
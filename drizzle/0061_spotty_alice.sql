ALTER TABLE "hq_state" ADD COLUMN "raid_loadout_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hq_state" ADD COLUMN "pre_raid_snapshot" jsonb;
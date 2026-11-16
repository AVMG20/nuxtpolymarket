ALTER TABLE "nitro_rush_tracks" ADD COLUMN "unpublished_at" timestamp;--> statement-breakpoint
ALTER TABLE "nitro_rush_tracks" ADD COLUMN "road_hash" text;--> statement-breakpoint
CREATE INDEX "nitro_rush_tracks_author_road_idx" ON "nitro_rush_tracks" USING btree ("author_id","road_hash");
CREATE TABLE "nitro_rush_plays" (
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"laps" integer NOT NULL,
	"last_lap_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nitro_rush_plays_user_id_track_id_pk" PRIMARY KEY("user_id","track_id")
);
--> statement-breakpoint
ALTER TABLE "nitro_rush_track_votes" DROP CONSTRAINT "nitro_rush_track_votes_track_id_nitro_rush_tracks_id_fk";
--> statement-breakpoint
ALTER TABLE "nitro_rush_plays" ADD CONSTRAINT "nitro_rush_plays_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nitro_rush_plays_track_idx" ON "nitro_rush_plays" USING btree ("track_id","last_lap_at");--> statement-breakpoint
-- Every best lap on the board counts as one play, so courses have a popularity from day one.
INSERT INTO "nitro_rush_plays" ("user_id", "track_id", "laps", "last_lap_at")
SELECT "user_id", "track_id", 1, "set_at" FROM "nitro_rush_laps"
ON CONFLICT DO NOTHING;

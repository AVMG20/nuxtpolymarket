CREATE TABLE "nitro_rush_track_votes" (
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"value" smallint NOT NULL,
	CONSTRAINT "nitro_rush_track_votes_user_id_track_id_pk" PRIMARY KEY("user_id","track_id"),
	CONSTRAINT "nitro_rush_track_votes_value_check" CHECK ("nitro_rush_track_votes"."value" in (-1, 1))
);
--> statement-breakpoint
ALTER TABLE "nitro_rush_track_votes" ADD CONSTRAINT "nitro_rush_track_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitro_rush_track_votes" ADD CONSTRAINT "nitro_rush_track_votes_track_id_nitro_rush_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."nitro_rush_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nitro_rush_track_votes_track_idx" ON "nitro_rush_track_votes" USING btree ("track_id");
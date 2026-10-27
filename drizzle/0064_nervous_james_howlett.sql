CREATE TABLE "nitro_rush_laps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"lap_ms" integer NOT NULL,
	"set_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nitro_rush_laps" ADD CONSTRAINT "nitro_rush_laps_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nitro_rush_laps_user_track_idx" ON "nitro_rush_laps" USING btree ("user_id","track_id");--> statement-breakpoint
CREATE INDEX "nitro_rush_laps_track_lap_idx" ON "nitro_rush_laps" USING btree ("track_id","lap_ms");
CREATE TABLE "nitro_rush_ghosts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"lap_ms" integer NOT NULL,
	"standing" boolean DEFAULT false NOT NULL,
	"ghost" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nitro_rush_laps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"lap_ms" integer NOT NULL,
	"set_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nitro_rush_track_votes" (
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"value" smallint NOT NULL,
	CONSTRAINT "nitro_rush_track_votes_user_id_track_id_pk" PRIMARY KEY("user_id","track_id"),
	CONSTRAINT "nitro_rush_track_votes_value_check" CHECK ("nitro_rush_track_votes"."value" in (-1, 1))
);
--> statement-breakpoint
CREATE TABLE "nitro_rush_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"closed" boolean NOT NULL,
	"sections" jsonb NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nitro_rush_ghosts" ADD CONSTRAINT "nitro_rush_ghosts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitro_rush_laps" ADD CONSTRAINT "nitro_rush_laps_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitro_rush_track_votes" ADD CONSTRAINT "nitro_rush_track_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitro_rush_track_votes" ADD CONSTRAINT "nitro_rush_track_votes_track_id_nitro_rush_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."nitro_rush_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitro_rush_tracks" ADD CONSTRAINT "nitro_rush_tracks_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nitro_rush_ghosts_user_track_idx" ON "nitro_rush_ghosts" USING btree ("user_id","track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nitro_rush_laps_user_track_idx" ON "nitro_rush_laps" USING btree ("user_id","track_id");--> statement-breakpoint
CREATE INDEX "nitro_rush_laps_track_lap_idx" ON "nitro_rush_laps" USING btree ("track_id","lap_ms");--> statement-breakpoint
CREATE INDEX "nitro_rush_track_votes_track_idx" ON "nitro_rush_track_votes" USING btree ("track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nitro_rush_tracks_author_source_idx" ON "nitro_rush_tracks" USING btree ("author_id","source_id");--> statement-breakpoint
CREATE INDEX "nitro_rush_tracks_published_idx" ON "nitro_rush_tracks" USING btree ("published_at");
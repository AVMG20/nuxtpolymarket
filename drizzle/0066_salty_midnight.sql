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
ALTER TABLE "nitro_rush_tracks" ADD CONSTRAINT "nitro_rush_tracks_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nitro_rush_tracks_author_source_idx" ON "nitro_rush_tracks" USING btree ("author_id","source_id");--> statement-breakpoint
CREATE INDEX "nitro_rush_tracks_published_idx" ON "nitro_rush_tracks" USING btree ("published_at");
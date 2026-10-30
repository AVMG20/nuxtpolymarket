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
ALTER TABLE "nitro_rush_ghosts" ADD CONSTRAINT "nitro_rush_ghosts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nitro_rush_ghosts_user_track_idx" ON "nitro_rush_ghosts" USING btree ("user_id","track_id");
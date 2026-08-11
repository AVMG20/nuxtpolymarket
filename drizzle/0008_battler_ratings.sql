CREATE TABLE "tcg_battler_ratings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"rating" integer DEFAULT 1000 NOT NULL,
	"fights" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_battler_ratings" ADD CONSTRAINT "tcg_battler_ratings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
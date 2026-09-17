CREATE TABLE "town_production" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resource" text NOT NULL,
	"amount" integer NOT NULL,
	"from_at" timestamp NOT NULL,
	"to_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "town_production" ADD CONSTRAINT "town_production_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "town_production_user_to_idx" ON "town_production" USING btree ("user_id","to_at");
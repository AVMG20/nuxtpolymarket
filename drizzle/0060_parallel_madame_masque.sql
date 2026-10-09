CREATE TABLE "hq_holiday_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"holiday_id" text NOT NULL,
	"year" integer NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hq_holiday_claims" ADD CONSTRAINT "hq_holiday_claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hq_holiday_claims_user_holiday_year_idx" ON "hq_holiday_claims" USING btree ("user_id","holiday_id","year");--> statement-breakpoint
CREATE INDEX "hq_holiday_claims_userId_idx" ON "hq_holiday_claims" USING btree ("user_id");
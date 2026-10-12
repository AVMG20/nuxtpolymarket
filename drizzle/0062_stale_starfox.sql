CREATE TABLE "hq_raid_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"raid_id" text NOT NULL,
	"highest_level" integer DEFAULT 0 NOT NULL,
	"key_balance" integer DEFAULT 3 NOT NULL,
	"last_key_grant_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hq_raid_state" ADD CONSTRAINT "hq_raid_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hq_raid_state_user_raid_idx" ON "hq_raid_state" USING btree ("user_id","raid_id");--> statement-breakpoint
CREATE INDEX "hq_raid_state_userId_idx" ON "hq_raid_state" USING btree ("user_id");
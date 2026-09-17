-- The two ADD COLUMNs below take ACCESS EXCLUSIVE on "user", and the foreign
-- key locks it too. A migration that waits for those locks also queues every
-- request behind itself, so a busy moment turns a deploy into an outage rather
-- than a failed deploy. Giving up instead leaves the previous container serving.
SET lock_timeout = '15s';
--> statement-breakpoint
CREATE TABLE "prestige_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "prestige_purchases_unique" UNIQUE("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "prestige" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "prestige_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prestige_purchases" ADD CONSTRAINT "prestige_purchases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prestige_purchases_userId_idx" ON "prestige_purchases" USING btree ("user_id");
CREATE TABLE "caravan_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"last_tick" bigint DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "caravan_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "caravan_state" ADD CONSTRAINT "caravan_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "caravan_state_user_id_idx" ON "caravan_state" USING btree ("user_id");
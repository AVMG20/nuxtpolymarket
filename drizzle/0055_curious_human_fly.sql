CREATE TABLE "town_redesign_drafts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"draft" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "town_storage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"level" integer NOT NULL,
	"upgrading_to" integer,
	"remaining_ms" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"stored_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "town_redesign_drafts" ADD CONSTRAINT "town_redesign_drafts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_storage" ADD CONSTRAINT "town_storage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "town_storage_userId_idx" ON "town_storage" USING btree ("user_id");
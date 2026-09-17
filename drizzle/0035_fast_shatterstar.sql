CREATE TABLE "void_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"type" text NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"rarity" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"affixes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mod" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "mods" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "void_state" ADD COLUMN "starter_granted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "void_items" ADD CONSTRAINT "void_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "void_items_userId_idx" ON "void_items" USING btree ("user_id");
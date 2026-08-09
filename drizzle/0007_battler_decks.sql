CREATE TABLE "tcg_battler_decks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"cards" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_battler_runs" ADD COLUMN "deck_id" text;--> statement-breakpoint
ALTER TABLE "tcg_battler_runs" ADD COLUMN "deck_name" text;--> statement-breakpoint
ALTER TABLE "tcg_battler_decks" ADD CONSTRAINT "tcg_battler_decks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tcg_battler_decks_userId_idx" ON "tcg_battler_decks" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tcg_battler_runs" ADD CONSTRAINT "tcg_battler_runs_deck_id_tcg_battler_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."tcg_battler_decks"("id") ON DELETE set null ON UPDATE no action;
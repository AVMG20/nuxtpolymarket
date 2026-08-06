-- Re-runnable, unlike ordinary generated output. An earlier revision of this
-- migration shipped under a different name and already created the table on
-- every pull request preview that deployed the branch before the renumbering,
-- and those databases persist across redeploys. Recording it under the new
-- timestamp is what a fresh apply does, so the statements have to be no-ops
-- where the objects are already there.
CREATE TABLE IF NOT EXISTS "table_wagers" (
	"id" text PRIMARY KEY NOT NULL,
	"game" text NOT NULL,
	"user_id" text NOT NULL,
	"round_id" integer NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"kind" text NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "table_wagers" ADD CONSTRAINT "table_wagers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "table_wagers_settled_createdAt_idx" ON "table_wagers" USING btree ("settled","created_at");

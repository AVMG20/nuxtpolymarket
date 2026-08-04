CREATE TABLE "table_wagers" (
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
ALTER TABLE "table_wagers" ADD CONSTRAINT "table_wagers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_wagers_settled_createdAt_idx" ON "table_wagers" USING btree ("settled","created_at");
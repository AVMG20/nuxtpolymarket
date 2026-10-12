CREATE TABLE "neighcasso_horses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"drawing" jsonb NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"races" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "neighcasso_horses" ADD CONSTRAINT "neighcasso_horses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "neighcasso_horses_userId_idx" ON "neighcasso_horses" USING btree ("user_id","updated_at");
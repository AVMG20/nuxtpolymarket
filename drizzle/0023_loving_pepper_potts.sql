CREATE TABLE "town_research" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"research_id" text NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "town_research_user_project" UNIQUE("user_id","research_id")
);
--> statement-breakpoint
ALTER TABLE "town_state" ADD COLUMN "research_id" text;--> statement-breakpoint
ALTER TABLE "town_state" ADD COLUMN "research_completes_at" timestamp;--> statement-breakpoint
ALTER TABLE "town_research" ADD CONSTRAINT "town_research_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
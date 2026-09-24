CREATE TABLE "holdfast_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"difficulty" text NOT NULL,
	"seed" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"survived_ms" integer,
	"won" boolean DEFAULT false NOT NULL,
	"clamped" boolean DEFAULT false NOT NULL,
	"abandoned" boolean DEFAULT false NOT NULL,
	"stats" jsonb
);
--> statement-breakpoint
ALTER TABLE "holdfast_runs" ADD CONSTRAINT "holdfast_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holdfast_runs_difficulty_survivedMs_idx" ON "holdfast_runs" USING btree ("difficulty","survived_ms");--> statement-breakpoint
CREATE INDEX "holdfast_runs_userId_idx" ON "holdfast_runs" USING btree ("user_id");
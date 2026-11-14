CREATE TABLE "gridworks_plot" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"seed" integer NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stock" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"research_done" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"research_queue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"research_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mine" jsonb DEFAULT '{"tokens":0,"at":0}'::jsonb NOT NULL,
	"layout_version" integer DEFAULT 1 NOT NULL,
	"last_settled_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gridworks_plot_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "gridworks_plot" ADD CONSTRAINT "gridworks_plot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
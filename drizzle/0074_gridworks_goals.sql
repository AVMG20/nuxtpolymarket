ALTER TABLE "gridworks_plot" ADD COLUMN "goals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gridworks_plot" ADD COLUMN "mined" integer DEFAULT 0 NOT NULL;
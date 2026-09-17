ALTER TABLE "town_plots" DROP CONSTRAINT "town_plots_spiral_index_unique";--> statement-breakpoint
ALTER TABLE "town_plots" DROP COLUMN "spiral_index";--> statement-breakpoint
ALTER TABLE "town_plots" ADD CONSTRAINT "town_plots_xy_unique" UNIQUE("x","y");
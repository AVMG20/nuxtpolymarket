ALTER TABLE "town_state" ADD COLUMN "build_boost_until" timestamp;--> statement-breakpoint
ALTER TABLE "town_state" ADD COLUMN "production_boost_until" timestamp;--> statement-breakpoint
ALTER TABLE "town_state" ADD COLUMN "temp_builder_until" timestamp;--> statement-breakpoint
ALTER TABLE "town_state" ADD COLUMN "market_boost_until" timestamp;--> statement-breakpoint
ALTER TABLE "town_state" ADD COLUMN "market_boost_bonus_left" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "town_streak" ADD COLUMN "lucky" integer DEFAULT 0 NOT NULL;
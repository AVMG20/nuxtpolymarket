DROP INDEX "town_inventory_userId_idx";--> statement-breakpoint
ALTER TABLE "town_inventory" ALTER COLUMN "amount" SET DATA TYPE bigint;--> statement-breakpoint
CREATE INDEX "town_trades_buyer_idx" ON "town_trades" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "town_trades_seller_idx" ON "town_trades" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "town_trades_taker_idx" ON "town_trades" USING btree ("taker_id");
--> statement-breakpoint
-- Guard rails the code already assumes but the schema never stated. Free text
-- used as an enum, and counters that only ever climb, are exactly the columns a
-- bad write corrupts silently.
ALTER TABLE "town_state" ADD CONSTRAINT "town_state_happiness_range" CHECK ("happiness" >= 0 AND "happiness" <= 100);--> statement-breakpoint
ALTER TABLE "town_state" ADD CONSTRAINT "town_state_plots_positive" CHECK ("plots_bought" >= 0);--> statement-breakpoint
ALTER TABLE "town_state" ADD CONSTRAINT "town_state_builders_positive" CHECK ("builders" >= 1);--> statement-breakpoint
ALTER TABLE "town_inventory" ADD CONSTRAINT "town_inventory_amount_positive" CHECK ("amount" >= 0);--> statement-breakpoint
ALTER TABLE "town_orders" ADD CONSTRAINT "town_orders_side_enum" CHECK ("side" IN ('buy', 'sell'));--> statement-breakpoint
ALTER TABLE "town_orders" ADD CONSTRAINT "town_orders_status_enum" CHECK ("status" IN ('open', 'filled', 'cancelled'));--> statement-breakpoint
ALTER TABLE "town_buildings" ADD CONSTRAINT "town_buildings_level_range" CHECK ("level" >= 0 AND "level" <= 20);

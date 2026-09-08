CREATE TABLE "town_buildings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plot_id" text NOT NULL,
	"type" text NOT NULL,
	"tile_x" integer NOT NULL,
	"tile_y" integer NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"upgrading_to" integer,
	"completes_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "town_buildings_tile_unique" UNIQUE("plot_id","tile_x","tile_y")
);
--> statement-breakpoint
CREATE TABLE "town_inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resource" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "town_inventory_unique" UNIQUE("user_id","resource")
);
--> statement-breakpoint
CREATE TABLE "town_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resource" text NOT NULL,
	"side" text NOT NULL,
	"price" numeric(19, 4) NOT NULL,
	"quantity" integer NOT NULL,
	"filled" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "town_plots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"spiral_index" integer NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "town_plots_spiral_index_unique" UNIQUE("spiral_index")
);
--> statement-breakpoint
CREATE TABLE "town_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"happiness" integer DEFAULT 50 NOT NULL,
	"tick_progress_ms" integer DEFAULT 0 NOT NULL,
	"last_settled_at" timestamp DEFAULT now() NOT NULL,
	"plots_bought" integer DEFAULT 1 NOT NULL,
	"last_plot_bought_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "town_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "town_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"resource" text NOT NULL,
	"buyer_id" text,
	"seller_id" text,
	"taker_id" text,
	"price" numeric(19, 4) NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "town_buildings" ADD CONSTRAINT "town_buildings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_buildings" ADD CONSTRAINT "town_buildings_plot_id_town_plots_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."town_plots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_inventory" ADD CONSTRAINT "town_inventory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_orders" ADD CONSTRAINT "town_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_plots" ADD CONSTRAINT "town_plots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_state" ADD CONSTRAINT "town_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_trades" ADD CONSTRAINT "town_trades_buyer_id_user_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_trades" ADD CONSTRAINT "town_trades_seller_id_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_trades" ADD CONSTRAINT "town_trades_taker_id_user_id_fk" FOREIGN KEY ("taker_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "town_buildings_userId_idx" ON "town_buildings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "town_inventory_userId_idx" ON "town_inventory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "town_orders_book_idx" ON "town_orders" USING btree ("resource","status","side","price");--> statement-breakpoint
CREATE INDEX "town_orders_userId_idx" ON "town_orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "town_plots_userId_idx" ON "town_plots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "town_trades_resource_createdAt_idx" ON "town_trades" USING btree ("resource","created_at");
CREATE TABLE "tcg_allowances" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date_key" text NOT NULL,
	"packs_bought" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tcg_allowances_user_date_unique" UNIQUE("user_id","date_key")
);
--> statement-breakpoint
CREATE TABLE "tcg_auctions" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"kind" text NOT NULL,
	"copy_id" text,
	"pack_id" text,
	"start_price" numeric(19, 4) NOT NULL,
	"current_bid" numeric(19, 4),
	"current_bidder_id" text,
	"ends_at" timestamp NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_auction_bids" (
	"id" text PRIMARY KEY NOT NULL,
	"auction_id" text NOT NULL,
	"bidder_id" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_battler_escrow" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"copy_id" text NOT NULL,
	CONSTRAINT "tcg_battler_escrow_copy_id_unique" UNIQUE("copy_id")
);
--> statement-breakpoint
CREATE TABLE "tcg_battler_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"secret" text NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"cash" integer DEFAULT 0 NOT NULL,
	"run_state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tcg_battler_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"run_id" text NOT NULL,
	"round" integer NOT NULL,
	"board" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"week_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tcg_bundles_owner_week_unique" UNIQUE("owner_id","week_key")
);
--> statement-breakpoint
CREATE TABLE "tcg_buy_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"printing_id" text NOT NULL,
	"grade_service" text NOT NULL,
	"grade" text NOT NULL,
	"grade_designation" text,
	"price" numeric(19, 4) NOT NULL,
	"quantity" integer NOT NULL,
	"filled" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"plaatjes_base_id" text NOT NULL,
	"number" text NOT NULL,
	"set_total" integer,
	"name" text NOT NULL,
	"rarity" text,
	"rarity_code" text,
	"category" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "tcg_cards_setId_plaatjesBaseId_unique" UNIQUE("set_id","plaatjes_base_id")
);
--> statement-breakpoint
CREATE TABLE "tcg_copies" (
	"id" text PRIMARY KEY NOT NULL,
	"printing_id" text NOT NULL,
	"set_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"sheet_id" text NOT NULL,
	"cut_index" integer NOT NULL,
	"slot_offset" integer NOT NULL,
	"lifecycle" text DEFAULT 'raw' NOT NULL,
	"condition" jsonb,
	"grade_service" text,
	"grade" text,
	"grade_score" integer,
	"grade_designation" text,
	"grade_subs" jsonb,
	"grade_flaws" jsonb,
	"cert_number" text,
	"graded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tcg_copies_cert_number_unique" UNIQUE("cert_number"),
	CONSTRAINT "tcg_copies_serial_unique" UNIQUE("sheet_id","cut_index","slot_offset")
);
--> statement-breakpoint
CREATE TABLE "tcg_copy_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"copy_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"price" numeric(19, 4),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_displays" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_display_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"position" integer NOT NULL,
	"copy_id" text NOT NULL,
	CONSTRAINT "tcg_display_slots_position_unique" UNIQUE("display_id","position"),
	CONSTRAINT "tcg_display_slots_copy_unique" UNIQUE("copy_id")
);
--> statement-breakpoint
CREATE TABLE "tcg_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"copy_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"price" numeric(19, 4) NOT NULL,
	"note" text,
	"state" text DEFAULT 'active' NOT NULL,
	"buyer_id" text,
	"sold_grade_service" text,
	"sold_grade" text,
	"sold_designation" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sold_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tcg_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"set_id" text NOT NULL,
	"price" numeric(19, 4) NOT NULL,
	"note" text,
	"state" text DEFAULT 'active' NOT NULL,
	"buyer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sold_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tcg_lot_items" (
	"id" text PRIMARY KEY NOT NULL,
	"lot_id" text NOT NULL,
	"copy_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"bundle_id" text,
	"pack_index" integer NOT NULL,
	"is_god" boolean DEFAULT false NOT NULL,
	"cuts" jsonb NOT NULL,
	"state" text DEFAULT 'sealed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"opened_at" timestamp,
	CONSTRAINT "tcg_packs_setId_packIndex_unique" UNIQUE("set_id","pack_index")
);
--> statement-breakpoint
CREATE TABLE "tcg_pack_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"kind" text NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "tcg_pack_templates_setId_kind_unique" UNIQUE("set_id","kind")
);
--> statement-breakpoint
CREATE TABLE "tcg_printings" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"card_id" text NOT NULL,
	"plaatjes_card_id" text NOT NULL,
	"finish" text NOT NULL,
	"pattern" text,
	"print_run_label" text DEFAULT '1st' NOT NULL,
	"bundle" text,
	"asset_number" text,
	"mask_kind" text,
	"foil_effect" text,
	"foil_mask" text,
	CONSTRAINT "tcg_printings_setId_plaatjesCardId_unique" UNIQUE("set_id","plaatjes_card_id")
);
--> statement-breakpoint
CREATE TABLE "tcg_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"plaatjes_set_code" text,
	"template_code" text,
	"published_rates" jsonb,
	"release_date" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"target_pack_count" integer,
	"god_pack_one_in" integer,
	"god_pack_count" integer,
	"secret_key" text,
	"commitment_digest" text,
	"packs_sold" integer DEFAULT 0 NOT NULL,
	"base_packs_sold" integer DEFAULT 0 NOT NULL,
	"god_packs_sold" integer DEFAULT 0 NOT NULL,
	"reprint_of_set_id" text,
	"print_run_label" text DEFAULT '1st' NOT NULL,
	"on_sale_at" timestamp,
	"restock_pool" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"packs_per_pair" integer NOT NULL,
	"gems_per_pair" integer NOT NULL,
	"packs_per_day" integer NOT NULL,
	"bundle_packs" integer NOT NULL,
	"bundle_gems" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_sheets" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'base' NOT NULL,
	"pack_slots" integer DEFAULT 1 NOT NULL,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"impressions" integer,
	"cursor" integer DEFAULT 0 NOT NULL,
	"cursor_limit" integer
);
--> statement-breakpoint
CREATE TABLE "tcg_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"copy_id" text NOT NULL,
	"user_id" text NOT NULL,
	"service" text NOT NULL,
	"fee" numeric(19, 4) NOT NULL,
	"predicted_grade" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"grade_result" jsonb,
	"cert_number" text,
	"graded_at" timestamp,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"returns_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_trade_items" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"copy_id" text NOT NULL,
	"side" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_trade_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"sender_coins" numeric(19, 4) DEFAULT '0' NOT NULL,
	"receiver_coins" numeric(19, 4) DEFAULT '0' NOT NULL,
	"note" text,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_pokemon_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tcg_allowances" ADD CONSTRAINT "tcg_allowances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_auctions" ADD CONSTRAINT "tcg_auctions_seller_id_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_auctions" ADD CONSTRAINT "tcg_auctions_copy_id_tcg_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."tcg_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_auctions" ADD CONSTRAINT "tcg_auctions_pack_id_tcg_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."tcg_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_auctions" ADD CONSTRAINT "tcg_auctions_current_bidder_id_user_id_fk" FOREIGN KEY ("current_bidder_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_auction_bids" ADD CONSTRAINT "tcg_auction_bids_auction_id_tcg_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."tcg_auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_auction_bids" ADD CONSTRAINT "tcg_auction_bids_bidder_id_user_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_battler_escrow" ADD CONSTRAINT "tcg_battler_escrow_run_id_tcg_battler_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tcg_battler_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_battler_escrow" ADD CONSTRAINT "tcg_battler_escrow_copy_id_tcg_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."tcg_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_battler_runs" ADD CONSTRAINT "tcg_battler_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_battler_snapshots" ADD CONSTRAINT "tcg_battler_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_battler_snapshots" ADD CONSTRAINT "tcg_battler_snapshots_run_id_tcg_battler_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tcg_battler_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_bundles" ADD CONSTRAINT "tcg_bundles_set_id_tcg_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tcg_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_bundles" ADD CONSTRAINT "tcg_bundles_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_buy_orders" ADD CONSTRAINT "tcg_buy_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_buy_orders" ADD CONSTRAINT "tcg_buy_orders_printing_id_tcg_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."tcg_printings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_cards" ADD CONSTRAINT "tcg_cards_set_id_tcg_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tcg_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_copies" ADD CONSTRAINT "tcg_copies_printing_id_tcg_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."tcg_printings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_copies" ADD CONSTRAINT "tcg_copies_set_id_tcg_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tcg_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_copies" ADD CONSTRAINT "tcg_copies_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_copies" ADD CONSTRAINT "tcg_copies_pack_id_tcg_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."tcg_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_copies" ADD CONSTRAINT "tcg_copies_sheet_id_tcg_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."tcg_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_copy_transfers" ADD CONSTRAINT "tcg_copy_transfers_copy_id_tcg_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."tcg_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_copy_transfers" ADD CONSTRAINT "tcg_copy_transfers_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_copy_transfers" ADD CONSTRAINT "tcg_copy_transfers_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_displays" ADD CONSTRAINT "tcg_displays_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_display_slots" ADD CONSTRAINT "tcg_display_slots_display_id_tcg_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."tcg_displays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_display_slots" ADD CONSTRAINT "tcg_display_slots_copy_id_tcg_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."tcg_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_listings" ADD CONSTRAINT "tcg_listings_copy_id_tcg_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."tcg_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_listings" ADD CONSTRAINT "tcg_listings_seller_id_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_listings" ADD CONSTRAINT "tcg_listings_buyer_id_user_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_lots" ADD CONSTRAINT "tcg_lots_seller_id_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_lots" ADD CONSTRAINT "tcg_lots_set_id_tcg_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tcg_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_lots" ADD CONSTRAINT "tcg_lots_buyer_id_user_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_lot_items" ADD CONSTRAINT "tcg_lot_items_lot_id_tcg_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."tcg_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_lot_items" ADD CONSTRAINT "tcg_lot_items_copy_id_tcg_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."tcg_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_packs" ADD CONSTRAINT "tcg_packs_set_id_tcg_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tcg_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_packs" ADD CONSTRAINT "tcg_packs_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_packs" ADD CONSTRAINT "tcg_packs_bundle_id_tcg_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."tcg_bundles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_pack_templates" ADD CONSTRAINT "tcg_pack_templates_set_id_tcg_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tcg_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_printings" ADD CONSTRAINT "tcg_printings_set_id_tcg_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tcg_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_printings" ADD CONSTRAINT "tcg_printings_card_id_tcg_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."tcg_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_sheets" ADD CONSTRAINT "tcg_sheets_set_id_tcg_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tcg_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_submissions" ADD CONSTRAINT "tcg_submissions_copy_id_tcg_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."tcg_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_submissions" ADD CONSTRAINT "tcg_submissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_trade_items" ADD CONSTRAINT "tcg_trade_items_offer_id_tcg_trade_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."tcg_trade_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_trade_items" ADD CONSTRAINT "tcg_trade_items_copy_id_tcg_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."tcg_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_trade_offers" ADD CONSTRAINT "tcg_trade_offers_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_trade_offers" ADD CONSTRAINT "tcg_trade_offers_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tcg_auctions_state_endsAt_idx" ON "tcg_auctions" USING btree ("state","ends_at");--> statement-breakpoint
CREATE INDEX "tcg_auctions_sellerId_idx" ON "tcg_auctions" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "tcg_auction_bids_auctionId_idx" ON "tcg_auction_bids" USING btree ("auction_id");--> statement-breakpoint
CREATE INDEX "tcg_battler_escrow_runId_idx" ON "tcg_battler_escrow" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tcg_battler_runs_userId_idx" ON "tcg_battler_runs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_battler_runs_active_unique" ON "tcg_battler_runs" USING btree ("user_id") WHERE state = 'active';--> statement-breakpoint
CREATE INDEX "tcg_battler_snapshots_round_idx" ON "tcg_battler_snapshots" USING btree ("round");--> statement-breakpoint
CREATE INDEX "tcg_buy_orders_book_idx" ON "tcg_buy_orders" USING btree ("printing_id","grade_service","grade","status");--> statement-breakpoint
CREATE INDEX "tcg_buy_orders_userId_idx" ON "tcg_buy_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tcg_cards_setId_sortOrder_idx" ON "tcg_cards" USING btree ("set_id","sort_order");--> statement-breakpoint
CREATE INDEX "tcg_copies_ownerId_idx" ON "tcg_copies" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "tcg_copies_printingId_idx" ON "tcg_copies" USING btree ("printing_id");--> statement-breakpoint
CREATE INDEX "tcg_copy_transfers_copyId_idx" ON "tcg_copy_transfers" USING btree ("copy_id");--> statement-breakpoint
CREATE INDEX "tcg_displays_userId_idx" ON "tcg_displays" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tcg_listings_copyId_idx" ON "tcg_listings" USING btree ("copy_id");--> statement-breakpoint
CREATE INDEX "tcg_listings_sellerId_idx" ON "tcg_listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "tcg_listings_state_idx" ON "tcg_listings" USING btree ("state");--> statement-breakpoint
CREATE INDEX "tcg_lots_setId_state_idx" ON "tcg_lots" USING btree ("set_id","state");--> statement-breakpoint
CREATE INDEX "tcg_lots_sellerId_idx" ON "tcg_lots" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "tcg_lot_items_lotId_idx" ON "tcg_lot_items" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "tcg_lot_items_copyId_idx" ON "tcg_lot_items" USING btree ("copy_id");--> statement-breakpoint
CREATE INDEX "tcg_packs_ownerId_idx" ON "tcg_packs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "tcg_packs_bundleId_idx" ON "tcg_packs" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "tcg_printings_setId_idx" ON "tcg_printings" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "tcg_printings_cardId_idx" ON "tcg_printings" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "tcg_sheets_setId_idx" ON "tcg_sheets" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "tcg_submissions_userId_idx" ON "tcg_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tcg_submissions_copyId_idx" ON "tcg_submissions" USING btree ("copy_id");--> statement-breakpoint
CREATE INDEX "tcg_trade_items_offerId_idx" ON "tcg_trade_items" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "tcg_trade_offers_from_idx" ON "tcg_trade_offers" USING btree ("from_user_id","state");--> statement-breakpoint
CREATE INDEX "tcg_trade_offers_to_idx" ON "tcg_trade_offers" USING btree ("to_user_id","state");
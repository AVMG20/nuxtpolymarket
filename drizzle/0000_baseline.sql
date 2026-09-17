-- The baseline runs against databases that already hold this schema, so every
-- statement here has to be a no-op when the object exists. Later migrations are
-- ordinary drizzle-kit output; only 0000 carries this shape.
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tool_calls" jsonb,
	"tool_call_id" text,
	"tool_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"balance" numeric(19, 4) NOT NULL,
	"action" text NOT NULL,
	"amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"balance" numeric(19, 4) DEFAULT '0' NOT NULL,
	"principal" numeric(19, 4) DEFAULT '0' NOT NULL,
	"max_principal" numeric(19, 4) DEFAULT '0' NOT NULL,
	"loan_principal" numeric(19, 4) DEFAULT '0' NOT NULL,
	"last_settled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"seen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colony_bug_research" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type_id" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "colony_bug_research_unique" UNIQUE("type_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colony_bugs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type_id" text NOT NULL,
	"speed" integer NOT NULL,
	"yield" integer NOT NULL,
	"eat" integer DEFAULT 8 NOT NULL,
	"in_terrarium" boolean DEFAULT false NOT NULL,
	"tick_progress_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colony_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_type_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "colony_items_unique" UNIQUE("item_type_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colony_loot" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_type_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "colony_loot_unique" UNIQUE("item_type_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colony_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"habitat_level" integer DEFAULT 1 NOT NULL,
	"nutrition" integer DEFAULT 150 NOT NULL,
	"gem_nutrition" integer DEFAULT 0 NOT NULL,
	"last_settled_at" timestamp DEFAULT now() NOT NULL,
	"builder_track_id" text,
	"builder_started_at" timestamp,
	CONSTRAINT "colony_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colony_upgrades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "colony_upgrades_unique" UNIQUE("track_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emblem_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"emblem" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "firewall_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"save_version" integer NOT NULL,
	"run_state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "firewall_runs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "firewall_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bulwark_level" integer DEFAULT 0 NOT NULL,
	"munitions_level" integer DEFAULT 0 NOT NULL,
	"foundry_level" integer DEFAULT 0 NOT NULL,
	"grant_level" integer DEFAULT 0 NOT NULL,
	"salvage_level" integer DEFAULT 0 NOT NULL,
	"capacitor_level" integer DEFAULT 0 NOT NULL,
	"charter_level" integer DEFAULT 0 NOT NULL,
	"arsenal_level" integer DEFAULT 0 NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"total_coins_earned" numeric(19, 4) DEFAULT '0' NOT NULL,
	"best_wave" integer DEFAULT 0 NOT NULL,
	"best_kills" integer DEFAULT 0 NOT NULL,
	"best_payout" integer DEFAULT 0 NOT NULL,
	"victories" integer DEFAULT 0 NOT NULL,
	"run_started_at" timestamp,
	"run_difficulty_snapshot" text,
	"run_power_snapshot" integer,
	"run_coin_multiplier_snapshot" numeric(10, 4),
	"last_run_finished_at" timestamp,
	CONSTRAINT "firewall_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gem_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"side" text NOT NULL,
	"price" numeric(19, 4) NOT NULL,
	"quantity" integer NOT NULL,
	"filled" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gem_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"buyer_id" text,
	"seller_id" text,
	"taker_id" text,
	"price" numeric(19, 4) NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hack_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"class" text NOT NULL,
	"rarity" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"equipped_tool" text,
	"equipped_software" text,
	"equipped_hardware" text,
	"traits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hack_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trait_type" text NOT NULL,
	"rarity" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hack_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"template_id" text NOT NULL,
	"success" boolean NOT NULL,
	"cash" numeric(19, 4) DEFAULT '0' NOT NULL,
	"gems" integer DEFAULT 0 NOT NULL,
	"item_name" text,
	"item_rarity" text,
	"agent_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hack_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"slot" text NOT NULL,
	"item_level" integer DEFAULT 1 NOT NULL,
	"rarity" text NOT NULL,
	"mods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hack_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"template_id" text NOT NULL,
	"agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completes_at" timestamp NOT NULL,
	"collected" boolean DEFAULT false NOT NULL,
	"reward" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hack_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"roster_slots" integer DEFAULT 2 NOT NULL,
	"total_ops_completed" integer DEFAULT 0 NOT NULL,
	"total_recruits" integer DEFAULT 0 NOT NULL,
	"shop_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shop_refresh_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hack_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "live_blackjack_wagers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"round_id" integer NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"kind" text NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "miner_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"rig_level" integer DEFAULT 1 NOT NULL,
	"vault_level" integer DEFAULT 1 NOT NULL,
	"last_collected_at" timestamp DEFAULT now() NOT NULL,
	"factory_level" integer DEFAULT 1 NOT NULL,
	"factory_last_collected_at" timestamp DEFAULT now() NOT NULL,
	"lootbox_slots" integer DEFAULT 1 NOT NULL,
	"lootbox_today_opens" integer DEFAULT 0 NOT NULL,
	"lootbox_opens_date" text DEFAULT '' NOT NULL,
	"overclock_level" integer DEFAULT 0 NOT NULL,
	"catalyst_level" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "miner_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pathwarden_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"save_version" integer NOT NULL,
	"generator_version" integer NOT NULL,
	"seed" bigint NOT NULL,
	"realm" integer NOT NULL,
	"map_plan" jsonb NOT NULL,
	"game_state" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pathwarden_runs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pathwarden_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bulwark_level" integer DEFAULT 0 NOT NULL,
	"artificer_level" integer DEFAULT 0 NOT NULL,
	"lens_level" integer DEFAULT 0 NOT NULL,
	"reservoir_level" integer DEFAULT 0 NOT NULL,
	"banner_level" integer DEFAULT 0 NOT NULL,
	"bounty_level" integer DEFAULT 0 NOT NULL,
	"arcanist_level" integer DEFAULT 0 NOT NULL,
	"surge_charges" integer DEFAULT 0 NOT NULL,
	"skip_intro" boolean DEFAULT false NOT NULL,
	"keyboard_pan" boolean DEFAULT false NOT NULL,
	"claimed_checkpoint_waves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ambient_story_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ambient_reward_claimed" boolean DEFAULT false NOT NULL,
	"free_boost_credits" integer DEFAULT 0 NOT NULL,
	"owned_defense_ids" jsonb DEFAULT '["bolt","mortar","frost"]'::jsonb NOT NULL,
	"owned_skin_ids" jsonb DEFAULT '["warden-stone"]'::jsonb NOT NULL,
	"equipped_skin_id" text DEFAULT 'warden-stone' NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"total_coins_earned" numeric(19, 4) DEFAULT '0' NOT NULL,
	"best_wave" integer DEFAULT 0 NOT NULL,
	"best_score" integer DEFAULT 0 NOT NULL,
	"best_realm" integer DEFAULT 0 NOT NULL,
	"best_flawless" integer DEFAULT 0 NOT NULL,
	"highest_completed_realm" integer DEFAULT 0 NOT NULL,
	"run_started_at" timestamp,
	"run_realm_snapshot" integer,
	"run_power_snapshot" integer,
	"run_surged_snapshot" boolean,
	"last_run_finished_at" timestamp,
	"last_ambient_story_at" timestamp,
	CONSTRAINT "pathwarden_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pirate_cannons" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"tier_id" text NOT NULL,
	"purchase_price" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pirate_run_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"loot" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"power" integer DEFAULT 0 NOT NULL,
	"difficulty" integer DEFAULT 0 NOT NULL,
	"survived" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"shots_fired" integer DEFAULT 0 NOT NULL,
	"skin_id" text DEFAULT 'starter' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pirate_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"hull_level" integer DEFAULT 1 NOT NULL,
	"speed_level" integer DEFAULT 1 NOT NULL,
	"defense_level" integer DEFAULT 1 NOT NULL,
	"ammo_capacity_level" integer DEFAULT 1 NOT NULL,
	"regen_level" integer DEFAULT 1 NOT NULL,
	"cannon_slots" integer DEFAULT 1 NOT NULL,
	"ammo_count" integer DEFAULT 60 NOT NULL,
	"gem_ammo_count" integer DEFAULT 0 NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"total_coins_earned" integer DEFAULT 0 NOT NULL,
	"best_survival_ms" integer DEFAULT 0 NOT NULL,
	"best_run_power" integer DEFAULT 0 NOT NULL,
	"best_run_loot" integer DEFAULT 0 NOT NULL,
	"owned_skin_ids" jsonb DEFAULT '["starter"]'::jsonb NOT NULL,
	"equipped_skin_id" text DEFAULT 'starter' NOT NULL,
	"owned_ability_ids" jsonb DEFAULT '["bomb"]'::jsonb NOT NULL,
	"equipped_ability_id" text DEFAULT 'bomb' NOT NULL,
	"ability_levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_started_at" timestamp,
	"run_power_snapshot" integer,
	"run_difficulty_snapshot" integer,
	"highest_completed_difficulty" integer DEFAULT '-50' NOT NULL,
	"best_completed_loot" integer DEFAULT 0 NOT NULL,
	"best_completed_power" integer DEFAULT 0 NOT NULL,
	"best_completed_skin_id" text DEFAULT 'starter' NOT NULL,
	"hull_repair_until" timestamp,
	"hull_repair_total_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pirate_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shapezz_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"core_level" integer DEFAULT 0 NOT NULL,
	"overclock_level" integer DEFAULT 0 NOT NULL,
	"armor_level" integer DEFAULT 0 NOT NULL,
	"thrusters_level" integer DEFAULT 0 NOT NULL,
	"magnet_level" integer DEFAULT 0 NOT NULL,
	"kill_heal_level" integer DEFAULT 0 NOT NULL,
	"head_start_level" integer DEFAULT 0 NOT NULL,
	"weapon_type" text DEFAULT 'blaster' NOT NULL,
	"blaster_rarity" text DEFAULT 'common' NOT NULL,
	"blaster_purchase_price" integer DEFAULT 0 NOT NULL,
	"launcher_rarity" text,
	"launcher_purchase_price" integer DEFAULT 0 NOT NULL,
	"shotgun_rarity" text,
	"shotgun_purchase_price" integer DEFAULT 0 NOT NULL,
	"arc_coil_rarity" text,
	"arc_coil_purchase_price" integer DEFAULT 0 NOT NULL,
	"runs_played" integer DEFAULT 0 NOT NULL,
	"total_coins_earned" integer DEFAULT 0 NOT NULL,
	"best_survival_ms" integer DEFAULT 0 NOT NULL,
	"best_kills" integer DEFAULT 0 NOT NULL,
	"best_checkpoint" integer DEFAULT 0 NOT NULL,
	"run_started_at" timestamp,
	"run_difficulty_snapshot" text,
	"run_power_snapshot" integer,
	"last_run_finished_at" timestamp,
	CONSTRAINT "shapezz_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"type" text NOT NULL,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"emblem" text,
	"balance" numeric(19, 4) DEFAULT '0' NOT NULL,
	"rake" numeric(19, 4) DEFAULT '0' NOT NULL,
	"rakeback_unlocked" boolean DEFAULT false NOT NULL,
	"gems" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xeno_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type_id" text NOT NULL,
	"charges_remaining" integer NOT NULL,
	"gem_crafted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xeno_breeder_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"plant1_type_id" text,
	"plant1_speed" integer,
	"plant1_yield" integer,
	"plant2_type_id" text,
	"plant2_speed" integer,
	"plant2_yield" integer,
	"started_at" timestamp,
	"artifact_id" text,
	"result_type_id" text,
	"result_speed" integer,
	"result_yield" integer,
	"result_quantity" integer,
	"was_mutation" boolean,
	"collected" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xeno_grid_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"plant_id" text,
	"started_at" timestamp,
	"artifact_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xeno_plants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type_id" text NOT NULL,
	"speed" integer NOT NULL,
	"yield" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xeno_plants_unlocked" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type_id" text NOT NULL,
	"unlocked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xeno_upgrades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mutation_level" integer DEFAULT 0 NOT NULL,
	"yield_level" integer DEFAULT 0 NOT NULL,
	"speed_level" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "xeno_upgrades_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_history" ADD CONSTRAINT "bank_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_state" ADD CONSTRAINT "bank_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_mentions" ADD CONSTRAINT "chat_mentions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_mentions" ADD CONSTRAINT "chat_mentions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colony_bug_research" ADD CONSTRAINT "colony_bug_research_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colony_bugs" ADD CONSTRAINT "colony_bugs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colony_items" ADD CONSTRAINT "colony_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colony_loot" ADD CONSTRAINT "colony_loot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colony_state" ADD CONSTRAINT "colony_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colony_upgrades" ADD CONSTRAINT "colony_upgrades_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "emblem_history" ADD CONSTRAINT "emblem_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "firewall_runs" ADD CONSTRAINT "firewall_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "firewall_state" ADD CONSTRAINT "firewall_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gem_orders" ADD CONSTRAINT "gem_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gem_trades" ADD CONSTRAINT "gem_trades_buyer_id_user_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gem_trades" ADD CONSTRAINT "gem_trades_seller_id_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gem_trades" ADD CONSTRAINT "gem_trades_taker_id_user_id_fk" FOREIGN KEY ("taker_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hack_agents" ADD CONSTRAINT "hack_agents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hack_artifacts" ADD CONSTRAINT "hack_artifacts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hack_history" ADD CONSTRAINT "hack_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hack_items" ADD CONSTRAINT "hack_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hack_ops" ADD CONSTRAINT "hack_ops_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hack_state" ADD CONSTRAINT "hack_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_blackjack_wagers" ADD CONSTRAINT "live_blackjack_wagers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "miner_state" ADD CONSTRAINT "miner_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pathwarden_runs" ADD CONSTRAINT "pathwarden_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pathwarden_state" ADD CONSTRAINT "pathwarden_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pirate_cannons" ADD CONSTRAINT "pirate_cannons_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pirate_run_history" ADD CONSTRAINT "pirate_run_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pirate_state" ADD CONSTRAINT "pirate_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shapezz_state" ADD CONSTRAINT "shapezz_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "xeno_artifacts" ADD CONSTRAINT "xeno_artifacts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "xeno_breeder_slots" ADD CONSTRAINT "xeno_breeder_slots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "xeno_breeder_slots" ADD CONSTRAINT "xeno_breeder_slots_artifact_id_xeno_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."xeno_artifacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "xeno_grid_slots" ADD CONSTRAINT "xeno_grid_slots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "xeno_grid_slots" ADD CONSTRAINT "xeno_grid_slots_plant_id_xeno_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."xeno_plants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "xeno_grid_slots" ADD CONSTRAINT "xeno_grid_slots_artifact_id_xeno_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."xeno_artifacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "xeno_plants" ADD CONSTRAINT "xeno_plants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "xeno_plants_unlocked" ADD CONSTRAINT "xeno_plants_unlocked_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "xeno_upgrades" ADD CONSTRAINT "xeno_upgrades_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_userId_updatedAt_idx" ON "ai_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_messages_conversationId_createdAt_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_messages_userId_role_createdAt_idx" ON "ai_messages" USING btree ("user_id","role","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_history_userId_createdAt_idx" ON "bank_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_mentions_userId_idx" ON "chat_mentions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_createdAt_idx" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "colony_bug_research_userId_idx" ON "colony_bug_research" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "colony_bugs_userId_idx" ON "colony_bugs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "colony_items_userId_idx" ON "colony_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "colony_loot_userId_idx" ON "colony_loot" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "colony_upgrades_userId_idx" ON "colony_upgrades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emblem_history_userId_createdAt_idx" ON "emblem_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gem_orders_book_idx" ON "gem_orders" USING btree ("status","side","price");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gem_orders_userId_createdAt_idx" ON "gem_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gem_trades_createdAt_idx" ON "gem_trades" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hack_agents_userId_idx" ON "hack_agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hack_artifacts_userId_idx" ON "hack_artifacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hack_history_userId_idx" ON "hack_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hack_items_userId_idx" ON "hack_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hack_ops_userId_idx" ON "hack_ops" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_blackjack_wagers_settled_createdAt_idx" ON "live_blackjack_wagers" USING btree ("settled","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pirate_cannons_userId_idx" ON "pirate_cannons" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pirate_run_history_userId_createdAt_idx" ON "pirate_run_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_userId_createdAt_idx" ON "transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xeno_artifacts_userId_idx" ON "xeno_artifacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xeno_breeder_userId_idx" ON "xeno_breeder_slots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xeno_grid_userId_idx" ON "xeno_grid_slots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xeno_plants_userId_idx" ON "xeno_plants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xeno_plants_unlocked_userId_idx" ON "xeno_plants_unlocked" USING btree ("user_id");
CREATE TABLE "hq_arena_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"opponent_user_id" text,
	"opponent_bot_id" text,
	"role" text NOT NULL,
	"won" boolean NOT NULL,
	"rating_change" integer DEFAULT 0 NOT NULL,
	"medals_earned" integer DEFAULT 0 NOT NULL,
	"is_dummy" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hq_arena_season_results" (
	"id" text PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"rank" integer NOT NULL,
	"medals" integer NOT NULL,
	"claimed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "hq_arena_season_results_unique" UNIQUE("season_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hq_arena_seasons" (
	"season_id" integer PRIMARY KEY NOT NULL,
	"closed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hq_collection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"system" text NOT NULL,
	"content_id" text NOT NULL,
	"star" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"dupe_progress" integer DEFAULT 0 NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hq_collection_unique" UNIQUE("user_id","system","content_id")
);
--> statement-breakpoint
CREATE TABLE "hq_fights" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"seed" integer NOT NULL,
	"context" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"resolved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hq_holiday_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"holiday_id" text NOT NULL,
	"year" integer NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hq_loadouts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"name" text DEFAULT 'Loadout' NOT NULL,
	"party_champion_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"formation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"equipped_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped_gear" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ascendant_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hq_loadouts_unique" UNIQUE("user_id","slot_index")
);
--> statement-breakpoint
CREATE TABLE "hq_raid_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"raid_id" text NOT NULL,
	"highest_level" integer DEFAULT 0 NOT NULL,
	"key_balance" integer DEFAULT 3 NOT NULL,
	"last_key_grant_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hq_shop_upgrades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"upgrade_id" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "hq_shop_upgrades_unique" UNIQUE("user_id","upgrade_id")
);
--> statement-breakpoint
CREATE TABLE "hq_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"last_settled_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"prestige" integer DEFAULT 0 NOT NULL,
	"world" integer DEFAULT 1 NOT NULL,
	"stage" integer DEFAULT 1 NOT NULL,
	"kill_count" integer DEFAULT 0 NOT NULL,
	"kill_fraction" double precision DEFAULT 0 NOT NULL,
	"recovery_seconds" double precision DEFAULT 0 NOT NULL,
	"at_boss_gate" boolean DEFAULT false NOT NULL,
	"run_cleared" boolean DEFAULT false NOT NULL,
	"boss_lost" boolean DEFAULT false NOT NULL,
	"hero_node_id" text DEFAULT 'class_beginner' NOT NULL,
	"hero_level" integer DEFAULT 1 NOT NULL,
	"hero_xp" text DEFAULT '0' NOT NULL,
	"seen_node_ids" jsonb DEFAULT '["class_beginner"]'::jsonb NOT NULL,
	"class_token" boolean DEFAULT false NOT NULL,
	"prestiged_class_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ascendant_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"void_shards" text DEFAULT '0' NOT NULL,
	"speed_boost_multiplier" integer,
	"speed_boost_expires_at" timestamp,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calendar_start" integer,
	"calendar_claimed" integer DEFAULT 0 NOT NULL,
	"calendar_makeups" integer DEFAULT 0 NOT NULL,
	"milestones_claimed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tutorials_seen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"formation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"party_champion_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped_gear" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raid_loadout_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pre_raid_snapshot" jsonb,
	"forge_seals" integer DEFAULT 0 NOT NULL,
	"guild_seals" integer DEFAULT 0 NOT NULL,
	"skill_seals" integer DEFAULT 0 NOT NULL,
	"excavation_seals" integer DEFAULT 0 NOT NULL,
	"gear_essence" integer DEFAULT 0 NOT NULL,
	"champion_essence" integer DEFAULT 0 NOT NULL,
	"skill_essence" integer DEFAULT 0 NOT NULL,
	"artifact_essence" integer DEFAULT 0 NOT NULL,
	"trait_gems" integer DEFAULT 0 NOT NULL,
	"passive_tree" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"passive_respec_free" boolean DEFAULT false NOT NULL,
	"gacha_levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gacha_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seal_ladder_purchased_today" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seal_ladder_date" text,
	"free_pulls_used_today" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"free_pull_date" text,
	"free_pull_claimed_at" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"global_power_number" text,
	"defense_loadout" jsonb,
	"defense_gpn" text,
	"arena_rating" integer DEFAULT 1000 NOT NULL,
	"arena_season_id" integer DEFAULT 0 NOT NULL,
	"arena_season_matches" integer DEFAULT 0 NOT NULL,
	"arena_medals" integer DEFAULT 0 NOT NULL,
	"arena_wins" integer DEFAULT 0 NOT NULL,
	"arena_attempts_used_today" integer DEFAULT 0 NOT NULL,
	"arena_extra_attempts_purchased_today" integer DEFAULT 0 NOT NULL,
	"arena_attempt_date" text,
	"arena_refreshes_today" integer DEFAULT 0 NOT NULL,
	"arena_refresh_date" text,
	"arena_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "hq_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "hq_trait_save_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"save_slot_index" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hq_trait_save_slots_unique" UNIQUE("user_id","save_slot_index")
);
--> statement-breakpoint
CREATE TABLE "hq_trait_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"stat" text NOT NULL,
	"grade" text NOT NULL,
	"set_id" text NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "hq_trait_slots_unique" UNIQUE("user_id","slot_index")
);
--> statement-breakpoint
ALTER TABLE "hq_arena_log" ADD CONSTRAINT "hq_arena_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_arena_log" ADD CONSTRAINT "hq_arena_log_opponent_user_id_user_id_fk" FOREIGN KEY ("opponent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_arena_season_results" ADD CONSTRAINT "hq_arena_season_results_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_collection" ADD CONSTRAINT "hq_collection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_fights" ADD CONSTRAINT "hq_fights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_holiday_claims" ADD CONSTRAINT "hq_holiday_claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_loadouts" ADD CONSTRAINT "hq_loadouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_raid_state" ADD CONSTRAINT "hq_raid_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_shop_upgrades" ADD CONSTRAINT "hq_shop_upgrades_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_state" ADD CONSTRAINT "hq_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_trait_save_slots" ADD CONSTRAINT "hq_trait_save_slots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_trait_slots" ADD CONSTRAINT "hq_trait_slots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hq_arena_log_userId_createdAt_idx" ON "hq_arena_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "hq_arena_season_results_userId_idx" ON "hq_arena_season_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_collection_userId_system_idx" ON "hq_collection" USING btree ("user_id","system");--> statement-breakpoint
CREATE INDEX "hq_fights_userId_idx" ON "hq_fights" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hq_holiday_claims_user_holiday_year_idx" ON "hq_holiday_claims" USING btree ("user_id","holiday_id","year");--> statement-breakpoint
CREATE INDEX "hq_holiday_claims_userId_idx" ON "hq_holiday_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_loadouts_userId_idx" ON "hq_loadouts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hq_raid_state_user_raid_idx" ON "hq_raid_state" USING btree ("user_id","raid_id");--> statement-breakpoint
CREATE INDEX "hq_raid_state_userId_idx" ON "hq_raid_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_shop_upgrades_userId_idx" ON "hq_shop_upgrades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_state_userId_idx" ON "hq_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_state_arena_rating_idx" ON "hq_state" USING btree ("arena_season_id","arena_rating");--> statement-breakpoint
CREATE INDEX "hq_trait_save_slots_userId_idx" ON "hq_trait_save_slots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_trait_slots_userId_idx" ON "hq_trait_slots" USING btree ("user_id");
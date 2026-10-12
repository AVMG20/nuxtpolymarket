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
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hq_loadouts_unique" UNIQUE("user_id","slot_index")
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
	"at_boss_gate" boolean DEFAULT false NOT NULL,
	"run_cleared" boolean DEFAULT false NOT NULL,
	"hero_node_id" text DEFAULT 'class_beginner' NOT NULL,
	"hero_level" integer DEFAULT 1 NOT NULL,
	"hero_xp" text DEFAULT '0' NOT NULL,
	"seen_node_ids" jsonb DEFAULT '["class_beginner"]'::jsonb NOT NULL,
	"void_shards" text DEFAULT '0' NOT NULL,
	"formation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"party_champion_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped_gear" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"forge_seals" integer DEFAULT 0 NOT NULL,
	"guild_seals" integer DEFAULT 0 NOT NULL,
	"skill_seals" integer DEFAULT 0 NOT NULL,
	"excavation_seals" integer DEFAULT 0 NOT NULL,
	"gear_essence" integer DEFAULT 0 NOT NULL,
	"champion_essence" integer DEFAULT 0 NOT NULL,
	"skill_essence" integer DEFAULT 0 NOT NULL,
	"artifact_essence" integer DEFAULT 0 NOT NULL,
	"gacha_levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gacha_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seal_ladder_purchased_today" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seal_ladder_date" text,
	"free_pulls_used_today" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"free_pull_date" text,
	"free_pull_claimed_at" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "hq_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "hq_collection" ADD CONSTRAINT "hq_collection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_fights" ADD CONSTRAINT "hq_fights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_loadouts" ADD CONSTRAINT "hq_loadouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_shop_upgrades" ADD CONSTRAINT "hq_shop_upgrades_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_state" ADD CONSTRAINT "hq_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hq_collection_userId_system_idx" ON "hq_collection" USING btree ("user_id","system");--> statement-breakpoint
CREATE INDEX "hq_fights_userId_idx" ON "hq_fights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_loadouts_userId_idx" ON "hq_loadouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_shop_upgrades_userId_idx" ON "hq_shop_upgrades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_state_userId_idx" ON "hq_state" USING btree ("user_id");
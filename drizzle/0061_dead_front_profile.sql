CREATE TABLE "dead_front_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"unlocked_weapons" jsonb DEFAULT '["m1911"]'::jsonb NOT NULL,
	"weapon_xp" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"loadout" jsonb DEFAULT '{"startWeapon":"m1911","attachments":{}}'::jsonb NOT NULL,
	"research_perk" text,
	"perk_xp" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"perk_mods" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"best_round" integer DEFAULT 0 NOT NULL,
	"total_kills" integer DEFAULT 0 NOT NULL,
	"eggs_completed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dead_front_profile" ADD CONSTRAINT "dead_front_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
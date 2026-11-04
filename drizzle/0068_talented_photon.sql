CREATE TABLE "rail_tycoon_chunks" (
	"world_id" text NOT NULL,
	"chunk_id" integer NOT NULL,
	"hash" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "rail_tycoon_chunks_world_id_chunk_id_pk" PRIMARY KEY("world_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "rail_tycoon_members" (
	"world_id" text NOT NULL,
	"user_id" text NOT NULL,
	"company_id" integer NOT NULL,
	"joined_at" timestamp DEFAULT now(),
	CONSTRAINT "rail_tycoon_members_world_id_user_id_pk" PRIMARY KEY("world_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rail_tycoon_worlds" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"invite_code" text NOT NULL,
	"side" integer,
	"max_companies" integer,
	"is_public" boolean DEFAULT false NOT NULL,
	"avatar" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"save" "bytea" NOT NULL,
	"bytes" integer,
	"tick" integer,
	"saved_at" timestamp NOT NULL,
	"last_active_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "rail_tycoon_worlds_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
ALTER TABLE "rail_tycoon_chunks" ADD CONSTRAINT "rail_tycoon_chunks_world_id_rail_tycoon_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."rail_tycoon_worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_tycoon_members" ADD CONSTRAINT "rail_tycoon_members_world_id_rail_tycoon_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."rail_tycoon_worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_tycoon_members" ADD CONSTRAINT "rail_tycoon_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_tycoon_worlds" ADD CONSTRAINT "rail_tycoon_worlds_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rail_tycoon_members_world_company_idx" ON "rail_tycoon_members" USING btree ("world_id","company_id");--> statement-breakpoint
CREATE INDEX "rail_tycoon_worlds_ownerId_idx" ON "rail_tycoon_worlds" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "rail_tycoon_worlds_public_idx" ON "rail_tycoon_worlds" USING btree ("last_active_at") WHERE "rail_tycoon_worlds"."is_public" and "rail_tycoon_worlds"."status" = 'open';
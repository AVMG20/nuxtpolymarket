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
ALTER TABLE "hq_trait_save_slots" ADD CONSTRAINT "hq_trait_save_slots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hq_trait_slots" ADD CONSTRAINT "hq_trait_slots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hq_trait_save_slots_userId_idx" ON "hq_trait_save_slots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hq_trait_slots_userId_idx" ON "hq_trait_slots" USING btree ("user_id");
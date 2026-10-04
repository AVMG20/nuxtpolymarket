CREATE TABLE "town_contract_days" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"bonus_gems" integer NOT NULL,
	"bonus_claimed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "town_contract_days_user_day_unique" UNIQUE("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "town_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"slot" integer NOT NULL,
	"resource" text NOT NULL,
	"quantity" integer NOT NULL,
	"reward" numeric(19, 4) NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "town_contracts_user_day_slot_unique" UNIQUE("user_id","day","slot")
);
--> statement-breakpoint
CREATE TABLE "town_streak" (
	"user_id" text PRIMARY KEY NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"last_day" text,
	"claimed" integer DEFAULT 0 NOT NULL,
	"cycle" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "town_contract_days" ADD CONSTRAINT "town_contract_days_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_contracts" ADD CONSTRAINT "town_contracts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_streak" ADD CONSTRAINT "town_streak_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "bank_state" ADD COLUMN "bailout_at" timestamp;--> statement-breakpoint
ALTER TABLE "bank_state" ADD COLUMN "bailout_until" timestamp;--> statement-breakpoint
ALTER TABLE "bank_state" ADD COLUMN "bailout_debt" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_state" ADD COLUMN "bailout_repaid" numeric(19, 4) DEFAULT '0' NOT NULL;
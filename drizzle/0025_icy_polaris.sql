CREATE TABLE "town_realm" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"founding_cursor" integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
-- One row, always. The single-row shape is the point: it is the realm, not a
-- per-player record.
ALTER TABLE "town_realm" ADD CONSTRAINT "town_realm_single_row" CHECK ("id" = 1);--> statement-breakpoint
INSERT INTO "town_realm" ("id", "founding_cursor") VALUES (1, 0) ON CONFLICT DO NOTHING;

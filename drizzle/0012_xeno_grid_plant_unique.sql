-- Repair slots corrupted by the concurrent-plant race before adding the index.
-- 1. A plant row referenced by several slots: keep the lowest slot_index, free the rest.
UPDATE "xeno_grid_slots" s
SET "plant_id" = NULL, "started_at" = NULL
WHERE s."plant_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "xeno_grid_slots" o
    WHERE o."plant_id" = s."plant_id"
      AND o."user_id" = s."user_id"
      AND o."slot_index" < s."slot_index"
  );--> statement-breakpoint
-- 2. Phantom plots: plant row already gone (FK SET NULL) but started_at still set.
UPDATE "xeno_grid_slots"
SET "started_at" = NULL
WHERE "plant_id" IS NULL AND "started_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "xeno_grid_plantId_uniq" ON "xeno_grid_slots" USING btree ("plant_id") WHERE plant_id is not null;

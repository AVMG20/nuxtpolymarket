ALTER TABLE "transactions" ADD COLUMN "refund" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Returned money used to be marked in the category ('polytown:refund',
-- 'live-blackjack:recovery'); it is a flag now, so set it before the suffix goes.
UPDATE "transactions" SET "refund" = true
WHERE "type" = 'credit'
  AND ("category" ~ '(refund|recovery|cancel)' OR "category" IN ('bank', 'bank withdrawal'));--> statement-breakpoint
-- One plain category per game: drop every ':detail' suffix and fold the
-- legacy spellings into the names the code writes today.
UPDATE "transactions" SET "category" = CASE
  WHEN "category" = 'tcg:vendor' THEN 'tcg vendor'
  WHEN "category" LIKE 'game:%' THEN split_part("category", ':', 2)
  WHEN "category" = 'HackOps' OR "category" LIKE 'hack:%' OR lower("category") LIKE 'hackops:%' THEN 'hackops'
  WHEN "category" IN ('bank deposit', 'bank withdrawal') THEN 'bank'
  ELSE split_part("category", ':', 1)
END
WHERE "category" LIKE '%:%' OR "category" IN ('HackOps', 'bank deposit', 'bank withdrawal');

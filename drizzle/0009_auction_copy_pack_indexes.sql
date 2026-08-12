CREATE INDEX "tcg_auctions_copyId_idx" ON "tcg_auctions" USING btree ("copy_id");--> statement-breakpoint
CREATE INDEX "tcg_auctions_packId_idx" ON "tcg_auctions" USING btree ("pack_id");
CREATE TABLE "rail_tycoon_chunks" (
	"world_id" text NOT NULL,
	"chunk_id" integer NOT NULL,
	"hash" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "rail_tycoon_chunks_world_id_chunk_id_pk" PRIMARY KEY("world_id","chunk_id")
);
--> statement-breakpoint
ALTER TABLE "rail_tycoon_chunks" ADD CONSTRAINT "rail_tycoon_chunks_world_id_rail_tycoon_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."rail_tycoon_worlds"("id") ON DELETE cascade ON UPDATE no action;
-- Task 2.7: chunks.embedding becomes vector(1536) (text-embedding-3-small) with an HNSW index.
-- Data-safe: an embedding of another dimension is never dropped or rewritten here. If one
-- exists the migration stops, so an operator decides what to do with it (re-embed it).
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "chunks" WHERE "embedding" IS NOT NULL AND vector_dims("embedding") <> 1536) THEN
		RAISE EXCEPTION 'chunks.embedding holds vectors that are not 1536-dimensional; re-embed them before this migration';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1536) USING "embedding"::vector(1536);--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);

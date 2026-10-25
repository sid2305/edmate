CREATE INDEX "chunks_transcript_created_at_idx" ON "chunks" USING btree ("kind","created_at") WHERE "chunks"."kind" = 'transcript';--> statement-breakpoint
CREATE INDEX "sessions_created_at_idx" ON "sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "turn_traces_created_at_idx" ON "turn_traces" USING btree ("created_at");
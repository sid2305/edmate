ALTER TABLE "documents" ADD COLUMN "live_class_id" text;--> statement-breakpoint
-- Hand-edited (task 11.4a). Additive only: a nullable column, no backfill, nothing dropped.
-- NOT VALID: the ADD CONSTRAINT takes ACCESS EXCLUSIVE only briefly (no scan under the lock); the
-- VALIDATE runs after migrate() commits, as an autocommit post-migrate step (packages/db/src/
-- migrate.ts POST_MIGRATE_STEPS), same pattern as 0009 (task 3.16b) and 0023 (task 12.4a). Every
-- existing row is null here, so the validation can't fail. ON DELETE SET NULL: deleting a live
-- class unlinks its recordings; it never blocks the delete or removes a document.
ALTER TABLE "documents" ADD CONSTRAINT "documents_live_class_id_live_classes_id_fk" FOREIGN KEY ("live_class_id") REFERENCES "public"."live_classes"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
-- Plain (not CONCURRENTLY) partial index: every existing row is null, so the build indexes nothing
-- and the documents table is small (one row per upload).
CREATE INDEX "documents_live_class_id_idx" ON "documents" USING btree ("live_class_id") WHERE "documents"."live_class_id" is not null;
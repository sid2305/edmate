CREATE TYPE "public"."document_status" AS ENUM('uploading', 'processing', 'ready', 'failed');--> statement-breakpoint
-- Hand-edited (task 8.2): every document written before this migration was already ingested, so
-- it is backfilled `ready`; only rows written afterwards start `uploading`.
ALTER TABLE "documents" ADD COLUMN "status" "document_status" DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'uploading';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_failure_reason_only_when_failed" CHECK ("documents"."failure_reason" is null or "documents"."status" = 'failed');

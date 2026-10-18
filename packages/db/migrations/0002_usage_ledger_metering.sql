CREATE TYPE "public"."entitlement_source" AS ENUM('subscription', 'teacher_preview', 'eval');--> statement-breakpoint
CREATE TYPE "public"."usage_status" AS ENUM('recorded', 'unknown', 'unpriced');--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "turn_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "source" "entitlement_source" NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "status" "usage_status" DEFAULT 'recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "reason" text;--> statement-breakpoint
CREATE INDEX "usage_ledger_teacher_id_turn_id_idx" ON "usage_ledger" USING btree ("teacher_id","turn_id");--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_counts_non_negative" CHECK ("usage_ledger"."input_tokens" >= 0 and "usage_ledger"."output_tokens" >= 0 and "usage_ledger"."cost_micro_usd" >= 0);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_reason_matches_status" CHECK (("usage_ledger"."status" = 'recorded' and "usage_ledger"."reason" is null and "usage_ledger"."model" <> '')
        or ("usage_ledger"."status" = 'unknown' and "usage_ledger"."reason" is not distinct from 'no_usage_reported'
          and "usage_ledger"."model" = '' and "usage_ledger"."input_tokens" = 0 and "usage_ledger"."output_tokens" = 0
          and "usage_ledger"."cost_micro_usd" = 0)
        or ("usage_ledger"."status" = 'unpriced' and "usage_ledger"."reason" is not distinct from ('unpriced_model:' || "usage_ledger"."model")
          and "usage_ledger"."model" <> '' and "usage_ledger"."cost_micro_usd" = 0));
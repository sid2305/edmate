CREATE TYPE "public"."entitlement_source" AS ENUM('subscription', 'teacher_preview', 'eval');--> statement-breakpoint
CREATE TYPE "public"."usage_status" AS ENUM('recorded', 'unknown', 'unpriced');--> statement-breakpoint
ALTER TABLE "usage_ledger" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ALTER COLUMN "input_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ALTER COLUMN "output_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ALTER COLUMN "cost_micro_usd" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "turn_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "source" "entitlement_source" NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "status" "usage_status" DEFAULT 'recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "reason" text;--> statement-breakpoint
CREATE INDEX "usage_ledger_teacher_id_turn_id_idx" ON "usage_ledger" USING btree ("teacher_id","turn_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_teacher_id_student_id_created_at_idx" ON "usage_ledger" USING btree ("teacher_id","student_id","created_at");--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_counts_non_negative" CHECK ("usage_ledger"."input_tokens" >= 0 and "usage_ledger"."output_tokens" >= 0 and "usage_ledger"."cost_micro_usd" >= 0);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_recorded_has_figures" CHECK ("usage_ledger"."status" <> 'recorded' or ("usage_ledger"."model" is not null and "usage_ledger"."input_tokens" is not null
        and "usage_ledger"."output_tokens" is not null and "usage_ledger"."cost_micro_usd" is not null));
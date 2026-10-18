CREATE TYPE "public"."audit_actor_role" AS ENUM('student', 'teacher', 'staff', 'system');--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "actor_role" SET DATA TYPE "public"."audit_actor_role" USING "actor_role"::text::"public"."audit_actor_role";--> statement-breakpoint
CREATE INDEX "usage_ledger_teacher_id_created_at_idx" ON "usage_ledger" USING btree ("teacher_id","created_at");
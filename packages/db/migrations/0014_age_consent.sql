ALTER TABLE "consents" ADD COLUMN "granted_by" text DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_year" smallint;--> statement-breakpoint
-- NOT VALID: each ADD CONSTRAINT still takes ACCESS EXCLUSIVE, but only briefly (no full-table
-- scan under the lock). Task 1.7a (1.7 review deferral), same pattern as migration 0009 (task
-- 3.16b): drizzle 0.45 runs every pending migration file in one transaction, so a VALIDATE
-- CONSTRAINT written here would still run under that same transaction's lock on these tables. It
-- instead runs as an autocommit step after migrate() commits (packages/db/src/migrate.ts's
-- runPostMigrateSteps), under its own lighter lock (SHARE UPDATE EXCLUSIVE).
ALTER TABLE "consents" ADD CONSTRAINT "consents_granted_by_check" CHECK ("consents"."granted_by" in ('self', 'parent')) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_birth_year_check" CHECK ("users"."birth_year" between 1900 and 2100) NOT VALID;
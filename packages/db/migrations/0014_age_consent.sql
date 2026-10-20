ALTER TABLE "consents" ADD COLUMN "granted_by" text DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_year" smallint;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_granted_by_check" CHECK ("consents"."granted_by" in ('self', 'parent'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_birth_year_check" CHECK ("users"."birth_year" between 1900 and 2100);
-- Task 5.3: one material revision counter per teacher. Every write to a teacher's documents or
-- chunks bumps it in the same transaction; leakCheck's cache key includes it (ADR-0007). Additive
-- only: a new table and its index, no change to existing tables or rows.
CREATE TABLE "teacher_material_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teacher_material_revisions" ADD CONSTRAINT "teacher_material_revisions_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_material_revisions_teacher_id_key" ON "teacher_material_revisions" USING btree ("teacher_id");
CREATE TYPE "public"."note_origin" AS ENUM('teacher_answer', 'correction');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('teacher_answer');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"teacher_question_id" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_eval_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"module_id" text NOT NULL,
	"origin" "note_origin" NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"chunk_id" text NOT NULL,
	"teacher_question_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_teacher_question_id_teacher_questions_id_fk" FOREIGN KEY ("teacher_question_id") REFERENCES "public"."teacher_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_eval_cases" ADD CONSTRAINT "teacher_eval_cases_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_eval_cases" ADD CONSTRAINT "teacher_eval_cases_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_student_id_teacher_question_id_key" ON "notifications" USING btree ("student_id","teacher_question_id");--> statement-breakpoint
CREATE INDEX "notifications_student_id_teacher_id_created_at_idx" ON "notifications" USING btree ("student_id","teacher_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_teacher_id_idx" ON "notifications" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "teacher_eval_cases_teacher_id_idx" ON "teacher_eval_cases" USING btree ("teacher_id");--> statement-breakpoint
-- Hand-edited (task 5.10): `teacher_questions.group_id` has existed since 0001 but was never set
-- (grouping starts in this task's Phase C); every row written before now backfills to its own id,
-- so a question is always its own group's oldest member until a later similar one joins it.
UPDATE "teacher_questions" SET "group_id" = "id" WHERE "group_id" IS NULL;
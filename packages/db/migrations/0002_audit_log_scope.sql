ALTER TABLE "audit_log" ADD COLUMN "actor_role" "user_role" NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "teacher_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "student_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_teacher_id_ts_idx" ON "audit_log" USING btree ("teacher_id","ts");--> statement-breakpoint
CREATE INDEX "audit_log_student_id_teacher_id_ts_idx" ON "audit_log" USING btree ("student_id","teacher_id","ts");
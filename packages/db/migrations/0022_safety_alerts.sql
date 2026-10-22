CREATE TABLE "safety_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"kind" text NOT NULL,
	"student_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"session_id" text NOT NULL,
	"excerpt_redacted" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"escalated_at" timestamp with time zone,
	"escalation_round" integer DEFAULT 0 NOT NULL,
	"last_paged_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"ack_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "safety_alerts_level_check" CHECK ("safety_alerts"."level" in ('info', 'alert', 'critical')),
	CONSTRAINT "safety_alerts_kind_check" CHECK ("safety_alerts"."kind" in ('distress', 'abuse', 'misuse', 'other')),
	CONSTRAINT "safety_alerts_ack_note_length" CHECK (char_length("safety_alerts"."ack_note") <= 500),
	CONSTRAINT "safety_alerts_ack_pair" CHECK (("safety_alerts"."acknowledged_at" is null) = ("safety_alerts"."acknowledged_by" is null)),
	CONSTRAINT "safety_alerts_escalation_round_non_negative" CHECK ("safety_alerts"."escalation_round" >= 0)
);
--> statement-breakpoint
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_alerts_open_created_at_id_idx" ON "safety_alerts" USING btree ("created_at","id") WHERE "safety_alerts"."acknowledged_at" is null;--> statement-breakpoint
CREATE INDEX "safety_alerts_teacher_id_created_at_idx" ON "safety_alerts" USING btree ("teacher_id","created_at");--> statement-breakpoint
CREATE INDEX "safety_alerts_student_id_teacher_id_idx" ON "safety_alerts" USING btree ("student_id","teacher_id");--> statement-breakpoint
CREATE INDEX "safety_alerts_session_id_idx" ON "safety_alerts" USING btree ("session_id");
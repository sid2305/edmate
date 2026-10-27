CREATE TABLE "mistake_tag_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"tag" text NOT NULL,
	"count" integer NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mistake_tag_proposals_status_check" CHECK ("mistake_tag_proposals"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "mistake_tag_proposals" ADD CONSTRAINT "mistake_tag_proposals_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_tag_proposals_teacher_id_tag_key" ON "mistake_tag_proposals" USING btree ("teacher_id","tag");--> statement-breakpoint
CREATE INDEX "mistake_tag_proposals_teacher_id_status_idx" ON "mistake_tag_proposals" USING btree ("teacher_id","status") WHERE "mistake_tag_proposals"."status" = 'pending';
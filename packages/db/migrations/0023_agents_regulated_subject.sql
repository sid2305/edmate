ALTER TABLE "agents" ADD COLUMN "regulated_subject" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "regulated_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "regulated_approved_by" text;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_regulated_approved_by_users_id_fk" FOREIGN KEY ("regulated_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_regulated_subject_check" CHECK ("agents"."regulated_subject" in ('investing', 'health', 'law'));--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_regulated_approval_check" CHECK (("agents"."regulated_approved_at" is null) = ("agents"."regulated_approved_by" is null) and ("agents"."regulated_approved_at" is null or "agents"."regulated_subject" is not null));--> statement-breakpoint
-- Hand-added (task 12.4a): backfill each agent's subject from its newest version's config, so no
-- subject already in a version is lost. Backfilled agents start unapproved. Additive only: one
-- UPDATE of the new column, nothing dropped or deleted. It runs inside the migration's
-- transaction, after the ALTER TABLEs above already hold the agents table lock.
UPDATE "agents" AS a
SET "regulated_subject" = newest.subject
FROM (
	SELECT DISTINCT ON (v."agent_id") v."agent_id", v."config"->>'regulatedSubject' AS subject
	FROM "agent_versions" AS v
	ORDER BY v."agent_id", v."version" DESC
) AS newest
WHERE newest."agent_id" = a."id"
	AND newest.subject IN ('investing', 'health', 'law');

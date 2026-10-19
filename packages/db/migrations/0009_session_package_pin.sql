-- Task 3.16: a session is pinned to the package version its entitlement resolved to, so a change
-- of package or version ends it (sessions follow the package). Additive columns, nullable so a
-- session that had already ended keeps no pin; a CHECK makes every open session carry one.
--
-- Existing open sessions lose nothing (lead answer and security plan review, 18 Oct 2026):
--   backfilled: the student's live (not ended) subscription with that teacher points at a package
--               version of the session's own agent; the session is pinned to that version.
--   ended:      no live subscription, or one for another agent's package (preview and eval
--               sessions have none). The session is ended (its messages and traces are kept) and
--               that student and teacher's last_summary is cleared, the same effect as
--               sessions.endOnPackageChange, so a summary of an unknown package can't reach the model.
--   already ended: left as they are, with no pin.
-- The counts are reported as a NOTICE.
ALTER TABLE "sessions" ADD COLUMN "package_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "package_version" integer;--> statement-breakpoint
DO $$
DECLARE
	already_ended integer;
	backfilled integer;
	ended integer;
BEGIN
	SELECT count(*) INTO already_ended FROM "sessions" WHERE "ended_at" IS NOT NULL;

	UPDATE "sessions" SET "package_id" = pv."package_id", "package_version" = pv."version", "updated_at" = now()
	FROM "subscriptions" sub
	JOIN "package_versions" pv ON pv."id" = sub."package_version_id"
	JOIN "packages" p ON p."id" = pv."package_id"
	WHERE "sessions"."ended_at" IS NULL
		AND sub."student_id" = "sessions"."student_id"
		AND sub."teacher_id" = "sessions"."teacher_id"
		AND sub."status" <> 'ended'
		AND pv."teacher_id" = "sessions"."teacher_id"
		AND p."teacher_id" = "sessions"."teacher_id"
		AND p."agent_id" = "sessions"."agent_id";
	GET DIAGNOSTICS backfilled = ROW_COUNT;

	UPDATE "learner_profiles" SET "last_summary" = NULL, "updated_at" = now()
	WHERE "last_summary" IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM "sessions"
			WHERE "sessions"."ended_at" IS NULL
				AND "sessions"."package_id" IS NULL
				AND "sessions"."student_id" = "learner_profiles"."student_id"
				AND "sessions"."teacher_id" = "learner_profiles"."teacher_id"
		);

	UPDATE "sessions" SET "ended_at" = now(), "updated_at" = now()
	WHERE "ended_at" IS NULL AND "package_id" IS NULL;
	GET DIAGNOSTICS ended = ROW_COUNT;

	RAISE NOTICE 'sessions package pin (3.16): % backfilled, % ended, % already ended', backfilled, ended, already_ended;
END $$;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_package_version_fk" FOREIGN KEY ("package_id","package_version") REFERENCES "public"."package_versions"("package_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_package_id_package_version_idx" ON "sessions" USING btree ("package_id","package_version");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_package_pin_complete" CHECK (("sessions"."package_id" is null) = ("sessions"."package_version" is null));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_open_has_package" CHECK ("sessions"."ended_at" is not null or "sessions"."package_id" is not null);
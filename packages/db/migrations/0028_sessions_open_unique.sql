-- Task 5.10d (deferred from 5.10b plan item 3): sessions.create inserted unconditionally on every
-- startSession call with no prior lookup, so two open sessions for one (teacher_id, student_id,
-- agent_id) triple could already exist. sessions.create becomes insert-or-return-existing on this
-- key (ON CONFLICT ... WHERE ended_at is null, inside one transaction), the same shape migration
-- 0011's teacherQuestions.open uses on a partial unique key.
--
-- sessions is the one table migrate.ts already calls out as needing CREATE INDEX CONCURRENTLY
-- (its own docstring on sessions_package_id_package_version_idx and
-- sessions_open_teacher_id_student_id_idx: "sessions is big and high-write, unlike
-- teacher_questions, so a plain migration is not proportionate here" — the inverse of 0011's own
-- comment). So this migration file carries only the data UPDATE below; the unique index itself is
-- schema-only in src/schema/learning.ts and built by the post-migrate step in src/migrate.ts.
--
-- Any existing duplicate open sessions for one triple would make that CREATE UNIQUE INDEX
-- CONCURRENTLY step fail, so this UPDATE (never a DELETE — sessions is append-only data) ends them
-- first, inside this migration's own transaction, strictly before the post-migrate step ever runs:
-- keep the newest open session per (teacher_id, student_id, agent_id) — the student's most recent
-- session is the one most likely to hold the live, useful help_state (today's open session they're
-- mid-conversation in); older ones are more likely abandoned tabs or a stale session a refresh
-- never closed. (The opposite of 0011's "oldest wins": a teacher_question has no analogous
-- in-progress state to prefer.)
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "teacher_id", "student_id", "agent_id"
           ORDER BY "created_at" DESC, "id" DESC
         ) AS rn
  FROM "sessions"
  WHERE "ended_at" IS NULL
)
UPDATE "sessions" SET "ended_at" = now()
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

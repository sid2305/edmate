-- Task 3.17: the live (3.7) runner attempt and the commit-step (3.17) fallback can both try to
-- open "the same" TeacherQuestion for one ask_teacher turn (a timed-out live attempt may still
-- land); teacherQuestionsRepo.open becomes insert-or-return-existing on this key, so both land on
-- one row instead of raising a duplicate (risk: high, see docs/tasks/3.17/handoff.md).
--
-- `md5(text)`, not `text` itself: text is up to LIMITS.turnTextMaxLength (8000 chars, well past a
-- btree index row's ~2.7 KB limit), so indexing it directly would fail on long questions; a
-- 32-char hex digest is always small. teacher_questions is small and low-write (unlike
-- `sessions`), so a plain (non-CONCURRENTLY) migration is proportionate, unlike 0009/0010 — this
-- is additive only (a new index on an existing column set) and drops no data.
--
-- Review fix round (3.17): any existing duplicate open rows on this key would make the new unique
-- index fail to create. Close them first instead of deleting them (append-only data): among open
-- rows sharing (teacher_id, student_id, agent_id, md5(text)), keep the oldest open and dismiss the
-- rest. `dismissed` is this enum's other terminal status besides `answered`; a duplicate was never
-- answered, so `dismissed` is the correct one.
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "teacher_id", "student_id", "agent_id", md5("text")
           ORDER BY "created_at" ASC, "id" ASC
         ) AS rn
  FROM "teacher_questions"
  WHERE "status" = 'open'
)
UPDATE "teacher_questions" SET "status" = 'dismissed', "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_questions_open_dedup_key" ON "teacher_questions" USING btree ("teacher_id","student_id","agent_id",md5("text")) WHERE "teacher_questions"."status" = 'open';

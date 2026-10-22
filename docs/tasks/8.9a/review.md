# 8.9a review — APPROVE

Reviewers: typescript-reviewer (sonnet), database-reviewer (sonnet), security-reviewer (sonnet), lead

`teacherQuestions.dismiss(scope, questionId)` is one scoped UPDATE (`id` + `teacher_id` + `status = 'open'`), the same shape as `notifications.markRead`. Another teacher's question, a missing id and an already-closed question all return `not_found` with no write, and the tests prove each case by re-reading the row. Dismissing one question leaves the rest of its group open and answerable (lead answer Q1). `'dismissed'` is already in the `teacher_question_status` enum, so there is no migration. The database reviewer checked the race with `answer`: whichever statement takes the row first wins, and the other sees `not_found`.

The typescript-reviewer also covered the code review (a single small repository method). The lead read the diff.

## Findings
- [LOW] [deferred 8.6f] packages/db/src/repositories/teacher-questions.ts — no test runs `dismiss` and `answer` concurrently on one row; the no-transaction design rests on Postgres re-checking the WHERE after a row lock. Add one concurrent test.

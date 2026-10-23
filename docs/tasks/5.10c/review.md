# 5.10c review — APPROVE

Reviewers: code-reviewer

Test-only change in packages/db/test/teacher-question-answer.int.test.ts. Forcing the real open() into the deadlock interleaving proved non-deterministic, so the test captures the SQL of open()'s multi-row FOR KEY SHARE lock read (by patching pg.Client.prototype.query for one call, restored in a finally) and asserts it orders by id. The builder showed that removing `.orderBy(teacherQuestions.id)` fails the test. The patch cannot leak: the file has no concurrent tests and vitest isolates modules per file.

## Findings

None.

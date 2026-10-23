# 5.10b review — APPROVE

Reviewers: database-reviewer, security-reviewer, code-reviewer, typescript-reviewer

answer() now takes the agent lock first and locks the group's open members in one id-ordered statement, and the fix round made open()'s similar-question lock id-ordered too, so the two can no longer deadlock. The concurrency tests use the raw-connection and lockWaiters pattern from publish.int.test.ts instead of timing races. code-reviewer and typescript-reviewer re-verified both HIGH findings as fixed. Migration 0025 adds an index only. The lead re-ran the db gate on the final commit: 1445 tests pass (4 skipped), integration tests included.

## Findings

- [HIGH] [fixed] packages/db/src/repositories/teacher-questions.ts:157 — open() locked the caller's similar rows FOR KEY SHARE in no order while answer() locked group rows ascending, so the two could deadlock (40P01); open() now orders by id.
- [HIGH] [fixed] packages/db/test/teacher-question-answer.int.test.ts:521 — the concurrency tests did not force the interleaving they claimed; rewritten with raw connections and lockWaiters.
- [MEDIUM] [fixed] packages/db/test/teacher-question-answer.int.test.ts:521 — (database-reviewer) the two-answers deadlock test could pass against the old lock order; now deterministic.
- [MEDIUM] [fixed] packages/db/test/teacher-question-answer.int.test.ts:521 — (security-reviewer) the same test could not fail reliably on the pre-fix code; now deterministic.
- [LOW] [deferred 5.10c] packages/db/test/teacher-question-answer.int.test.ts:521 — (code-reviewer re-verify) the open()-vs-answer() test replays open()'s lock statement on a raw connection instead of calling open(), so removing open()'s orderBy would not fail it.
- [LOW] [fixed] packages/db/src/repositories/teacher-questions.ts:318 — the answer() JSDoc described the old lock order.
- [LOW] [fixed] packages/db/src/repositories/question-similarity.ts:59 — bestGroup had an unreachable ternary branch.
- [LOW] [fixed] packages/db/src/repositories/teacher-questions.ts:401 — two lines were not prettier-formatted.
- [LOW] [fixed] packages/db/src/schema/learning.ts:279 — the index rationale said it serves listGroupsForTeacher; it serves open()'s grouping read.

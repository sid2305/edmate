# 5.10 review — APPROVE

Reviewers: code-reviewer (opus), typescript-reviewer (sonnet), database-reviewer (sonnet), security-reviewer (sonnet)

Isolation holds:
- A teacher never sees a student id.
- A student sees only their own notifications.
- An answer reaches only the students in its group, as one message in each student's own open session.
- The note citation carries no student text.
- `findSimilar` stays `[]`.

The migration is additive. The answer transaction is correct, and the CLI is redacted and file-fed. The real-clock flake in the acceptance test (the same class as 3.9b and 3.9d) and the weak "similar question" wording are fixed in fix round 1. code-reviewer re-checked them.

## Findings
- [HIGH] [fixed] packages/db/test/ask-teacher-loop.int.test.ts:94 — the acceptance test ran full turns on the real clock; tight entitle/decide/open budgets flake on a loaded runner; now a slack clock (10x, sleep and now together)
- [MEDIUM] [fixed] packages/db/test/ask-teacher-loop.int.test.ts:70 — Q2 and turn 3 matched Q1 word for word (stop word only, shared prefix), so "next similar question" wasn't tested; now honestly different wording
- [MEDIUM] [deferred 5.10b] packages/db/src/repositories/teacher-questions.ts:351 — two concurrent answers on members of one group can deadlock (40P01, fails safe); lock in id order
- [LOW] [deferred 5.10b] packages/db/src/repositories/teacher-questions.ts:154 — answer doesn't take the agent lock that open takes; a question opened mid-answer can stay open
- [LOW] [deferred 5.10b] packages/db/src/repositories/teacher-questions.ts:378 — the thread message and answer column keep the answer file's trailing newline
- [LOW] [deferred 5.10b] packages/db/src/repositories/teacher-questions.ts:400 — no unique partial index on open sessions per triple; the limit-1 workaround is sound for now
- [LOW] [deferred 5.10b] packages/db/src/repositories/question-similarity.ts:1 — bestGroup tokenises each candidate twice; the grouping query lacks a composite index
- [LOW] [wontfix] packages/db/src/repositories/teacher-questions.ts:235 — one non-null assertion, backed by the insert-or-collide comment

# 6.5a review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer, silent-failure-hunter

## Findings
- [HIGH] [fixed] packages/db/src/repositories/sessions.ts — `end` read `memory_reset_at` with a plain SELECT before writing `last_summary`; now read `FOR UPDATE` in the sessions-then-profile order `reset` uses, with a comment on the session-row serialisation (security-reviewer; database-reviewer and typescript-reviewer rated it MEDIUM/LOW). Re-reviewed by security-reviewer and database-reviewer: APPROVE.
- [HIGH] [fixed] packages/db/test/repositories.int.test.ts — edited despite the lead answer, with a conflict risk against 13.regate (database-reviewer). 13.regate merged first and the merge of main was clean; the change itself is correct (lead decision).
- [MEDIUM] [deferred 6.5c] apps/worker/src/commit/processors.ts — a watermark-dropped event is reported as `already_written`, indistinguishable from a replayed duplicate; the comment about an empty `applied` is now incomplete (silent-failure-hunter).
- [LOW] [deferred 6.5c] packages/db/src/repositories/learner.ts — `dropBeforeReset` drops stale events with no log or count; `sessions.end` skips a stale summary with the same `{ ended: true }` (silent-failure-hunter, typescript-reviewer, database-reviewer, security-reviewer).

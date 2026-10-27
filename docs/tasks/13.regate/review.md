# 13.regate review — APPROVE

Reviewers: security-reviewer, code-reviewer, typescript-reviewer, database-reviewer, silent-failure-hunter

## Findings
- [HIGH] [fixed] packages/db/src/repositories/publish.ts — `liveAgentsWithMaterialChange` treated any queued/running run as open with no age bound, so a stuck run excluded the agent from every later sweep; now bounded by `startRun`'s stale rule, with int tests for stale/older, fresh/older and stale/current revisions (silent-failure-hunter; also database-reviewer, security-reviewer, typescript-reviewer). Re-reviewed by silent-failure-hunter and database-reviewer: APPROVE.
- [MEDIUM] [fixed] apps/worker/src/regate/sweep.ts — an unexpected per-candidate error was logged like a routine refusal; now `error` level under `regate_sweep.candidate_error` with `describeError` (silent-failure-hunter). Re-reviewed: APPROVE.
- [MEDIUM] [deferred 13.regatea] packages/db/src/repositories/publish.ts — no partial index on eval_runs for the sweep's last-passed-published-gate-run lookup (database-reviewer, security-reviewer).
- [LOW] [fixed] apps/worker/src/regate/pins.ts — bare catch returning `content_missing` had no comment; comment added; the sweep logs `regate_sweep.pins_unavailable` at error level (silent-failure-hunter).
- [LOW] [fixed] packages/db/src/repositories/publish.ts — an agent could stay stuck behind a `queued` run after enqueue and its compensating finish both failed; covered by the stale bound above (typescript-reviewer).

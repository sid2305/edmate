# 3.8 review — APPROVE
Reviewers: security-reviewer (opus), database-reviewer (sonnet), silent-failure-hunter (sonnet)

All three approved. security-reviewer confirmed that the answer key stays in `sessions.help_state` and never reaches traces, events or logs, and that every queued write is scoped by the job's own ids. database-reviewer checked migrations 0007 (it stops if turn_traces has rows) and 0008 (index only), the idempotent retries and the ledger queries. silent-failure-hunter confirmed every failure is logged and a job that fails for good is dead-lettered. One fix round (6cbd25f), which the lead checked against the diff. Worker 102, db 401, queue 20 and harness 2,111 tests pass with Postgres and Redis up and nothing skipped. The secret scan is clean.

## Findings
- [MEDIUM] [fixed] apps/worker/src/commit/deadLetter.ts:79, packages/queue/src/queues.ts:50 — dead-letter entries kept the student's message text with no limit. Entries now keep only a whitelist of ids, the error and the attempt count. Failed and dead-letter jobs expire after 7 days (`FAILED_JOB_TTL_SECONDS`), and the worker prunes waiting entries hourly. Tests check that no student text appears in entries or logs.
- [MEDIUM] [fixed] packages/db/src/repositories/usage-ledger.ts:368 — `teacherIdsWithUsageSince` had no supporting index. Added `usage_ledger_created_at_source_idx` (migration 0008, which only creates the index).
- [MEDIUM] [fixed] apps/worker/src/commit/processors.ts:81 — `once()` swallowed the recheck error. It now logs `job.recheck_failed` (ids and error only), and the write's own error still decides whether the job is retried.
- [LOW] [fixed] apps/worker/src/commit/processors.ts:162 — the duplicate check read every trace in the session. It uses `turnTraces.findForTurn` now.
- [LOW] [deferred 3.7] packages/harness/src/pipeline/runner.ts:87 — `TurnRunResult.background` failures (meter, commit, trace) are collected but no caller logs them. 3.7's orchestrator is the first caller, so it logs them there.

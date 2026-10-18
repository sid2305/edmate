# 2.5 review — APPROVE
Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), silent-failure-hunter (sonnet)

security-reviewer confirmed "free" is decided server-side from the package version's stored price, paid subscriptions and other teachers are never touched (integration tests), pause and audit run in one transaction with `FOR UPDATE`, the `system` actor role can't be forged, alarm logs carry no student data, and errors are scrubbed. database-reviewer confirmed migration 0005 is correctly chained and data-safe, the monthly aggregate is index-backed and excludes eval, NULL-cost rows are counted separately, and the pause is idempotent and deadlock-safe. silent-failure-hunter confirmed unknown cost never becomes zero, a failed pause still alerts, and the friendly message falls back safely. Harness 1,913 tests, db 357 (real Postgres), worker 65.

## Findings
- [MEDIUM] [deferred 3.8] apps/worker/src/alarms/costAlarm.ts:516 — a per-teacher failure in `checkTeachersCost` is collected but not logged; the scheduler that wires it (worker queue, 3.8) must log every failure and retry next run.
- [MEDIUM] [deferred 3.14] packages/db/src/repositories/subscriptions.ts:95 — audit rows are inserted one at a time while row locks are held; batch them into one insert.
- [LOW] [wontfix] packages/db/src/repositories/subscriptions.ts:90 — a free package whose stored price is missing or malformed is never paused. See decision log 18 Oct 2026.
- [LOW] [wontfix] packages/db/migrations/0005_cost_alarm.sql — `CREATE INDEX` without CONCURRENTLY. See decision log 18 Oct 2026.

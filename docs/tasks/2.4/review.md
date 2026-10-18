# 2.4 review — APPROVE
Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), silent-failure-hunter (sonnet)

security-reviewer confirmed writes are scoped through the package's teacher (INSERT…SELECT ownership check), reads by StudentScope, no text/prompts/keys in rows or logs, scrubbed errors, and prices.yaml loads from a fixed path only. database-reviewer and silent-failure-hunter re-verified their findings at 9e6eb41. The migration relaxes NOT NULL on an empty table (no data lost); database-reviewer signed off on it. Gateway 264 tests, db 265 tests on real Postgres.

## Findings
- [CRITICAL] [fixed] packages/db/src/schema/learning.ts:110 — unknown/unpriced usage stored sentinel 0 cost, readable as free. Columns are nullable and store NULL. Re-verified by database-reviewer.
- [CRITICAL] [fixed] packages/gateway/src/router/router.ts:100 — a failed-over primary attempt wrote no ledger row. Each adapter is metered individually, so every provider attempt writes one row. Re-verified by silent-failure-hunter.
- [HIGH] [fixed] packages/db/migrations/0003_usage_ledger_metering.sql:9 — brittle cross-column CHECK. Replaced by "recorded rows have all figures" plus non-negative counts. Re-verified by database-reviewer.
- [MEDIUM] [fixed] packages/db/src/schema/learning.ts:127 — sumForStudent wasn't index-backed. Index (teacher_id, student_id, created_at). Re-verified by database-reviewer.
- [LOW] [fixed] packages/db/migrations/0003_usage_ledger_metering.sql — no time index for 2.5's rolling windows; covered by the same index.
- [MEDIUM] [deferred 3.8] packages/gateway/src/metering/meteredGateway.ts — a failed meter write is logged and lost; 3.8 moves metering onto the worker queue with retry.
- [LOW] [deferred 3.7] packages/db/src/repositories/ports.ts — `source` is taken from the caller; 3.7 must derive it from the entitlement, never the request.
- [LOW] [wontfix] packages/gateway/src/metering/meteredGateway.ts — generateObject and embed are recorded as unknown because the port carries no usage for them. See decision log 18 Oct 2026.

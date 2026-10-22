# 12.5a review — APPROVE

Reviewers: security-reviewer (sonnet; also as typescript-reviewer and code-reviewer), database-reviewer (sonnet), lead

The security reviewer re-ran the db gate on a scratch clone against a disposable Postgres (1230 passed, 100% coverage on safety-alerts.ts) and the 14 safety-alert integration tests. `record` and `markEscalated` are scoped through the alert's own session, so a wrong session, student or teacher is `not_found` with nothing written. Non-staff callers get `scope` on list and ack. A first ack writes exactly one audit row, a second is a no-op, and two concurrent acks wrote one row in each of 5 trials, matching the stated lock order. `listForStaff` returns only ids, level, kind, the scrubbed excerpt, timestamps, the round, ack fields and the teacher slug, and driver errors carry neither the excerpt nor the note. The scope.test.ts skip is justified: these methods take an alert or a staff id, not a scope object, and safety-alerts.test.ts shows bad input is `invalid` before any SQL. The database reviewer confirmed migration 0022 is additive only and matches the schema, the escalation upsert is concurrency-safe, and the ack can't deadlock with escalation.

## Findings
- [MEDIUM] [deferred 12.5d] packages/db/src/repositories/safety-alerts.ts — listForStaff orders by `escalated_at is null` first, so the (created_at, id) partial index can't give a top-N scan and Postgres sorts the open set in memory; fine while open alerts are few.
- [LOW] [deferred 12.5d] packages/db/src/schema/operations.ts — `acknowledged_by` is the one foreign key without an index; no query needs it yet.

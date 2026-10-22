# Handoff: 12.5a, the `safety_alerts` table and repository (12.5 Phase A)

Status: DONE

- Branch: `m12/12.5a-safety-alerts-repo` (built on local `work-125a`)
- Worktree: `.claude/worktrees/agent-a44fa22ba7b132f9d`
- Plan: `docs/tasks/12.5/plan.md`, Phase A

## Summary

A new `safety_alerts` table (migration `0022_safety_alerts.sql`, additive only: one CREATE TABLE,
four FKs on the new table, four CREATE INDEX) and `safetyAlertsRepo` with five methods:

- `record(alert)`: worker write; the contracts `SafetyAlert` is parsed, then inserted through the
  alert's own session (insert-select with `ownSession`), `on conflict (id) do nothing`. Returns
  `{ written }`; another pair's session, or an id already taken by another pair's alert, is
  `not_found`.
- `markEscalated(alert, round)`: upsert through the same scoping; `escalation_round =
  greatest(existing, round + 1)`, `escalated_at = coalesce(escalated_at, now())`,
  `last_paged_at = now()`; ack fields untouched; works when `record` never ran. Returns
  `{ round }` (the stored round).
- `isAcknowledged(alertId)`: id-validated; a missing row is `false`.
- `listForStaff(by, { status: 'open' | 'all', limit })`: `by` must be staff now (role-lock.ts),
  else `scope`. Open first, escalated first, oldest first; cap `SAFETY_ALERT_LIST_MAX_LIMIT` = 50.
  Ids, level, kind, scrubbed excerpt, timestamps, round, `acknowledgedBy`, `ackNote` and the
  teacher's public slug (left join, null without a profile). No name, email or phone.
- `acknowledge(by, { alertId, note? })`: one transaction; lock order (stated in the file header)
  is the acting user's role FOR SHARE, then the alert row FOR UPDATE. Already acknowledged →
  `{ acknowledged: false }`, nothing written; otherwise sets the ack fields and writes one
  `safety_alert.ack` audit row (note as `reason`, before/after hold timestamps and ids only,
  never the excerpt) in the same transaction.

## Files

- `packages/db/src/schema/operations.ts`, `packages/db/src/schema/index.ts`: the `safetyAlerts` table.
- `packages/db/migrations/0022_safety_alerts.sql`, `meta/0022_snapshot.json`, `meta/_journal.json` (drizzle-kit generate, after merging origin/main).
- `packages/db/src/repositories/safety-alerts.ts` (new), `index.ts` (register + export line), `README.md` (one section).
- Tests: `packages/db/test/safety-alerts.test.ts` (new), `safety-alerts.int.test.ts` (new), `leak.test.ts`, `schema.test.ts`, `helpers.ts` (`DATA_MODEL_TABLES` gains `safety_alerts`), `repositories.int.test.ts` (five isolation cases), `scope.test.ts` (skip for `safetyAlerts.*`, which take no scope object; covered by the unit and int tests).

## Tests

Tests were written first and failed (`safetyAlerts` undefined, no `safety_alerts` in the snapshot) before the implementation.

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` with `TEST_DATABASE_URL` set to a disposable container (`edmate-test-125a-pg`, 127.0.0.1:55722, removed after):
  ```
  @edmate/db:test:  Test Files  65 passed (65)
  @edmate/db:test:       Tests  1230 passed | 4 skipped (1234)
  @edmate/db:test: All files          |   99.82 |    97.94 |   99.86 |   99.84 |
  @edmate/db:test:   safety-alerts.ts |     100 |      100 |     100 |     100 |
   Tasks:    26 successful, 26 total
  ```
- `vitest run test/safety-alerts.int.test.ts` → `Tests 14 passed (14)` (record idempotent and scoped; markEscalated monotonic, creates the row, leaves ack fields alone; listForStaff non-staff `scope`, order, status filter, cap, exact column set, no personal data; acknowledge non-staff `scope` with nothing written, one audit row, second ack a no-op, unknown id `not_found`, two concurrent acks on two connections → one audit row, five times; isAcknowledged flips).
- `vitest run test/repositories.int.test.ts` → `Tests 153 passed (153)` (grid includes every `safetyAlerts.*` method).
- `corepack pnpm turbo run typecheck --filter=...@edmate/db` (dependents) → `Tasks: 11 successful, 11 total`.
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## Deviations

- `scope.test.ts` skips `safetyAlerts.*` (as it does `teacherProfiles.listPendingForStaff`): their first argument is an alert or a staff id, not a scope object, so a malformed one is `invalid` (as the plan asks), not `scope`.
- `markEscalated` returns `{ round }` (the plan didn't name a return value).
- The schema adds indexes led by `teacher_id`, `student_id` and `session_id` beyond the plan's partial index: `schema.test.ts` requires an index led by each of `teacher_id` and `student_id`.

## Decisions

### 22 Oct 2026 · 12.5a safety alerts are staff-only, the ack is audited and lock-ordered, no personal columns · decided by builder · risk: high
- Decided: `safety_alerts` stores ids, level, kind, the scrubbed excerpt and timestamps only. `listForStaff` and `acknowledge` require `by` to be staff now (via `role-lock.ts`; the repository never names the users table). `acknowledge` locks the actor's role FOR SHARE, then the alert row FOR UPDATE, and commits exactly one `safety_alert.ack` audit row with the ack (never the excerpt). Worker writes are scoped through the alert's own session. Reviewer: security-reviewer (risky path `packages/db/src/repositories/**`).
- Why: plan Phase A and lead answers Q1, Q3 and Q4; lessons "lock order".
- risk: high

### 22 Oct 2026 · 12.5a migration 0022 is additive only · decided by builder · risk: medium
- Decided: `0022_safety_alerts.sql` only creates the table, its constraints, its FKs and indexes; no drop, update, delete or change to another table. `schema.test.ts` asserts this. Reviewer: database-reviewer (recommended: new table, lock order, concurrent-ack test).
- Why: plan Phase A ("additive only"); generated after merging origin/main, 0022 was free.
- risk: medium

### 22 Oct 2026 · 12.5a listForStaff orders acknowledged alerts oldest first too · decided by builder · risk: low
- Decided: with `status: 'all'`, acknowledged alerts follow the open ones, oldest first (same key as open ones), and a staff read takes no lock beyond `lockRole`'s momentary share lock outside a transaction.
- Why: the plan sets the order only for open alerts; one simple, deterministic order keeps the query on one sort.
- risk: low

## Left to do

- Phase B (12.5b, apps/worker) and Phase C (12.5c, apps/web) use this repository.
- 13.4: add `safety_alerts` to the retention jobs (lead answer Q5).

Tool calls used: 87 (harness count; the builder reported 58)

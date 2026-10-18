# Task 2.5 handoff: friendly limit-reached message; monthly per-teacher cost alarm

Status: **DONE**
Branch: `m2/2.5-limits`
Worktree: `.claude/worktrees/agent-ac902ae21d2ca014e` (under the main checkout)
Reviewers needed: security-reviewer (risk path `packages/db/src/repositories/**`), database-reviewer
(migration 0005, free-package join, pause transaction), typescript-reviewer.

## Acceptance evidence

Accept: "the limit returns `limit_reached` with a friendly message; the alarm fires at the
threshold with the stated effects."

- **Friendly message.** `entitle` throws `TurnRejection('limit_reached', false, <text>)`. The text
  comes from `fallbackReplies.limitReached(input.lang)` when one is injected, and from the built-in
  English `DEFAULT_LIMIT_REACHED_REPLY` otherwise. The wire event keeps its frozen
  `{ type, code, retryable }` shape. Students see the text once the web turn surface (3.7 / M8)
  renders `TurnRejection.message`.
- **Alarm.** `checkTeacherCost` sums the calendar month (UTC, evals excluded). At or above 50 USD
  (50_000_000 micro-USD, configurable) it pauses the teacher's free subscriptions only, writing one
  `system` audit row each, then alerts staff and the teacher. Paid subscriptions are never paused.
  Calls with NULL cost are counted as `unknown` / `unpriced` and never counted as zero.

Commands (Node 22 from nvm, pnpm via corepack; Postgres from
`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`):

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness
  Tests 1909 passed (1909) · entitle.ts 100/100/100/100 · All files 99.38 st / 97.24 br
  entitle.test.ts: 57 tests (10 new in "limit_reached carries a friendly message (task 2.5)")

corepack pnpm turbo run typecheck lint test --filter=@edmate/db     (Postgres up: integration ran)
  Test Files 15 passed · Tests 356 passed
  subscriptions.ts / audit.ts 100/100/100/100 · usage-ledger.ts 100 st / 96.15 br / 100 / 100
  cost-alarm.int.test.ts: 16 passed (sums vs raw SQL; eval, last month and other teacher left out;
    free-only pause; paid/ended/paused untouched; other teacher untouched; audit rows; same-month
    rerun and staff unpause not re-paused; next month re-pauses; two concurrent runs pause once;
    bad options write nothing)
  repositories.int.test.ts: new CASES subscriptions.pauseFreeForTeacher, usageLedger.sumForTeacherSince;
    audit system-role mismatches (system role on a user id, staff role on a system_ id → scope)

corepack pnpm turbo run typecheck lint test --filter=@edmate/worker
  Tests 65 passed · src/alarms 100/100/100/100 (costAlarm.test.ts 38, logSink.test.ts 3)

corepack pnpm turbo run typecheck lint test            (root, after merging origin/main incl. 3.15)
  Tasks: 40 successful, 40 total
  harness 1913 · db 357 · worker 65 · contracts 322 · gateway 264 · web 132 · evals 103 ·
  content 93 · cli 46 · config 42 (all passed)
  Migration stays 0005 (main has no new migration); `pnpm install` leaves the lockfile unchanged.

python3 .githooks/secret-scan.py --all                 → no findings (exit 0)
```

`corepack pnpm format:check` flags only `.github/workflows/ci.yml`. That file is already
unformatted on main, and this branch does not touch it.

## Changes

- `packages/harness/src/pipeline/types.ts`: adds optional `FallbackReplies.limitReached(lang)`.
- `packages/harness/src/pipeline/steps/entitle.ts`: friendly `limit_reached` text, plus the
  `DEFAULT_LIMIT_REACHED_REPLY` fallback (used when the injected text is absent, empty, blank,
  not a string or throws). Exported from `pipeline/index.ts`.
- `packages/db/src/schema`: new enum `audit_actor_role` (`student, teacher, staff, system`), used
  by `audit_log.actor_role`; new index `usage_ledger_teacher_id_created_at_idx`.
- `packages/db/migrations/0005_cost_alarm.sql` (+ snapshot/journal): creates the enum, converts
  the column `USING actor_role::text::audit_actor_role` (every stored value maps to itself, no
  data lost), creates the index.
- `packages/db/src/repositories/usage-ledger.ts`: `sumForTeacherSince(scope, since)` and
  `TeacherUsageTotals`. A shared `totals()` helper now also backs `sumForStudent`.
- `packages/db/src/repositories/subscriptions.ts`: `pauseFreeForTeacher(scope, { monthStart,
  reason })`, `COST_ALARM_ACTOR`, `COST_ALARM_PAUSE_ACTION`, `PausedSubscription`.
- `packages/db/src/repositories/audit.ts` / `map.ts`: `system` role; the write path is exported
  as `insertAuditEntry(dbOrTx, ...)` so the pause can audit inside its own transaction.
- `apps/worker/src/alarms/`: `types.ts`, `costAlarm.ts` (`checkTeacherCost`, `checkTeachersCost`,
  `monthStartUtc`, `COST_ALARM_THRESHOLD_MICRO_USD`), `logSink.ts` (default JSON-line sink),
  `index.ts`, tests.
- Tests: `entitle.test.ts`, `schema.test.ts`, `repositories.int.test.ts`, new
  `cost-alarm.int.test.ts`; `repositories/README.md` documents the new methods.

## Deviations from the plan

- `limitReached` is **optional** on `FallbackReplies` and has a built-in English fallback, so
  `packages/harness/src/testing/testSteps.ts` is not touched. 3.15 builds there in parallel.
- **The audit rows are written by the repository**, inside the pause transaction, not by the worker.
  A pause can't commit without its audit row, and the row doubles as the once-a-month marker.
- **The `system` role is a new enum, not a new `user_role` value.** `audit_log.actor_role` moves
  to `audit_actor_role`, so no user can ever hold `system`.
- **Re-alerting.** Lead answer 4 says the alarm "can alert again", so every run at or over the
  threshold alerts (with only the newly paused ids). Plan test 5's "does not notify again" is
  superseded.
- **Extra event kind `cost_incomplete`.** When the known cost is below the threshold but some calls
  have no cost, staff get a warning. Nothing is paused. See Decisions.
- The worker does not depend on `@edmate/db`. Its port types mirror the repository methods
  structurally, and the composition root wires them. Nothing schedules the job yet (that is infra).

## Decisions

### 18 Oct 2026 · 2.5 Cost alarm pauses free subscriptions in one audited, teacher-scoped transaction · decided by builder · risk: high
Decided: `subscriptions.pauseFreeForTeacher(scope, { monthStart, reason })` runs a `SELECT … FOR UPDATE OF subscriptions`, then an `UPDATE`, then one audit insert per row, all in one transaction. The select finds the scope's teacher's trial / active / past_due subscriptions joined to their package version (same teacher) where `config->'pricePerMonth'->'amountMinor' = 0`, with no `subscription.pause_cost_alarm` audit row since `monthStart`. Each audit row is a student x teacher row: actor `system_cost_alarm`, role `system`, before/after status. The result has no student ids. `usageLedger.sumForTeacherSince(scope, since)` is a teacher-scoped read across students that leaves out `eval` rows. Both are in the isolation CASES grid.
Why: paid students keep access until staff decide, so a paid subscription is never touched. The audit row commits with the pause, and it is also the marker that keeps a staff unpause from being re-paused that month (lead answer 4: "store the override"), so no new table is needed. FOR UPDATE makes concurrent runs pause each row once (tested).
Alternatives: audit from the worker after the update (a pause could commit without its audit row); a separate override table.
Reversible: yes.

### 18 Oct 2026 · 2.5 Audit `system` role is its own enum; system actor ids start with `system_` · decided by builder · risk: high
Decided: new Postgres enum `audit_actor_role` (`student, teacher, staff, system`). Migration 0005 moves `audit_log.actor_role` to it with `USING actor_role::text::audit_actor_role`, which maps every stored value to itself. `user_role` is unchanged. `checkActor` requires `actor` to start with `system_` exactly when the role is `system`, so a system row can't name a user and a user role can't use a system id.
Why: lead answer 5 (add `system`). Adding `system` to `user_role` would let a user row hold it.
Alternatives: `ALTER TYPE user_role ADD VALUE 'system'`; a fixed staff sentinel id.
Reversible: yes (convert the column back once no `system` rows remain).

### 18 Oct 2026 · 2.5 Unknown cost below the threshold warns staff (`cost_incomplete`), never pauses · decided by builder · risk: low
Decided: when the month's known cost is below the threshold but there are unknown or unpriced calls, the alarm sends a `cost_incomplete` event to staff only. Nothing is paused. At or over the threshold the event (`threshold_reached`) goes to staff and the teacher, and it reports `unknownCalls` / `unpricedCalls` next to the cost.
Why: lead answer 3 says NULL cost is never treated as zero. A silent "below threshold" while costs are missing would do exactly that. Pausing on unknown cost would be guessing.
Alternatives: report the counts only on threshold events; treat any unknown as over the threshold.
Reversible: yes.

### 18 Oct 2026 · 2.5 The alarm re-alerts on every run over the threshold; a failed pause still alerts · decided by builder · risk: low
Decided: each run at or over the threshold sends an alert listing only the subscriptions that run paused. If the pause fails, the alert still goes out (`pauseFailed: true`) and then the error is rethrown so the job retries. If the alert fails after a pause, the run throws: the pause stands, and the retry alerts again. `checkTeachersCost` checks many teachers, keeps going past one teacher's failure and reports it. The 50 USD default is `COST_ALARM_THRESHOLD_MICRO_USD`, and `thresholdMicroUsd` overrides it (it must be a positive safe integer).
Why: lead answer 4 ("it can alert again"). Staff must know when a pause did not happen. How often alerts repeat depends on the job's schedule (infra).
Alternatives: alert once a month (would need its own marker).
Reversible: yes.

### 18 Oct 2026 · 2.5 `limitReached` is an optional fallback text with a built-in English default · decided by builder · risk: low
Decided: `FallbackReplies.limitReached?(lang)`. `entitle` uses it when it returns non-blank text, and `DEFAULT_LIMIT_REACHED_REPLY` otherwise (also when it throws). The text travels on `TurnRejection.message`; the wire event is unchanged.
Why: lead answer 1. Making it optional keeps `harness/src/testing` (3.15's area) untouched, and a broken locale still gives the student a reason.
Alternatives: required field (would change `testDeps`).
Reversible: yes (make it required once every composition root injects it).

### 18 Oct 2026 · 2.5 Review · decided by team lead · risk: low
Decided: packages/db/src/repositories/subscriptions.ts keeps treating a free package with a missing or malformed stored price as not free (never paused), and packages/db/migrations/0005_cost_alarm.sql builds its index without CONCURRENTLY, like every earlier migration.
Why: Failing closed protects paid students; content validation (1.8) and package publishing guarantee a price. The usage table is small before the pilot.
Alternatives: Alert on a missing price; CONCURRENTLY indexes.
Reversible: Yes.

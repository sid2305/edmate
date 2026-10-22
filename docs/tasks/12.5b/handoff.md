# Handoff: 12.5b, the alert worker persists and reads acks from the DB (12.5 Phase B)

Status: DONE

- Branch: `m12/12.5b-alert-worker-acks` (built on local `work-125b`)
- Worktree: `.claude/worktrees/agent-a300451e35b050ee5`
- Plan: `docs/tasks/12.5/plan.md`, Phase B. Reads 12.5a's repository
  (`docs/tasks/12.5a/handoff.md`): `record`, `markEscalated`, `isAcknowledged`, `listForStaff`,
  `acknowledge` on `safetyAlertsRepo`.

## Summary

The safety-alert worker (task 4.3) now persists every alert and its escalations in `safety_alerts`
(12.5a), and the DB is the ack source of truth, not Redis:

- `apps/worker/src/alerts/types.ts`: a worker-local `AlertStore` (`record`, `markEscalated`) next
  to the existing `AckStore`.
- `apps/worker/src/alerts/dbStore.ts` (new): `dbAlertStore(repo)` implements both `AlertStore` and
  `AckStore` over `safetyAlertsRepo`. `acknowledge` always rejects ("use the staff console"): the
  worker never acknowledges; that is 12.5c's job.
- `apps/worker/src/alerts/processors.ts`:
  - **raise**: `store.record(alert)`, then notify the trust team regardless of whether the record
    succeeded. A record failure is logged (`safety_alert.store_failed`, ids and the error name
    only) and the job then throws, so BullMQ retries the write (a duplicate trust-team notice on
    retry is accepted, as already documented).
  - **check**: `store.isAcknowledged(alert.id)` is the ack read. **A failed read counts as not
    acknowledged** (fail closed) and is logged (`safety_alert.ack_read_failed`); it never throws,
    so a DB hiccup can't silently stop paging. Acknowledged: stop, nothing else runs. Otherwise:
    schedule round n+1 first (unchanged), then `store.markEscalated(alert, round)` -- a failure
    there is logged (`safety_alert.mark_escalated_failed`) but not thrown (a throw would retry the
    whole check on the 30 s backoff and could page far more than once per interval) -- then page
    on-call.
- `apps/worker/src/alerts/workers.ts`: `AlertWorkerOptions.ackStore` is now `store: AlertStore &
  AckStore`, passed straight through to the processor.
- `apps/worker/src/alerts/index.ts`: exports `dbAlertStore`, `SafetyAlertsRepo` and the new
  `AlertStore` type.
- `apps/worker/src/index.ts` (shared, 11.3b/8.2e/8.2h also wire workers here; merged clean): the
  alert worker now gets `store: dbAlertStore(db.repos.safetyAlerts)` instead of
  `ackStore: redisAckStore(connection)`. `redisAckStore` stays exported, unwired (lead answer Q6).

## Files

- `apps/worker/src/alerts/types.ts`, `dbStore.ts` (new), `dbStore.test.ts` (new), `processors.ts`,
  `processors.test.ts`, `workers.ts`, `workers.test.ts`, `index.ts`, `../index.ts`.
- `apps/worker/test/alert.int.test.ts` (updated: `ackStore` -> `store`, via a local
  `inMemoryAlertStore` wrapper around `redisAckStore` -- this file stays Redis-only, as the plan
  asks; no DB).
- `apps/worker/test/alertInbox.int.test.ts` (new, Redis + Postgres): acceptance cases 1(a)-(c).

## Tests

Tests were written first (`processors.test.ts`'s new/changed cases, `dbStore.test.ts`,
`alertInbox.int.test.ts`) and failed before the implementation (`store` undefined on
`AlertProcessorDeps`, `dbAlertStore` not exported, no `safety_alerts` row after a raise).

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` (after merging
  `origin/main`):
  ```
  @edmate/worker:test:  Test Files  28 passed | 6 skipped (34)
  @edmate/worker:test:       Tests  316 passed | 30 skipped (346)
   Tasks:    38 successful, 38 total
  ```
  (the 6 skipped files are the Postgres/Redis integration suites, which need the services below;
  they ran separately.)
- Disposable containers (`edmate-test-125b-pg` on 127.0.0.1:55723, pgvector/pgvector:0.8.1-pg16;
  `edmate-test-125b-redis` on 127.0.0.1:56380, redis:7.4.6-alpine; both removed after):
  - `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55723/edmate
    TEST_REDIS_URL=redis://127.0.0.1:56380 vitest run test/alertInbox.int.test.ts`:
    ```
     Test Files  1 passed (1)
          Tests  4 passed (4)
    ```
    Covers acceptance 1(a) (not acknowledged: `escalated_at` set, `escalation_round >= 1`, paged
    every ~300 ms interval), 1(b) (acknowledged via the repository before the first check: never
    escalated, `escalation_round` stays 0, never paged), 1(c) (acknowledged after the first
    escalation: `escalation_round` stops advancing, and exactly one `safety_alert.ack` row in
    `audit_log` with `target = safety_alert:<id>`), and that no log line carries the excerpt.
  - `TEST_REDIS_URL=redis://127.0.0.1:56380 vitest run test/alert.int.test.ts` (the existing 4.3
    suite, now on the in-memory `AlertStore` wrapper): `Tests 5 passed (5)`.
- `python3 .githooks/secret-scan.py --all` -> clean (no output).

## Deviations

- `AlertWorkerOptions.ackStore` is renamed `store: AlertStore & AckStore` (the plan says "pass the
  `store` option through" without naming the old field); every caller and test updated.
- The existing `an ack-store failure rejects (retried)` test in `processors.test.ts` is rewritten
  to the new, intended behaviour (a failed ack read pages and logs, never throws) per the plan's
  acceptance text; this is a deliberate behaviour change from 4.3, not a regression.
- `alert.int.test.ts` keeps `ackStore`'s Redis-only shape by wrapping it in a trivial in-memory
  `AlertStore` (`record`/`markEscalated` both no-ops) so it still needs no Postgres, per the plan
  ("stays Redis-only with an in-memory store").

## Decisions

### 22 Oct 2026 · 12.5b the DB is the ack source of truth; a failed ack read pages, a failed escalation mark never stops a page · decided by builder · risk: high
- Decided: the alert worker's `isAcknowledged` reads `safety_alerts` (via `dbAlertStore`), not
  Redis. A failed read is treated as "not acknowledged" (fails closed: pages and logs
  `safety_alert.ack_read_failed`) rather than rejecting the job. A failed `markEscalated` write is
  logged (`safety_alert.mark_escalated_failed`) but does not throw, so the on-call page still goes
  out on schedule; a throw there would retry the whole check job on the queue's 30 s backoff and
  could page on-call far more than once per interval. `dbAlertStore.acknowledge` always rejects:
  only the staff console (12.5c) may acknowledge. Reviewer: code-reviewer (risky path
  `apps/worker/src/alerts/**`, the student-safety group; safety-reviewer returns at 13.3, per the
  MVP rule). silent-failure-hunter recommended for the retry/failure policy.
- Why: plan Phase B ("A failed ack read counts as not acknowledged... If that fails, log the error
  but do not throw"); lead answer Q6 (the DB is the only ack store).
- risk: high

### 22 Oct 2026 · 12.5b a record failure on raise still notifies, then throws to retry the write · decided by builder · risk: medium
- Decided: `alert.raise` calls `store.record(alert)` before notifying; if it fails, the trust-team
  notice still goes out, the failure is logged with ids and the error name only
  (`safety_alert.store_failed`), and the job then throws so BullMQ retries (eventually writing the
  row). A duplicate trust-team notice on a retry is accepted, as the file's own header already
  documents for this processor.
- Why: plan Phase B ("record, then notify... If record failed, still notify, log... then throw so
  BullMQ retries").
- risk: medium

### 22 Oct 2026 · 12.5b `AlertWorkerOptions.ackStore` becomes `store: AlertStore & AckStore` · decided by builder · risk: low
- Decided: one combined dependency (`store`) replaces the separate `ackStore` across
  `AlertProcessorDeps`, `AlertWorkerOptions`, the worker entrypoint and every test; `redisAckStore`
  stays exported from the barrel but is no longer wired into the production worker.
- Why: `dbAlertStore` implements both `AlertStore` and `AckStore` over the same repository, and the
  plan's "pass the `store` option through" implies one dependency, not two.
- risk: low

## Left to do

- Phase C (12.5c, apps/web) builds the staff inbox and API on this worker's writes and 12.5a's
  `listForStaff`/`acknowledge`.
- 13.4: add `safety_alerts` to the retention jobs (lead answer Q5, carried from 12.5a).
- 4.3c: real paging (SMS/email) replaces the structured log line; vendor accounts, on-call phone
  and email stay the human's to supply, never committed here.

Tool calls used: 103 (harness count; the builder reported 44)

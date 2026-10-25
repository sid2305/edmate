**Status:** DONE

## What changed
- `apps/worker/src/alerts/processors.ts`: `errorName` now delegates to `log.ts`'s `describeError`
  (a non-Error rejection reports `typeof value`, e.g. `'undefined'`, instead of a fixed
  `'UnknownError'`). `asStoreError` became `asJobError(prefix, thrown)`, shared by the `notify`
  call (now wrapped in `try/catch`) and the store-failure path. The `storeFailed` branch now calls
  `classify('alert.raise', storeError)` (imported from `../commit/processors.js`, already used the
  same way by `alerts/safetyEvents.ts`): a permanent `RepositoryError` (`not_found`/`invalid`/
  `scope`/`integrity`) becomes a `PermanentJobError` and ends the job after the one page that
  already ran; a `failed` (db down) error or any non-`RepositoryError` value keeps retrying,
  wrapped only if it isn't an `Error`. Top-of-file comment updated to describe the new permanent
  path.
- `apps/worker/src/alerts/processors.test.ts`: updated the `undefined`-rejection test's expected
  message/log field from `'UnknownError'` to `'undefined'`; added `RepositoryError` import from
  `@edmate/db`; added a `notifyRejectsWith` `world()` option; added two new tests (named below).
  All pre-existing tests re-run unchanged otherwise.
- `apps/worker/src/alerts/workers.ts`: top comment now also names a permanent store error as a
  job-ending failure, alongside a malformed payload.

## Evidence
`corepack pnpm turbo run typecheck lint test --filter=@edmate/worker --force` (with
`TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate` and
`TEST_REDIS_URL=redis://127.0.0.1:56379` so the integration suites ran, not skipped):
`Tasks: 11 successful, 11 total`; worker test run: `Test Files 37 passed (37)`,
`Tests 388 passed (388)` — no skips.

New/updated tests in `apps/worker/src/alerts/processors.test.ts`:
- `'a store that rejects with undefined still fails the job after notify, so it retries (12.5f)'`
  (updated: expects `'undefined'`, not `'UnknownError'`) — passes.
- `'a permanent store error (not_found) ends the job after one page'` (new, required) — passes.
- `'notify rejecting with a non-Error value fails the job with an Error that keeps it as cause'`
  (new) — passes.

`python3 .githooks/secret-scan.py --all` — clean (no output).

## Decisions

### 24 Oct 2026 · 12.5g alert worker: permanent store error ends the job after one page · decided by builder · risk: high
- Decided: `apps/worker/src/alerts/processors.ts`'s `alert.raise` branch now reuses
  `commit/processors.ts`'s `classify` to end the job (`PermanentJobError`) on a permanent
  `RepositoryError` from `store.record` (not_found/invalid/scope/integrity), after exactly one
  `notify`; `notify` failures and store failures that aren't an `Error` are wrapped by a shared
  `asJobError` helper so BullMQ always sees a real `Error`, and `errorName` now delegates to
  `log.ts`'s `describeError` for a non-`Error` rejection's name.
- Why: this follows the plan at `docs/tasks/12.5g/plan.md` exactly (reusing the same classifier
  `alerts/safetyEvents.ts` already uses, and the worker-wide `describeError` convention), closing
  the three LOWs deferred from `docs/tasks/12.5f/review.md` without inventing new logic on a
  student-safety path.

## Budget
Tool calls used: 21

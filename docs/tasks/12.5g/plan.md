# 12.5g plan — alert worker: permanent store error ends the job; notify wraps non-Error; errorName is useful

## Acceptance (verbatim)
worker typecheck, lint and test green; a test that a permanent store error ends the job after one page.

How it is shown: `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker` exits 0 in the
handoff's Evidence section (same as 12.5f), plus the new/updated tests named below passing, quoted
in the handoff.

## Context
12.5f fixed the store-failure flag (a non-Error `store.record` rejection now always fails the job).
Its review (`docs/tasks/12.5f/review.md`) deferred three LOWs here, all in
`apps/worker/src/alerts/processors.ts`:
1. `notify` can still reject with a non-Error (the mirror of the fixed store case).
2. `errorName` records only `UnknownError` for non-Error rejections.
3. A permanent `not_found`/`invalid` store error retries up to 1,000,000 times and re-pages every
   30 s (pre-existing) — it should end the job after one page instead.

`apps/worker/src/ingest/processor.ts`'s `classifyRepoError` and `apps/worker/src/commit/processors.ts`'s
exported `classify` already draw the permanent/transient line for a `RepositoryError`: any kind but
`failed` (db down) becomes a `PermanentJobError` (which `permanentToUnrecoverable` in
`apps/worker/src/commit/workers.ts` turns into BullMQ's `UnrecoverableError`, ending the job for
good); `failed` and anything that isn't a `RepositoryError` stays retryable. `apps/worker/src/alerts/safetyEvents.ts`
already reuses `classify` directly (`return classify(job.name, error);` in its catch block) — the
same package, same directory. This plan reuses it the same way instead of inventing a new classifier.

For finding 2, `apps/worker/src/log.ts`'s `describeError` is the worker-wide convention (used by
every other file in `apps/worker/src`, including `alerts/safetyEvents.ts` and `alerts/workers.ts`):
for a non-`Error` value its `name` is `typeof value` ('string', 'undefined', 'object', ...), not a
fixed placeholder. `alerts/processors.ts`'s local `errorName` duplicates `describeError`'s Error
branch but falls back to the fixed string `'UnknownError'`. Delegating to `describeError` fixes
finding 2 with an already-tested helper, no new logic.

## Files to create/modify
- **`apps/worker/src/alerts/processors.ts`** (the only logic change):
  - Import `classify` alongside the existing `PermanentJobError` from `'../commit/processors.js'`,
    and `RepositoryError` from `'@edmate/db'` is **not** needed directly — `classify` already does
    the `instanceof RepositoryError` check internally (see `safetyEvents.ts`'s usage); callers just
    forward the caught value.
  - Change the `../log.js` import to pull in `describeError` too (keep `type Log`).
  - Rewrite `errorName` to delegate: `function errorName(e: unknown): string { return describeError(e).name; }`.
    (Same behaviour for an `Error`; a non-Error now gets `typeof e`, e.g. `'undefined'`, `'string'`.)
  - Generalize `asStoreError(thrown)` into `asJobError(prefix: string, thrown: unknown): Error`
    (same body, `prefix` replaces the hardcoded `'safety_alert.store_failed'` text) so both the
    store and the notify call sites share it.
  - In the `JOB.alertRaise` branch:
    - Wrap the `await notify(alert, 'trust_team')` call in `try { … } catch (error) { throw asJobError('safety_alert.notify_failed', error); }`.
      This keeps today's control flow (a notify failure still skips the `safety_alert.notified`
      info log and the store-failure throw below, exactly as an unwrapped throw did) and only
      changes what gets thrown when the rejection isn't an `Error`.
    - Replace `if (storeFailed) throw asStoreError(storeError);` with:
      ```ts
      if (storeFailed) {
        try {
          classify('alert.raise', storeError);
        } catch (error) {
          throw asJobError('safety_alert.store_failed', error);
        }
      }
      ```
      Walk-through: a permanent `RepositoryError` (`scope`/`not_found`/`invalid`/`integrity`) makes
      `classify` throw `PermanentJobError` — already an `Error`, so `asJobError` passes it through
      unchanged and the job ends (dead-lettered) after the one `notify` that already ran. A
      `RepositoryError('failed', …)` (db down) or any non-`RepositoryError` value makes `classify`
      rethrow the original value unchanged; `asJobError` then wraps it only if it isn't an `Error`
      (identical to today's behaviour for the existing `recordFails`/`recordRejectsWith` tests).
  - Update the file's top comment (lines 1–17): it currently says "Every failure but a malformed
    payload is retried with no practical attempt limit" — add a line noting a permanent store
    error (not_found/invalid/scope/integrity) now ends the job after the one page that already
    ran, same as a malformed payload.
  - Leave `JOB.alertEscalateCheck` untouched: `markEscalated`'s failure is deliberately logged, not
    thrown (a throw there would retry the whole check and could page far more than once per
    interval — see the existing comment at the top of the file). This task's LOWs are about
    `alertRaise` only; the escalate-check path is out of scope.

- **`apps/worker/src/alerts/processors.test.ts`** (tests first, red before the fix):
  - Update the existing `'a store that rejects with undefined still fails the job after notify, so
    it retries (12.5f)'` test: the thrown message and the `safety_alert.store_failed` log line's
    `error` field change from `'UnknownError'` to `'undefined'` (describeError's `typeof undefined`).
    This is a required update, not new coverage — the behaviour genuinely changes.
  - Add `recordRejectsWith: { value: new RepositoryError('not_found', 'safetyAlerts.record') }` as
    a usable `recordRejectsWith` value (no new `world()` option needed — it already accepts any
    value) and add the required test:
    **"a permanent store error (not_found) ends the job after one page"**: `store.record` rejects
    with `new RepositoryError('not_found', 'safetyAlerts.record')`; assert
    `await expect(w.process(...)).rejects.toBeInstanceOf(PermanentJobError)`; assert `w.notified`
    equals exactly one entry (`{ id: 'alert_1', audience: 'trust_team' }` — one page, not a retry
    loop); assert `w.lines` contains both the `safety_alert.store_failed` error log (`error:
    'RepositoryError'`) and the `safety_alert.notified` info log (both already ran before the
    permanent throw).
  - Add a new `world()` option, `notifyRejectsWith?: { value: unknown }` (mirrors
    `recordRejectsWith`), so the fake notifier can reject with a non-Error value once.
  - Add a test **"notify rejecting with a non-Error value fails the job with an Error that keeps
    it as cause"**: `notifyRejectsWith: { value: 'ECONNRESET' }`; assert the thrown value is an
    `Error` whose `cause` is `'ECONNRESET'` and whose message does not contain `'ECONNRESET'`
    (mirrors the existing 12.5f store test of the same shape at line 142).
  - Import `RepositoryError` from `@edmate/db` in the test file.

- **`apps/worker/src/alerts/workers.ts`** (comment only, no logic change): the top-of-file comment
  says "A malformed payload is the only failure that ends the job" — update it to also name a
  permanent store error, so the file doesn't document stale behaviour (no test needed for a
  comment; `permanentToUnrecoverable` already has its own coverage in `commit/workers.test.ts` and
  `alerts/workers.test.ts`).

## Files out of bounds
Everything else, in particular:
- `apps/worker/src/commit/processors.ts` (`classify`, `PermanentJobError`) — reused, not modified.
- `apps/worker/src/alerts/dbStore.ts`, `safetyEvents.ts`, `ackStore.ts`, `logSink.ts`, `types.ts` — unchanged.
- `packages/db/src/repositories/safety-alerts.ts`, `packages/queue/**` — unchanged; this task only
  changes how the worker reacts to the errors they already throw.
- The `JOB.alertEscalateCheck` branch and its tests — out of scope (see above).

## Tests (first, red before the fix)
All in `apps/worker/src/alerts/processors.test.ts`:
1. Updated: the `undefined`-rejection test's expected message/log field change from `'UnknownError'`
   to `'undefined'`.
2. New, required by the board acceptance: a permanent (`not_found`) store error ends the job
   (`PermanentJobError`) after exactly one `notify` call and one page, with both log lines present.
3. New: `notify` rejecting with a non-Error value (`'ECONNRESET'`) fails the job with an `Error`
   whose `cause` is the original value and whose message does not contain it.
4. Re-run (unchanged expectations, confirming no regression): the plain-`Error` `recordFails` and
   `notifyFails` tests, the joint-outage test, the non-Error-string store-rejection test, and both
   `escalate_check` tests.

Run: `corepack pnpm exec vitest run src/alerts/processors.test.ts` (red, then green), then
`corepack pnpm turbo run typecheck lint test --filter=@edmate/worker --force` (full package green,
same evidence shape as 12.5f's handoff).

## Risky paths touched
- `apps/worker/src/alerts/**` matches `.claude/skills/merge-gate/risk-paths.txt`'s first group
  (student safety and teaching behaviour). Required reviewer right now: **code-reviewer** only —
  the MVP exemption (human decision, 20 Oct 2026) holds until task 13.3 restores
  `safety-reviewer` on this group before real students. `review.md`'s `Reviewers:` line must name
  `code-reviewer`; the handoff's `## Decisions` needs a `risk: high` entry (board already marks
  this task `risk: high`).
- No contracts, `.claude/**`, auth, payments or identity paths are touched — no other reviewer
  group applies.

## Open questions (with recommendation)
1. Should the `invalid`/`scope`/`integrity` `RepositoryError` kinds each get their own dedicated
   test, beyond the required `not_found` one? **Recommend no** — `classify`'s `PERMANENT_KINDS` set
   is already covered generically by `commit/processors.test.ts` and `alerts/safetyEvents.test.ts`;
   one `not_found` test here is enough to prove `alert.raise` is wired to the same classifier, and
   matches the acceptance text exactly ("a permanent store error ends the job after one page").
2. Should a wrapped `notify` failure get its own log line (symmetry with `safety_alert.store_failed`)?
   **Recommend no** — today a `notify` rejection logs nothing before propagating (BullMQ's own retry
   logging covers it); adding a new log line is scope creep beyond the three named LOWs and would
   need its own test and reviewer attention. Keep this task to wrapping the thrown value only.
3. Should `apps/worker/src/alerts/workers.ts`'s stale comment be left alone to minimize the diff?
   **Recommend fix it** — it is a one-line, no-test prose change in a file already in scope for the
   risk-paths reviewer, and leaving it would misdocument the exact behaviour this task changes.

## Budget
Budget: 40 tool calls (1 phase, apps/worker package)

## Allowed tools
Read, Grep, Glob, Edit, Bash (tests and secret scan only)

## Exit conditions
Status: DONE when `apps/worker/src/alerts/processors.ts` and `processors.test.ts` have the changes
above, the new permanent-store-error and notify-non-Error tests pass, the updated `undefined`-case
test passes, `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker` exits 0, and
`python3 .githooks/secret-scan.py --all` is clean. Status: PARTIAL past ~45 tool calls, or if a file
outside this plan's list (e.g. `commit/processors.ts`, `safetyEvents.ts`, the escalate_check branch)
turns out to need changes — stop and hand back rather than widening scope.

## Lead answers (24 Oct 2026)
Plan reviewed by the lead before the build (safety path: apps/worker/src/alerts/**).
1. Q1: no extra per-kind tests; the one `not_found` test is enough.
2. Q2: no new notify log line; wrap the thrown value only.
3. Q3: fix the stale apps/worker/src/alerts/workers.ts comment.
Branch: m13/12.5g-alert-permanent-error. Reviewer: code-reviewer (MVP exemption until 13.3). Builder: Sonnet, 40 calls (stop at 55).

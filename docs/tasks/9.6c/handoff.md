# 9.6c: plan-change methods (changePackage, pause, resume, cancel)

## Summary

Implements Phase C of `docs/tasks/9.6/plan.md`: four new methods on
`packages/db/src/repositories/subscriptions.ts` so a student can change their live
subscription's package, pause it, resume it, or cancel it, all gated by the same
live-version/live-agent checks `start` already uses (and now also applies to `start` itself,
closing a gap flagged by 9.3b).

- `changePackage(scope, { subscriptionId, packageVersionId })`: the subscription must be
  `trial | active | past_due`; the target must be a *different* version than the one it's on;
  the target must be the live version of a *live* agent's package (any package of that agent,
  not just the one currently subscribed); status and period_end are left untouched (no payment
  model yet — see the lead decision below). Audits `subscription.change_package`.
- `pause(scope, { subscriptionId })`: same status gate as `changePackage`; sets `paused`.
  Audits `subscription.pause_student`.
- `resume(scope, { subscriptionId })`: requires `paused`; looks at the *latest* audit row for
  the subscription and only resumes if that row is the student's own
  `subscription.pause_student` (rejects a cost-alarm pause, a missing audit row, or any
  non-student pause) restoring the `before.status` it recorded. Audits
  `subscription.resume_student`.
- `cancel(scope, { subscriptionId })`: any non-`ended` status becomes `ended` immediately (no
  period-end delay — see the lead decision below). Audits `subscription.cancel_student`.

All four, and the pre-existing `start`, lock the subscription row first (`SELECT ... FOR UPDATE`)
and never lock `packages`/`package_versions`/`agents` — a module comment in `subscriptions.ts`
states this lock order once, next to `lockLive`, so none of these methods can deadlock against
each other (the lesson from 8.7a/5.10b). Scope is parsed before any other argument (test-enforced
by `test/scope.test.ts`); audit rows carry only status and package-version ids (`StatusSnapshot`),
never personal data; all errors are the existing `RepositoryError` kinds, never raw driver text
(enforced by `test/leak.test.ts`, extended to cover the four new methods).

## Files

- `packages/db/src/repositories/subscriptions.ts` — the four new methods, `lockLive`,
  `writeChangeAudit`, the lock-order comment, and `start`'s extended live-version/live-agent join.
- `packages/db/test/repositories.int.test.ts` — isolation-grid `CASES` entries for the four
  methods (shared file, additive only); a self-contained `describe('task 9.6c: plan-change
  methods', ...)` fixture and test block (not_found cases, the happy path + audit shape,
  paused/ended rejection, resume's three refusal cases + two integrity cases + restore, cancel +
  restart, `start`'s own live-version/live-agent refusal, and the two-parallel-pause concurrency
  test).
- `packages/db/test/isolation-seed.ts` — added a second, also-live package
  (`pkg2`/`packageVersion2`) per teacher, same agent, so `changePackage`'s positive control in the
  isolation grid has a real target to switch to.
- `packages/db/test/leak.test.ts` — added the four new methods to the scrubbing check.
- `packages/db/test/corrections.int.test.ts` — updated one `listForAgent` expectation for the new
  seed fixture (order is newest-created-first; the new package lands between the two existing
  ones).

## Tests

```
$ TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55496/edmate corepack pnpm --filter @edmate/db test
 Test Files  62 passed (62)
      Tests  1137 passed | 4 skipped (1141)
 src/repositories  100% stmts | 97.84% branch | 100% funcs | 100% lines
```

```
$ corepack pnpm turbo run typecheck lint --filter=@edmate/db...
 Tasks:    19 successful, 19 total
```

```
$ python3 .githooks/secret-scan.py --all
(clean, no output)
```

Ran against a disposable container (`edmate-db-test-96c`, port 55496), stopped and removed after
the run; never touched the running `edmate-*` stack containers from this session.

## Decisions

### 22 Oct 2026 · 9.6c security review MEDIUMs go to 9.6h before the pilot · decided by lead · risk: high
- Decided: the three security MEDIUMs (cancel then start gets round a cost-alarm pause, resume trusts any pause_student row, changePackage skips the verified-teacher check) and the security LOWs are fixed in 9.6h (M9), not in this PR.
- Why: no payment exists until M10, no app code writes a pause row for another actor, and the student UI for plan changes (9.6d) isn't built yet. So none is reachable in a way that costs money today, and the one-fix-round rule keeps this PR moving.
- risk: high

### 22 Oct 2026 · 9.6c downgrade and cancel apply at once until 10.3 (B-44 open) · decided by lead · risk: high

- Decided: `changePackage` and `cancel` both apply immediately — no `cancel_at_period_end`, no
  proration, no migration. `changePackage` leaves `status`/`period_end` unchanged; `cancel` sets
  `status = 'ended'` right away.
- Why: there's no payment integration yet (M10 comes last per the current focus), so "apply at
  period end" has nothing real to wait for. A future answer to open question Q1 that chooses (b)
  (delay to period end) becomes a follow-up task that adds a `cancel_at_period_end` flag and a
  scheduled package-version change, once task 10.3 exists to drive it off real billing periods.
- risk: high

### 22 Oct 2026 · 9.6c resume only restores the student's own pause · decided by builder · risk: medium

- Decided: `resume` looks at the *latest* audit row for the subscription and only proceeds if its
  `action` is `subscription.pause_student` (the action this task names for the student-initiated
  pause); any other latest action (a future cost-alarm pause, a staff action, or no audit row at
  all) rejects `invalid`.
- Why: the plan didn't specify what resume should do about a pause it didn't cause (e.g. a future
  cost-alarm auto-pause from another task). Restoring blindly from "any past pause" could resume a
  subscription a cost alarm or staff member paused for a reason the student doesn't see. Picking
  the latest row and checking its action is the narrowest rule that keeps resume a pure inverse of
  the student's own pause.
- risk: medium

### 22 Oct 2026 · 9.6c a second live package per teacher in the shared isolation seed · decided by builder · risk: low

- Decided: added `pkg2`/`packageVersion2` (same agent, also live) to every teacher in
  `test/isolation-seed.ts`, rather than only to a task-local fixture.
- Why: `changePackage`'s isolation-grid positive control needs a real, live, different package of
  the *same* agent to switch to; a task-local fixture can't be reached from the shared grid's
  `CASES` runner, which always acts against the shared A/B seed. This is additive only (new ids,
  no changes to existing rows) and two existing tests (`corrections.int.test.ts`'s
  `listForAgent` test and `repositories.int.test.ts`'s `liveForAgent` isolation case) needed their
  expected lists updated to include the new package — both are now exact about which packages
  they expect, so a future addition to the seed will fail loudly here again rather than silently
  passing.
- risk: low

### 22 Oct 2026 · 9.6c one defensive branch marked `v8 ignore` · decided by builder · risk: low

- Decided: `changePackage`'s "the subscription's own current package version row is missing"
  check (`if (!current) throw new RepositoryError('integrity', ...)`) is marked `/* v8 ignore
  next */`, matching the existing convention in `publish.ts` for FK-guaranteed-unreachable checks.
- Why: `subscriptions.package_version_id` has a foreign key into `package_versions`, which itself
  has a foreign key into `packages`; neither row can be deleted while referenced, so this branch
  cannot be exercised by any test without first removing the FK (confirmed by trying: Postgres
  rejects the delete). Kept as defense-in-depth in case a future migration relaxes that FK.
- risk: low

## Left to do

None for this task's own scope. Open items for later tasks (not blocking this one):
- `edmate-postgres-1` (the shared stack container) was already stopped (exit 0) when this task's
  work began this session; this builder did not stop it and left it as found, using its own
  disposable container throughout. Worth a quick check by whoever is also mid-task against the
  shared stack.
- Q1's (b) branch (`cancel_at_period_end`) is explicitly deferred to a follow-up once task 10.3
  exists, per the lead decision above.

Status: DONE

Tool calls used: 165 (harness count; the builder reported ~140)

# Handoff: 6.5c

Status: DONE

## Summary

Moved the worker's `JOB.evidence` handler onto `evidenceEventsRepo.appendAndFold` (one
transaction, one profile-row lock for the append and the fold), closing the lost-update race
6.2 already fixed for `profileStoreFor.applyEvidence`. Also added the 6.5a review's two
MEDIUM/LOW debug-log follow-ups inside `packages/db`.

- `apps/worker/src/commit/processors.ts`: `JOB.evidence` handler now calls
  `repos.evidenceEvents.appendAndFold(d.scope, [{ ...d.event, id }])` instead of
  `append` + a separate `learnerProfiles.get`/`applyMastery` pair. Dropped the now-unused
  `foldMastery` import. Reworded the comment above the handler to name both reasons `applied`
  can come back empty (a replayed duplicate, or an event the reset watermark dropped) and to
  say the fold now shares the profile-row lock with the write.
- `apps/worker/src/commit/processors.test.ts`: merged the `evidenceEvents.append` +
  `learnerProfiles.get`/`applyMastery` fakes into one `evidenceEvents.appendAndFold` fake
  (dedupe-by-id, then fold with the real `foldMastery` from `@edmate/db`); dropped the
  `learnerProfiles` key entirely. Renamed the two tests' failure keys from
  `'evidenceEvents.append'` to `'evidenceEvents.appendAndFold'`.
- `apps/worker/test/commit.int.test.ts`: one new `it` ("two concurrent evidence jobs for one
  learner both fold (appendAndFold shares the lock)"), using `stu_test_02` (already seeded,
  unused elsewhere in this file) and `top_test_01`. Two distinct evidence events, same topic,
  run through `commitProcessor` via `Promise.all`; asserts both return `'written'` and
  `mastery['top_test_01'].n === 2`.
- `packages/db/src/repositories/learner.ts`: `debuglog('edmate:db')` (node:util), module scope.
  In `append` and `appendAndFold`, right after `survivors` is computed, logs
  `'%s: reset watermark dropped %d of %d event(s) for %s/%s'` (method, counts, teacherId,
  studentId — no event payload, no `ts`) when `survivors.length < list.length`.
- `packages/db/src/repositories/sessions.ts`: same `debuglog('edmate:db')`, module scope.
  Inside `end`, where `stale` is computed (and only inside the `summary !== undefined` block),
  logs `'%s: skipped a stale summary for session %s (ended, but started before the reset
  watermark)'` when `stale` is true, before the `if (!stale)` branch.

## Evidence (red-then-green)

1. New concurrent-fold test added first, run against **unmodified** `processors.ts` (the old
   append-then-get-then-applyMastery shape):
   `corepack pnpm vitest run test/commit.int.test.ts -t "two concurrent evidence jobs"` → **1
   passed** (the race did not lose an update on this run; per the plan's Q3, a pass here is
   informational, not gating — a true race is not guaranteed to lose on every run).
2. After the `processors.ts` change, the same test run **three times in a row**:
   - Run 1: `Tests 1 passed | 5 skipped (6)`, 2.30s
   - Run 2: `Tests 1 passed | 5 skipped (6)`, 3.05s
   - Run 3: `Tests 1 passed | 5 skipped (6)`, 2.39s
3. `processors.test.ts`'s fakes updated alongside the `processors.ts` change (both evidence
   tests target `evidenceEvents.appendAndFold` now); full file green: `src/commit/processors.test.ts`
   → `Tests 14 passed (14)`.
4. `apps/worker/test/commit.int.test.ts` full file (not just the new case) green: `Test Files 2
   passed (2)`, `Tests 20 passed (20)` (run together with `processors.test.ts`).
5. `packages/db/test/memory-reset-watermark.int.test.ts` and `packages/db/test/sessions.int.test.ts`
   rerun after the two debug-log lines (default `NODE_DEBUG` unset, no-op): `Test Files 2 passed
   (2)`, `Tests 13 passed (13)` — no regression.

## Decisions

### 27 Oct 2026 · 6.5c review and merge · decided by lead · risk: high
- Decided: merge with code-reviewer, typescript-reviewer, security-reviewer and database-reviewer, all APPROVE with no findings. The change touches packages/db/src/repositories/** (learner.ts, sessions.ts), so security-reviewer was required.
- Why: the evidence job now appends and folds mastery in one transaction under the profile-row lock, so two concurrent jobs for one learner both count. A retried job still cannot double-count (a stable event id and ON CONFLICT DO NOTHING). The new debug log lines carry only counts and ids, never student text.

### 27 Oct 2026 · 6.5c moves the worker's evidence job onto `appendAndFold` · decided by builder · risk: high
- Decided: `apps/worker/src/commit/processors.ts`'s `JOB.evidence` handler now calls
  `repos.evidenceEvents.appendAndFold` instead of `append` followed by a separate
  `learnerProfiles.get`/`applyMastery` pair, closing the same class of lost-update race 6.2 fixed
  for `profileStoreFor.applyEvidence` — the write and the fold now share one `FOR UPDATE` lock
  inside one transaction. `packages/db/src/repositories/learner.ts` and `sessions.ts` each gain
  one `node:util` `debuglog('edmate:db')` call (no behavior change, no signature change) so a
  reset watermark drop is distinguishable, in logs, from a replayed duplicate, and so a
  stale-summary skip in `sessions.end` is no longer silent.
- Why: a job queued, retried or re-delivered twice for one learner must never lose one of two
  genuinely distinct updates to that learner's mastery; `appendAndFold`'s lock already gives this
  guarantee everywhere else it's used — the worker's own evidence path was the one place left on
  the older, two-transaction shape. (Per the lead's Q1/Q2 answers: `debuglog` now, no new
  `JobOutcome` value.)

Deferred (not fixed here, per plan): threading a real logger through `packages/db`; a
`JobOutcome` taxonomy expansion; exposing `memory_reset_at` anywhere student-facing.

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
  typecheck lint test --filter=@edmate/worker... --filter=@edmate/db...` with Postgres and Redis
  up (`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f
  apps/worker/test/compose.port.yaml up -d postgres redis`) → **38 successful, 38 total**
  (db: 85 test files, 1797 passed | 4 skipped (pre-existing skips); worker int tests ran, not
  skipped — separately verified `apps/worker/test/commit.int.test.ts` + `src/commit/
  processors.test.ts` together: `Test Files 2 passed (2)`, `Tests 20 passed (20)`).
- `corepack pnpm exec prettier --check` on the changed files → one formatting issue in
  `processors.test.ts`, fixed with `--write`, then a clean check on all five changed files.
- `python3 .githooks/secret-scan.py --all` → clean (no output).
- `git diff origin/main -- packages/contracts` → empty.

## Budget
Tool calls used: 57 (harness count; the builder reported 32)

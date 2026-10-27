# Task 6.5a: Memory reset watermark — handoff

Status: DONE

## Summary

Adds `memory_reset_at` (nullable `timestamptz`, no default) to `learner_profiles`, stamped by
`learnerProfiles.reset`. Evidence/session jobs queued before a reset can no longer re-seed memory
once applied after it:

- `packages/db/src/schema/learning.ts`: `memoryResetAt` column on `learnerProfiles`.
- `packages/db/migrations/0037_memory_reset_watermark.sql` (+ `meta/0037_snapshot.json`,
  `meta/_journal.json`): generated with `drizzle-kit generate` after the schema edit — byte-for-byte
  the same single `ALTER TABLE` the plan specified.
- `packages/db/src/repositories/learner.ts`:
  - `reset`'s existing clearing `UPDATE` now also sets `memory_reset_at = now()`.
  - `evidenceEvents.append` now locks the profile row first (default-row insert, `ON CONFLICT DO
    NOTHING`, then `SELECT … FOR UPDATE`) — same order `appendAndFold` already used, closing the
    6.5 review's deferred MEDIUM. A new `dropBeforeReset` helper drops any event whose `ts` is
    strictly before the locked watermark (no-op when it is `NULL`) before the insert; `append` also
    now throws `scope` (`/* v8 ignore next */`-guarded, like every other locked method in this
    file) if the row vanishes after its own insert.
  - `appendAndFold` selects `memoryResetAt` alongside `mastery` in its existing locked read and
    applies the same `dropBeforeReset` filter before insert/fold.
- `packages/db/src/repositories/sessions.ts`: `end` widens its `UPDATE … RETURNING` to the ended
  session's `createdAt`; when this call is the one that ends the session and the pair has a
  non-null `memory_reset_at` and the session's `createdAt` is strictly before it, the
  `learner_profiles` upsert is skipped (no `lastSummary` write) — the session row still ends
  (`{ ended: true }`). Plain `SELECT`, no lock (sequential-correct only, same framing as 6.5's own
  Q2).
- `packages/db/test/memory-reset-watermark.int.test.ts` (new): own throwaway database, same
  template as `memory-reset.int.test.ts`. Covers the full acceptance sequence (reset, stale
  `append`, stale `appendAndFold`, stale `sessions.end`, a mixed before/after batch through both
  `append` and `appendAndFold`, and a never-reset control pair).
- `packages/db/test/repositories.int.test.ts`: **forced touch**, not optional (see Decisions
  below) — bumped the fixed `2026-10-17`/`2026-10-18` timestamps used by the
  `evidenceEvents.append`/`appendAndFold` grid cases' real writes to a far-future date (`2030-01-01`/
  `2030-01-02`), because this file's own `learnerProfiles.reset` grid case runs earlier in the same
  test file and (correctly) stamps every pair's `memory_reset_at` to that test run's real "now" —
  the old fixed-past timestamps were then (correctly) dropped by the new watermark filter, which is
  exactly the behavior 6.5a adds, but it broke this file's unrelated ownership/isolation assertions.
  No other change to this file.

## Red then green

1. Wrote `memory-reset-watermark.int.test.ts` first; it failed to even resolve
  (`@edmate/contracts`/`@edmate/harness` not built) until `turbo run build` for dependencies, then
  failed for real reasons before the repository code changed (`append`/`appendAndFold` returned the
  stale events instead of `[]`, `sessions.end` wrote the stale summary) — confirmed red before any
  schema/repository edit.
2. After the schema + migration + repository edits: both tests in the new file pass.
3. Running the existing regression suites (`profile-store.int.test.ts`, `sessions.int.test.ts`,
  `memory-reset.int.test.ts`, `repositories.int.test.ts`) surfaced the `repositories.int.test.ts`
  timestamp conflict above — fixed, then all four pass alongside the new file (228 tests, 0
  failures, 0 skipped).

## Decisions

### 27 Oct 2026 · 6.5a memory-reset watermark closes the stale-job race deferred from 6.5 · decided by builder · risk: high
- Decided: add `memory_reset_at` (nullable timestamptz) to `learner_profiles`, stamped by
  `learnerProfiles.reset`. `evidenceEvents.append` now locks the profile row first (matching
  `appendAndFold`, closing the 6.5 review's MEDIUM); both `append` and `appendAndFold` silently drop
  any event dated strictly before the watermark, before it is ever inserted or folded.
  `sessions.end` never writes `last_summary` for a session that started strictly before the
  watermark, though it still ends the session row. Lead-decided Q1–Q4 (see plan): still close the
  session row (Q1); strict `<` (Q2); leave the worker's evidence handler alone, deferred to board
  task 6.5c (Q3); `append` throws `scope` on a vanished row, same shape as its sibling locked
  methods (Q4).
- Why: a job queued before a reset (an evidence event, or a session's end-of-session summary) that
  lands after the reset must not resurrect memory the student explicitly cleared. Filtering by the
  event's/session's own timestamp works regardless of how late the stale job arrives, and needs no
  app-layer coordination.
- risk: high (new locking and filtering behavior in `packages/db/src/repositories/**`, a risky
  path; security-reviewer required).

### 27 Oct 2026 · 6.5a the worker's evidence-job handler is not moved onto appendAndFold here · decided by builder · risk: low
- Decided: `apps/worker/src/commit/processors.ts`'s `JOB.evidence` handler keeps its existing
  append-then-get-then-applyMastery shape; only the stale-after-reset case this task's acceptance
  covers is closed (a filtered-to-empty `append` makes it skip the fold entirely). The handler's
  own non-atomic two-transaction fold (present since task 3.17, the same class of race 6.2 fixed
  elsewhere) is left as a deferred finding — the lead's plan answer already names board task 6.5c
  for it.
- Why: `apps/worker/**` is out of this task's files; fixing it is a bigger, separable change.
- risk: low (documented gap, not a new regression).

### 27 Oct 2026 · 6.5a repositories.int.test.ts needed a forced, minimal fix · decided by builder · risk: low
- Decided: bumped two hardcoded timestamp bases (`2026-10-17`/`2026-10-18`, in the
  `evidenceEvents.append`/`appendAndFold` grid cases' `attempt` functions only) to a far-future
  date (`2030-01-01`/`2030-01-02`). No other line in `repositories.int.test.ts` changed.
- Why: that file's own `learnerProfiles.reset` grid case runs earlier in the same test file (same
  throwaway database) and legitimately stamps every seeded pair's `memory_reset_at` to real "now"
  during the test run; the two append-family cases' subsequent real writes then used fixed
  **past** 2026-10-17/18 dates, which the new watermark filter correctly dropped — a genuine
  conflict the plan's "memory_reset_at is NULL for every seeded row in that fixture" assumption did
  not anticipate (the CASES object's own insertion order puts `reset` before both `append` cases).
  Confirmed via an isolated single-test run (`vitest run … -t "evidenceEvents.append: student
  scope"`, passed alone) versus the full-file run (failed) before concluding this was ordering, not
  a logic bug in the new filter.
- risk: low (test-only timestamp change, no behavior change; the two timestamps were already
  arbitrary placeholders used only for per-attempt uniqueness, not for any watermark assertion).

Deferred (not fixed here, per plan): the worker's non-atomic evidence fold (board task 6.5c, per
lead); a locked/hardened (vs. plain-read) watermark check inside `sessions.end` for true
concurrent hardening; exposing `memory_reset_at` on the student-facing memory page (no ask for it).

## README text for the lead

13.regate owns `packages/db/src/repositories/README.md` right now, so this was not applied there.
Paragraph to add to the existing "Memory reset and export (task 6.5)" section:

> Task 6.5a adds a `memory_reset_at` watermark, stamped by `reset`. `evidenceEvents.append` now
> locks the profile row first (matching `appendAndFold`, closing the 6.5 review's deferred MEDIUM),
> and both `append` and `appendAndFold` silently drop any event dated strictly before the
> watermark, before it is ever inserted or folded — a job queued before a reset cannot re-seed
> memory once it lands after it. `sessions.end` checks the same watermark against the ended
> session's own `created_at`: a session that started before the watermark still ends, but its
> summary is never written onto the profile.

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
  typecheck lint test --filter=@edmate/db...` → **26/26 tasks successful** (dependents included);
  `@edmate/db:test` → **85 test files, 1786 tests passed, 4 skipped (unrelated, pre-existing
  skips), 0 failed**. db integration tests ran for real (not skipped): Postgres was up at
  `127.0.0.1:55432` throughout, confirmed by the per-suite `✓` lines for every `*.int.test.ts` file
  including the new `memory-reset-watermark.int.test.ts` (2 tests, both passed).
- Re-ran `TEST_DATABASE_URL=... corepack pnpm turbo run typecheck lint test --filter=@edmate/db`
  (package itself, after the prettier fix) → **8/8 tasks successful**, same test counts.
- `corepack pnpm exec prettier --check` on every changed/created file → one file needed
  `--write` (`packages/db/src/repositories/learner.ts`); re-checked clean afterward.
- `python3 .githooks/secret-scan.py --all` → clean, no output.
- `git diff origin/main -- packages/contracts` → empty (no contracts change).
- Coverage (from the gate's v8 report): `src/repositories/learner.ts` 100% stmts/funcs/lines,
  97.91% branch (one `/* v8 ignore next */`-guarded unreachable throw, same pattern as every
  sibling locked method); `src/repositories/sessions.ts` 100% across the board; package-wide
  99.67% stmts / 97.9% branch / 99.65% funcs / 99.72% lines — comfortably over the 80% floor and
  100% is not required outside `packages/harness/src/access/`.

## Budget

Tool calls used: 36

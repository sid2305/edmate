# 13.4c handoff — retention job hardening

Status: DONE

Branch: work-134c (pushes to m13/13.4c-retention-hardening)
Worktree: .claude/worktrees/agent-a2ddbb4bd693427ca

## What changed, per finding (docs/tasks/13.4/review.md lines 15–19)

1. **Limit drift (MEDIUM, workers.ts).** `PurgeMethod` now takes `(cutoff, dryRun, limit)`.
   `purgeTable` passes `purgeLimit` into every call (dry run and live), so the loop's limit and
   the database's limit can never drift. Test: `workers.test.ts` — "passes purgeLimit into every
   live call" asserts the fake purge recorded `limit === purgeLimit` on each call.
2. **Lost count on a later failure (MEDIUM, workers.ts).** Added `RetentionPurgeError` (`table`,
   `deletedSoFar`, `calls`, `cause`). `purgeTable` throws it when a live call after the first
   fails, carrying the rows the earlier calls already deleted. `schedule.ts`'s `retentionJob`
   catches it per table, logs `retention.purge_failed` with those fields (plus `describeError`
   of the cause) before rethrowing so the job still fails. Tests: `workers.test.ts` — "a later
   call that throws loses nothing"; `schedule.test.ts` — "logs retention.purge_failed with the
   rows already deleted before the job fails".
3. **Zero or negative days (LOW, config.ts).** `cutoffFor` now throws when `days` is not a
   positive finite integer. Updated the old "zero days is now" test (it asserted the opposite of
   the finding) to assert 0/-1/NaN/1.5 throw and 1/730 don't, in `config.test.ts`.
4. **Live-run warning (LOW, schedule.ts).** `retentionJob` now logs one `retention.live_run`
   warning at the start of a live run, naming each table and its cutoff (ISO string); a dry run
   logs none. Tests: "a dry run logs no live-run warning" / "a live run logs exactly one
   live-run warning naming the tables and their cutoffs".
5. **Schedule failure (LOW, index.ts).** No code change — `apps/worker/src/index.ts` already
   logs `retention.schedule_failed` and sets `process.exitCode = 1` on a failed
   `scheduleRetention`, exactly matching how `scheduleWeeklyInsights`'s failure is handled a few
   lines above. See Decisions below.

## Gate

- `corepack pnpm turbo run build typecheck lint test --filter=@edmate/worker`: 12/12 tasks green
  (417 tests passed, incl. the new/updated retention tests; `src/retention/workers.ts` at 100%
  coverage).
- `python3 .githooks/secret-scan.py --all`: clean (no output).

## Decisions

### 25 Oct 2026 · 13.4c schedule failure keeps current behaviour · decided by builder · risk: low
- Decided: left `scheduleRetention(...).catch` in `apps/worker/src/index.ts` as log + set
  `process.exitCode = 1`, with no new shutdown path.
- Why: the plan said to keep current behaviour and record the choice if nothing else in
  index.ts stops the process on a schedule failure — nothing does; `scheduleWeeklyInsights`'s
  own `.catch` right above it does exactly the same thing, so this already matches that pattern.

### 25 Oct 2026 · 13.4c purgeLimit passed to dry-run calls too · decided by builder · risk: low
- Decided: `purgeTable` passes `purgeLimit` to the dry-run call as well as every live call, even
  though finding 1 only named live calls.
- Why: `PurgeMethod`'s new signature requires a third `limit` argument for every call; passing
  the same `purgeLimit` to the dry-run call keeps one call shape instead of a special case, and
  `@edmate/db`'s dry-run methods ignore `limit` (dry-run counts are already unbounded per
  `workers.ts`'s file comment), so behaviour is unchanged.

## Left to do

None.

## Budget

Tool calls used: 26

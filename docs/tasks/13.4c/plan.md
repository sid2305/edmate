# 13.4c plan — retention job hardening (13.4 Phase B review follow-ups)

Status: READY (lead-written, 25 Oct 2026)
Budget: 30 tool calls.

## Goal
Fix the five findings deferred from docs/tasks/13.4/review.md (lines 15–19) before the retention job ever leaves dry run. All changes are in apps/worker/src/retention/** and apps/worker/src/index.ts. No change to packages/db.

## Changes (tests first for each)
1. **Limit drift (MEDIUM, workers.ts).** `PurgeMethod` becomes `(cutoff: Date, dryRun: boolean, limit: number) => Promise<RetentionResult>`, and `purgeTable` passes `purgeLimit` into every live call. Then the loop's limit and the database's limit are always the same number. `@edmate/db`'s retention methods already take an optional third `limit` argument, so `openDatabase().retention` still satisfies `RetentionBackend`. Test: a fake purge records the `limit` it got, and that limit equals `purgeLimit`.
2. **Lost count on a later failure (MEDIUM, workers.ts).** When a live call after the first one throws, the rows earlier calls already deleted must not vanish from the record. Rethrow an error that carries the partial result (e.g. a `RetentionPurgeError` with `table`, `deletedSoFar` and `calls`, and the original as `cause`), and have the caller in schedule.ts log `retention.purge_failed` with those fields before the job fails. Test: the purge succeeds twice with a full batch, then throws; the error or log carries deletedSoFar = 2 × limit.
3. **Zero or negative days (LOW, config.ts).** `cutoffFor` throws a clear error when `days` is not a positive finite integer. Test: 0, -1, NaN and 1.5 throw; 1 and 730 work.
4. **Live-run warning (LOW, schedule.ts).** When a run is not a dry run, log one `retention.live_run` warning at the start of the run, naming the tables and their cutoffs. Test: a dry run logs no warning; a live run logs exactly one.
5. **Schedule failure (LOW, index.ts).** `scheduleRetention(...).catch` already logs and sets `process.exitCode = 1`, but the worker keeps running without its retention schedule. Match how the file treats other start-up failures. If nothing else in index.ts stops the process on a schedule failure, keep the current behaviour and record that choice in `## Decisions`, saying it matches the weekly-insights schedule. Don't invent a new shutdown path.

## Gate
`corepack pnpm turbo run build typecheck lint test --filter=@edmate/worker` green; `python3 .githooks/secret-scan.py --all` clean.

## Risk paths
None (apps/worker/src/retention/** is not in risk-paths.txt).

## Reviewers
code-reviewer, typescript-reviewer, silent-failure-hunter (it raised finding 2).

## Open questions
None.

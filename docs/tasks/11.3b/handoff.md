# 11.3b handoff: weekly insights worker job (11.3 Phase B)

Status: DONE
Branch: m11/11.3b-insights-job (built on local `work-113b`)
Worktree: .claude/worktrees/agent-ae16578783058f883

## Summary
New `apps/worker/src/insights/` module, wired into the worker's entrypoint alongside the cost
alarm:
- `weeklyInsights.ts`: `finishedWeekStart(now)` — the Monday (`YYYY-MM-DD`, UTC) of the week that
  finished at the most recent UTC midnight Monday on or before `now`; a run on Monday (any time
  of day) or a mid-week hand re-run both report the same already-finished previous week, never
  the current or a future week. `weeklyInsightsForTeacher(backend, teacherId, weekStart)` calls
  only `backend.computeAndSaveWeek({ teacherId }, weekStart)` — no reads, no payload building, no
  `saveWeek` (there is no public `saveWeek` to call).
- `schedule.ts`: `scheduleWeeklyInsights` (one `upsertJobScheduler`, cron `0 7 * * 1`, `tz` passed
  in by the caller, never hardcoded), `insightsContentDir`/`insightsTimezone` (reads the US
  pack's `timezone` via `@edmate/content`'s `loadLocalePacks`, mirroring `gate/workers.ts`'s
  `gateContentDir` pattern; throws if there is no US pack), `weeklyInsightsJob` (loops
  `usageLedger.teacherIdsWithUsageSince({ since: now - 7d })`, per-teacher try/catch),
  `createWeeklyInsightsWorker`.
- `logSink.ts`: `logWeeklyInsightsTeacherFailed` (teacher id, week, error name/message only — no
  teacher text, no student data) and `logWeeklyInsightsRun` (counts only), same discipline as
  `alarms/logSink.ts`.
- `index.ts`: barrel, same shape as `alarms/index.ts`.
- `apps/worker/src/index.ts`: additive wiring — a `weeklyInsightsQueue`, `weeklyInsights` worker
  (reusing `db.repos.usageLedger.teacherIdsWithUsageSince` and `db.repos.insights`), scheduled at
  start-up with the US pack's own timezone (fails closed with a logged
  `weekly_insights.schedule_failed` and a non-zero exit code if the pack can't be read, same
  severity as a failed cost-alarm schedule), added to the worker list and to graceful shutdown.

## Files
- `apps/worker/src/insights/weeklyInsights.ts` (new)
- `apps/worker/src/insights/weeklyInsights.test.ts` (new, 8 tests)
- `apps/worker/src/insights/schedule.ts` (new)
- `apps/worker/src/insights/schedule.test.ts` (new, 10 tests)
- `apps/worker/src/insights/logSink.ts` (new)
- `apps/worker/src/insights/logSink.test.ts` (new, 4 tests)
- `apps/worker/src/insights/index.ts` (new, barrel)
- `apps/worker/src/index.ts`: additive edit (new import block, queue, worker, scheduling call,
  worker-list entry, shutdown close). No conflicting lines with 8.2e's web-link ingest wiring.

All tests are unit tests with fakes only (an in-memory `insights`/`teacherIds` port, a
`FakeRedis` for the worker-construction tests, a tmp-dir locale-pack fixture copied from the
real `content/locales/global.yaml` for the missing-US-pack case) — no real db, no Redis, no
model calls.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` → all 38 tasks
  successful; `@edmate/worker:test` 302 passed, 22 skipped (integration tests needing a real
  Postgres/Redis, same as every other worker module); `src/insights` coverage 96%/86.6%/85.7%/
  97.9% (stmts/branch/funcs/lines) in isolation.
- `python3 .githooks/secret-scan.py --all` → clean.

## Decisions

### 22 Oct 2026 · 11.3b weekStart is the Monday of the most recently finished week, computed from `now` alone · decided by builder · risk: low
- Decided: `finishedWeekStart(now)` finds the most recent UTC-midnight Monday on or before `now`
  (the in-progress week's start) and subtracts 7 days. A Monday 07:00 run, a run at exactly
  Monday 00:00:00.000 UTC and a mid-week hand re-run (e.g. Wednesday) all return the same answer:
  the week before the one `now` sits in. This can never be the current or a future week; 11.3c's
  repository-level refusal is a second line, not the only one. Tested with fixed clocks for all
  three cases plus a Sunday (end of the in-progress week) run.
- Why: the brief's exact wording ("a run on Monday 07:00 reports the week that ended at that
  Monday 00:00 UTC. Never the current or a future week.") and the need for a pure, clock-only
  computation the scheduler's actual run time can't perturb.
- risk: low

### 22 Oct 2026 · 11.3b The worker calls only computeAndSaveWeek; no reads, no local payload building · decided by builder · risk: low
- Decided: `weeklyInsightsForTeacher` is a one-line pass-through to
  `repos.insights.computeAndSaveWeek(scope, weekStart)`. The worker has no knowledge of the
  payload shape, the privacy floor or any of the four underlying reads.
- Why: lead note; `insightsRepo` (11.3a) already keeps `saveWeek` internal and not on the repo
  object specifically so no caller — including this worker — can store a forged payload.
- risk: low

### 22 Oct 2026 · 11.3b The schedule's timezone comes from the US locale pack at start-up, read once per process start · decided by builder · risk: low
- Decided: `insightsTimezone(contentDir)` loads locale packs via `@edmate/content`'s
  `loadLocalePacks` and reads the `US` pack's `timezone` field; it throws if the pack is missing
  or unusable, and `apps/worker/src/index.ts` treats that failure the same as a failed
  `scheduleCostAlarm` call (logged, non-zero exit code) rather than falling back to a hardcoded
  zone. `insightsContentDir` mirrors `gate/workers.ts`'s `gateContentDir` (`EDMATE_CONTENT_DIR`,
  else the repo's `content/`).
- Why: lead note ("not hardcoded"); failing closed on a missing pack matches the project's
  general "a guard/config that can't run must fail closed" lesson rather than silently defaulting
  to UTC or `America/New_York` in code.
- risk: low

### 22 Oct 2026 · 11.3b Per-teacher failures are logged with the error name/message only, via a small logSink module · decided by builder · risk: low
- Decided: `logWeeklyInsightsTeacherFailed`/`logWeeklyInsightsRun` live in their own
  `logSink.ts` (mirroring the alarms module's file shape) rather than being inlined in the job
  function, so each has its own unit test. Neither function accepts or forwards any field beyond
  teacher id, week, counts and `describeError`'s `{name, message}`.
- Why: lead note ("per-teacher try/catch with logs of the error name only ... like
  costAlarmJob") plus rule 5 (no student data, no teacher text in logs).
- risk: low

## Left to do
None for this phase. 11.3c (repository-level refusal of a current/future week) is a separate task.

Tool calls used: 44

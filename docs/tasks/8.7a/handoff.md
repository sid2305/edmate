# 8.7a handoff: publish repository and gate-run migration (8.7 Phase A)

Status: DONE

- Branch: `m8/8.7a-publish-repo` (built locally as `work-87a`)
- Worktree: `.claude/worktrees/agent-a721e1d524344802c`
- Plan: `docs/tasks/8.7/plan.md` (Phase A)
- Tool calls used: 62

## Summary

`packages/db` now stores publish-gate runs. Migration `0021_publish_gate_runs` adds nullable
columns to `eval_runs` (additive only: no drop, rewrite or delete) and a new `publish` repository
on `createRepositories(db)` starts a run, moves it along, records case results, finishes it, and
puts the agent live in one transaction. Teacher-scoped reads serve the studio; one public read
(`publicScorecard`) serves the teacher page. Out-of-bounds files (agents.ts, teacher-profiles.ts,
discovery.ts, ports.ts, packages/contracts, packages/evals, apps) were not touched.

## Exported names and signatures (for Phases C and D)

All from `@edmate/db` (re-exported through `src/repositories/index.ts`). Access is
`repos.publish.<method>`; every method is wrapped by `guardAll`, so driver errors are scrubbed
`RepositoryError`s.

Constants:
- `GATE_SUITE = 'gate'`
- `GATE_RUN_STATUSES = ['queued','running','passed','failed','error']`, type `GateRunStatus`
- `PUBLISH_CHANGE_KINDS = ['first_publish','prompt_pack_bump','material','packages','style_card']`, type `PublishChangeKind`
- `GATE_GROUP_NAMES` (mirror of the evals threshold keys), type `GateGroupName`
- `GATE_DEADLINE_MS` (15 min), `FULL_SCOPE_GATE_DEADLINE_MS` (2 h), `STALE_RUN_GRACE_MS` (15 min)
- `GATE_RESULTS_MAX = 1000`, `FAILED_CASES_MAX = 500`

Types: `PublishRefusal = 'no_packages' | 'suspended' | 'nothing_to_publish' | 'gate_running'`,
`PublishPins`, `PublishBasis`, `GateCaseDetails`, `GateCaseResult`, `GateRunSummary`,
`StoredScorecard`, `StoredScorecardCategory`, `FinishRunInput`, `GoLiveInput`, `GateRunRow`,
`FailedCase`, `PublicScorecardCategory`, `PublicScorecard`.

```ts
class PublishRefusedError extends RepositoryError {
  constructor(kind: 'invalid' | 'integrity', method: string, readonly reason: PublishRefusal);
}
interface PublishPins {
  agentId: string; courseId: string; styleCardId: string;
  promptPackVersion: string; modelPolicy: ModelPolicy; judgeModel: string; // stored as eval_runs.model
}
type PublishBasis = {
  agentVersion: number; courseId: string; styleCardId: string; promptPackVersion: string;
  modelPolicy: ModelPolicy; materialRevision: number; packageVersions: Record<string, number>;
};
interface GateCaseResult { caseId: string; passed: boolean; details: GateCaseDetails }
// GateCaseDetails: { origin, group, suite, failedChecks: string[], errorCode?, question? (agent origin only) }
// GateRunSummary: { groups: GroupSummary[], stats?, costMicroUsd?, errorCode? }
// StoredScorecard: strict mirror of @edmate/evals Scorecard { pass, changes, categories }
interface GateRunRow {
  id: string; agentId: string; agentVersion: number; status: GateRunStatus;
  changes: PublishChangeKind[]; judgeModel: string; basis: PublishBasis;
  passRate: number | null; summary: GateRunSummary | null; scorecard: StoredScorecard | null;
  createdAt: string; finishedAt: string | null; publishedAt: string | null; // ISO strings
}
interface FailedCase { caseId: string; details: GateCaseDetails }
type PublicScorecardCategory = StoredScorecardCategory & { measuredAt: string | null };
interface PublicScorecard { publishedAt: string; categories: PublicScorecardCategory[] }

publish.startRun(scope: TeacherScope, pins: PublishPins): Promise<GateRunRow>
publish.markRunning(scope: TeacherScope, runId: string): Promise<boolean>   // false if not queued
publish.getRun(scope: TeacherScope, runId: string): Promise<GateRunRow | null>
publish.recordResults(scope: TeacherScope, input: { runId: string; results: GateCaseResult[] }): Promise<{ written: number }>
publish.finishRun(scope: TeacherScope, input: { runId; status: 'failed' | 'error'; passRate?; summary; scorecard? }): Promise<void>
publish.goLive(scope: TeacherScope, input: { runId; passRate; summary; scorecard }): Promise<{ agentVersion: number; packageVersions: Record<string, number> }>
publish.latestRun(scope: TeacherScope): Promise<GateRunRow | null>
publish.failedCases(scope: TeacherScope, runId: string): Promise<FailedCase[]>
publish.publicScorecard(input: { agentId: string }): Promise<PublicScorecard | null>
```

Error kinds callers should map: `scope` (teacher not verified, or a foreign id), `not_found`
(agent, course, card or run not the scope's), `invalid` (bad input; run not in the right status;
`PublishRefusedError` with `no_packages`, `suspended`, `nothing_to_publish`), `integrity`
(`PublishRefusedError` `gate_running`; a stored row that fails its schema).

## Files

- `packages/db/migrations/0021_publish_gate_runs.sql`, `meta/0021_snapshot.json`, `meta/_journal.json`
- `packages/db/src/schema/operations.ts`: `eval_runs` gains `agent_id` (FK agents), `status`,
  `changes`, `basis`, `summary`, `scorecard`, `published_at`; index
  `eval_runs_agent_id_created_at_idx`; partial unique `eval_runs_agent_id_open_key` (one queued or
  running run per agent); check `eval_runs_status_check`.
- `packages/db/src/repositories/publish.ts` (new), `index.ts` (wiring and exports), `README.md`
  (Publish gate runs section).

## Tests

- `packages/db/test/publish.int.test.ts` (new, 29 tests): refusals, stale runs (full and partial
  scope), version N+1 and basis snapshot, regulated subject carried, change kinds, markRunning,
  recordResults idempotency and limits, finishRun, goLive (audits, unverified, suspended mid-run,
  cross-teacher), scoped reads, the 500 cap, integrity on corrupted rows, offline eval rows ignored,
  publicScorecard null cases and carry-forward.
- `packages/db/test/repositories.int.test.ts`: isolation cases for all 9 publish methods.
- `packages/db/test/leak.test.ts`: scrub checks for all 9 publish methods.

## Acceptance evidence

```
TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55487/edmate \
  corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
→ publish.ts | 100 | 98.66 | 100 | 100
→ Tasks: 26 successful, 26 total
vitest run test/repositories.int.test.ts → Tests 120 passed (120)
vitest run test/publish.int.test.ts      → Tests 29 passed (29)
python3 .githooks/secret-scan.py --all   → clean
```

## Deviations

- None from the plan's Phase A scope. Formatting: prettier was applied to the lines this task
  added only; pre-existing lines in shared test files were left as they were to avoid merge churn.

## Decisions

### 22 Oct 2026 · 8.7a publish repository: verified-teacher check and go-live in one transaction · decided by builder · risk: high
- Decided: `goLive` runs in one transaction: teacher profile `verified` read `FOR SHARE`, the run row `FOR UPDATE` (id + teacher_id + suite gate; must be `running`), the agent `FOR UPDATE` (refused if suspended), then agent live + live_version, each basis package's live_version, one `agent.publish` and one `package.publish` audit row each, and the run marked `passed` with `published_at`. `startRun` takes a per-teacher advisory lock (namespace 8701) and the same `FOR SHARE` verified check. The teacher id comes only from the scope.
- Why: a teacher whose verification is revoked, or an agent suspended, while the gate runs must never go live; one transaction means no half-published state.
- risk: high

### 22 Oct 2026 · 8.7a refusals carry a reason through PublishRefusedError · decided by builder · risk: low
- Decided: a `RepositoryError` subclass `PublishRefusedError` adds `reason` (`no_packages`, `suspended`, `nothing_to_publish`, `gate_running`); the kind stays `invalid` or `integrity`.
- Why: the studio must show why a publish was refused; no contracts change needed.
- risk: low

### 22 Oct 2026 · 8.7a db mirrors the evals types locally · decided by builder · risk: low
- Decided: strict zod mirrors of the scorecard, summary, case details, group names and deadlines live in `publish.ts`; db does not import `@edmate/evals`.
- Why: db must not depend on evals; Phase C should check the mirrors match when it wires them.
- risk: low

### 22 Oct 2026 · 8.7a a stale run is measured from updated_at · decided by builder · risk: medium
- Decided: an open run is stale after its deadline (2 h for first_publish or prompt_pack_bump, else 15 min) plus 15 min grace since its last `updated_at`; `startRun` then closes it as `error` with `errorCode: 'stale'` and starts a new one.
- Why: a crashed worker must not block publishing forever, while a slow but live run keeps its slot.
- risk: medium

### 22 Oct 2026 · 8.7a change kinds from the last published basis · decided by builder · risk: medium
- Decided: change kinds compare the new basis with the last passed run's basis (canonical JSON); a course change counts as `material`; nothing changed on a live agent is refused `nothing_to_publish`; nothing changed on an agent that is not live (for example unpublished) runs as `first_publish`.
- Why: gives the gate the narrowest correct scope while never blocking a teacher whose agent is offline.
- risk: medium

### 22 Oct 2026 · 8.7a migration 0021, judge model in the model column · decided by builder · risk: low
- Decided: migration number 0021 (next free), additive nullable columns; the judge model pin is stored in the existing `eval_runs.model` column.
- Why: no rewrite of existing eval rows; offline eval runs (no agent_id/status) are ignored by the publish reads.
- risk: low

### 22 Oct 2026 · 8.7a own test database container · decided by builder · risk: low
- Decided: ran the int suites against my own `pgvector/pgvector:0.8.1-pg16` container on 127.0.0.1:55487, removed after the build.
- Why: nothing listened on the shared port and other sessions' containers must not be touched.
- risk: low

### 22 Oct 2026 · 8.7a one lock order for publish writes · decided by builder · risk: low
- Decided: startRun and goLive both lock in this order: the per-teacher advisory lock (8701), the teacher profile FOR SHARE, the agent FOR UPDATE, then the run FOR UPDATE. goLive reads the run's agent id without a lock first (agent_id is never updated), then rechecks it under the run lock. markRunning, recordResults and finishRun lock the run row only.
- Why: goLive locked the run before the agent, the reverse of startRun. A Publish re-click during goLive deadlocked (40P01), and the passed gate could be lost (database-reviewer, CRITICAL).
- risk: low

## Left to do

- Phase B (worker gate agent, already merged as 8.7b) and Phases C and D wire these methods into
  the worker and the studio; Phase C should confirm the local mirrors match `@edmate/evals`.

## Fix round

Fixes the database-reviewer CRITICAL (lock-order deadlock between startRun and goLive) and the
typescript-reviewer MEDIUM (`run.agentId as string`).

- `packages/db/src/repositories/publish.ts`: a new `publishLock` helper holds the advisory lock
  that startRun used inline. goLive now takes it first, then the profile FOR SHARE, then reads the
  run's agent id without a lock, then the agent FOR UPDATE, then `lockRun`. This is the same
  order startRun uses. The agent id is checked at runtime with `stored(IdSchema, …)` (`integrity`
  if it is wrong) instead of a cast. markRunning, recordResults and finishRun lock only the run
  row, so they have no inverted pair.
- `packages/db/test/publish.int.test.ts`: new test "takes the same lock order as startRun". It
  runs 3 iterations. A raw connection holds the agent row; startRun is started and waits on it,
  then goLive is started and waits too (both are seen in `pg_stat_activity`); then the row is
  released. Before the fix this was a deterministic `40P01`. After the fix goLive goes live
  (agent v2) and startRun is refused cleanly with `gate_running`.

Evidence:

```
vitest run test/publish.int.test.ts -t "lock order" (before fix) → RepositoryError … 40P01
vitest run test/publish.int.test.ts --coverage                   → Tests 30 passed (30); publish.ts 100 | 98.7 | 100 | 100
TEST_DATABASE_URL=… turbo run typecheck lint test --filter=@edmate/db... --force → Tasks: 26 successful, 26 total
python3 .githooks/secret-scan.py --all                           → clean
```

Found, not fixed (outside this round's scope): the existing goLive test "publishes the agent
version … with audit rows" fails about 1 run in 40. The audit scrub replaces a run id's first
UUID segment with `[redacted]` when its 8 hex characters are all digits, so the audit row's
`after.runId` is changed in production too. This is not caused by this fix. It needs a board task
for `audit.ts`'s scrubber.

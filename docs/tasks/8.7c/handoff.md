# 8.7c handoff: gate queue and gatedPublish worker processor (8.7 Phase C)

Status: DONE

- Branch: `m8/8.7c-gate-queue` (built locally as `work-87c`, on top of the earlier builder's WIP commit 0e93476)
- Worktree: `.claude/worktrees/agent-a58be1bc11908677a`
- Plan: `docs/tasks/8.7/plan.md` (Phase C)
- Tool calls used: 52 (harness, resumed run; the cut-off first run is not counted)

## Summary

A publish-gate run can now be processed end to end. `@edmate/queue` has the `edmate-gate` queue: a strict `{runId, teacherId}` job, one job id per run, and `attempts: 1`. `apps/worker` starts a gate worker that handles one job at a time. For each job the processor:
1. re-reads the run;
2. marks it running;
3. builds the gate from the run's stored basis;
4. runs `runQualityGate` inside `gatedPublish` and stores one result row per case;
5. goes live (`publish.goLive`, called once, only on a pass) or finishes the run `failed`.

Every error after the job is parsed is logged by code, with ids only, and ends the run `error`. A missing run, or one that is no longer `queued`, is a logged no-op. A malformed job is permanent and is dead-lettered. If models, content or suites are missing, the run ends `error` / `gate_unavailable` with a reason, and the gate is never called.

Review of the earlier builder's WIP (0e93476): `gate.ts`, its test, `processor.ts`, `workers.ts` and most of `processor.test.ts` were right and are kept. This run changed the following:
- **Test import fix:** `ModelGateway` is now imported from `@edmate/contracts`. Typecheck was red.
- **Style-card test fixture:** it now has 40 cases (the sample needs at least 30).
- **`getRun` inside the try:** a failing `getRun` is now logged and ends the run `error`. Before, the job failed and the run stayed `queued` until the stale rule closed it.
- **Wiring:** `index.ts` now starts the worker, and `gate/index.ts` now exports the processor and worker.
- **Dockerfile:** copies the content and suites dirs.
- **New tests:** `workers.test.ts` and the Postgres + Redis int test.

## Files

- `packages/queue/src/gate.ts` (new), `packages/queue/src/index.ts` (exports), `packages/queue/test/gate.test.ts` (new).
- `apps/worker/src/gate/processor.ts`, `processor.test.ts`, `workers.ts`, `workers.test.ts` (new); `apps/worker/src/gate/index.ts` (exports).
- `apps/worker/src/index.ts`: starts the gate worker (concurrency 1; case concurrency from `GATE_CONCURRENCY`, 1 to 32, otherwise the default and a warning is logged).
- `apps/worker/test/gate/processor.int.test.ts` (new).
- `apps/worker/Dockerfile`: copies `content/{locales,prompt-packs,skills}` and `evals/suites/` and sets `EDMATE_CONTENT_DIR=/app/content` and `EDMATE_EVAL_SUITES_DIR=/app/evals/suites`.
- `apps/worker/package.json` + `pnpm-lock.yaml`: `@edmate/content` dependency (from the WIP).

## Tests

- `processor.test.ts` (29 tests, fake repos, scripted gates):
  - **Pass:** results are recorded, then `goLive` runs exactly once with the summary and scorecard.
  - **Fail:** the run is finished `failed` with the failed agent accuracy case stored, and there is no `goLive`.
  - **Errors end `error`:** a gate that throws ends `error`; models unavailable ends `error` / `gate_unavailable` and the gate is never called; a dev model, a refused `goLive` (suspended or not verified), a result mismatch, and a `markRunning` or `getRun` failure all end `error` too.
  - **Finish fails:** a `finishRun` that fails is logged and fails the job.
  - **Redelivery and bad jobs:** a job for a run that is not `queued`, or missing, is a no-op; a malformed job is permanent.
  - **Helpers and mirrors:** the helpers are covered, and the db mirrors match the evals group names, change kinds, deadlines and scorecard keys.
- `workers.test.ts` (8 tests):
  - `GATE_CONCURRENCY` parsing and the dir defaults.
  - `livePrepareGate` fails closed for: no models, a dev model, a judge pin mismatch, content missing (three ways), no packages, and a missing suites dir.
  - The full path builds a gate input from the repo's real content and suites, with no forbidden repository touched.
- `gate.test.ts` (9 tests): the strict schema, a stable job id, `attempts: 1`, enqueue, and the queue builder.
- `processor.int.test.ts` (3 tests, real Postgres + Redis + BullMQ, scripted gate, no model call):
  - **Pass path:** `startRun` → `enqueueGate` → worker. The agent is `live` at the run's version, both packages have `live_version` 1, every case row is stored, the run is `passed` with `finished_at` and `published_at` set, and `publicScorecard` returns categories.
  - **Fail path:** the run is `failed`, `failedCases` returns exactly the failing case, and the agent and packages are untouched. A re-enqueued job is a logged skip.
  - **Malformed job:** it is dead-lettered.

## Acceptance evidence

```
TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55491/edmate TEST_REDIS_URL=redis://127.0.0.1:56391 \
  corepack pnpm turbo run typecheck lint test --filter=@edmate/queue... --filter=@edmate/worker...
→ Tasks: 38 successful, 38 total
→ queue gate.ts 100 | 100 | 100 | 100; worker All files 96.85 | 93.8 | 94.47 | 96.79
→ worker gate/processor.ts 85.5 lines (unit only; 100 lines with the int suite); gate/workers.ts 90 lines
vitest run test/gate/processor.int.test.ts → Tests 3 passed (3)
python3 .githooks/secret-scan.py --all → clean
```

Shipped layout (`docker build -f apps/worker/Dockerfile -t e87c-worker:test .`, then a read-only node script run in the image calling the shipped `gateContentDir`/`gateSuitesDir` and the content loaders):
```
env /app/content /app/evals/suites
content locales,prompt-packs,skills
suites accuracy,advice,feedback,grounding,leak,locked,pedagogy,persona,revision,safety
locales IN,US,global
```

## Deviations

- **Int test location:** the int test is in `apps/worker/test/gate/processor.int.test.ts`, not `src/gate/`. That is where the worker's other int suites and the gate testkit live. It also runs through the real queue and worker (Redis), not only the processor.
- **Uncovered functions in `workers.ts`:** the locale/pack-market lambdas and the worker `error` handler are not called by tests. Calling them would need a live gate turn (a model call) or a broken Redis.

## Decisions

### 22 Oct 2026 · 8.7c a failed run lookup ends the run error · decided by builder · risk: low
- Decided: `getRun` runs inside the processor's error handling. If it throws, the failure is logged (`gate.error`, code `repository_<kind>`) and the run is finished `error`. If that also fails, `gate.finish_failed` is logged and the job fails (dead-lettered); the run then stays open until the stale rule closes it.
- Why: no silent failures; a run should not wait up to 2 h 15 min as stale when the database blipped once.
- risk: low

### 22 Oct 2026 · 8.7c error codes are fixed words · decided by builder · risk: low
- Decided: a run that ends `error` stores one of these codes:
  - `gate_unavailable`, with the reason in the log;
  - `result_mismatch` (gate results don't line up with the case scope, so nothing is stored);
  - a goLive refusal reason (`suspended`, ...);
  - `not_verified` (scope error);
  - `repository_<kind>`;
  - `gate_error`.

  The cost so far is kept when known. No message text or ids are stored in the code.
- Why: Phase D maps codes to plain messages; free text could carry personal data.
- risk: low

### 22 Oct 2026 · 8.7c a run pinned to another judge fails closed · decided by builder · risk: low
- Decided: if the run's stored judge model doesn't match this worker's `EDMATE_JUDGE_MODEL` (bare model or `provider:model`), the run ends `error` / `gate_unavailable` (`judge_model`).
- Why: a scorecard must be measured by the judge the run was started for.
- risk: low

### 22 Oct 2026 · 8.7c gate worker always starts; content loaded per run · decided by builder · risk: low
- Decided: the worker process always starts the gate worker. Models, content and suites are checked per run, so a deployment without keys still closes every run as `error` with a reason, and a fixed content dir is picked up without a restart. The image ships only `content/{locales,prompt-packs,skills}` (not demo-teacher or legal) plus `evals/suites/`.
- Why: a gate run that is never picked up would look "running" to the teacher until it went stale.
- risk: low

### 22 Oct 2026 · 8.7c own test containers · decided by builder · risk: low
- Decided: ran the int suites against my own `pgvector/pgvector:0.8.1-pg16` (127.0.0.1:55491) and `redis:7.4.6-alpine` (127.0.0.1:56391) containers, removed after the build.
- Why: the running edmate-* containers belong to other sessions.
- risk: low

### 22 Oct 2026 · 8.7c uncovered gate worker lambdas are accepted · decided by lead · risk: low
- Decided: the locale and pack-market lambdas and the error handler in apps/worker/src/gate/workers.ts stay without unit tests; the int test covers the real queue and worker.
- Why: covering them needs a live model turn or a broken Redis; the paths are thin wiring.
- risk: low

## Left to do

- **Phase D (studio publish API and page):** it calls `publish.startRun`, then `enqueueGate`. If the enqueue fails it must mark the run `error`.
- **Shutdown:** `worker.close()` waits for the active job, so a shutdown during a full-scope gate waits for it. Making the gate abort on SIGTERM is a follow-up (M13 with gate cancel).
- **`outOfCourse`** is still `[]` (8.7b note); content loading for it is a follow-up.

# Plan: 8.7 Publish flow with quality-gate results, the teaching scorecard and the public profile page

Status: READY (phases A to E; open questions below have recommendations, none blocks Phase A).

Board: `8.7` (M8). Deps: 1.3, 5.1, 5.2, 7.4, 7.8, 8.6 (8.6b merged; 8.6c in flight).
Spec: build plan § Evals and the quality gate (gate scope, scorecard, per-agent suites), § Web
surfaces ("Publish + gate results", "Teacher page (with scorecard)"); PRD T1, T7, S14, P3.
Lead decisions already made: publish goes only through `gatedPublish` (7.4 handoff); 8.7 stores the
scorecard per published agent version, no `generatedAt` in `Scorecard` (7.8 plan answers); a
publish makes a fresh agent version, no package delete (8.6 plan Q8); the teacher page shows "no
scorecard yet" until 8.7 stores one (9.2 plan Q1).
MVP rules: English only, US only, payments last (a published paid package still starts with no
payment until M10), one agent per teacher.

## Acceptance (verbatim) and how it will be shown

> failures show which cases failed; a pass publishes in < 1 minute.

| Clause | How it is shown |
| --- | --- |
| failures show which cases failed | Phase A int test: `publish.finishRun` stores one `eval_results` row per case with `{origin, group, suite, failedChecks, errorCode?}`; `publish.failedCases` returns only failed rows, teacher-scoped. Phase C processor test (scripted gateway, one failing accuracy case): run ends `failed`, nothing goes live, the failing case id is stored. Phase D `PublishView.test.tsx`: a failed run lists each failed case grouped by gate group (case id, group, why), and for the teacher's own accuracy cases the question text. |
| a pass publishes in < 1 minute | Structural: the publish step is `gatedPublish`'s `publish` callback, `publish.goLive`, one DB transaction that runs as soon as the gate returns `pass: true` (no second queue hop, no human step). Phase C processor test: on a passing scripted gate, `goLive` is called exactly once, after the gate, and the agent, its packages and the run are live/`passed` in the same transaction. Proof of time is a manual dev-stack walkthrough in the Phase D handoff (`eval_runs.finished_at` vs `published_at`, both stored), not a CI wall-clock assertion (lessons: wall-clock bounds fail on CI). |

## Scope decisions (spec gaps filled; each goes in the handoff `## Decisions`)

1. **Where the gate runs:** in `apps/worker`, on a new BullMQ `gate` queue. A full-scope gate is up
   to 2 h (`FULL_SCOPE_GATE_DEADLINE_MS`); it cannot live in a web request. Web enqueues; the worker
   runs `gatedPublish(() => runQualityGate(...), () => repos.publish.goLive(...))`.
2. **What is gated:** the whole teacher agent at once: a fresh agent version (newest style card,
   default course, newest signed prompt pack, `MODEL_MIX.paid`) plus the newest version of every
   package. One run publishes all of them or none (Q5).
3. **Change kinds** come from comparing the candidate's basis with the last *published* run's
   basis: no published run → `first_publish`; prompt-pack or model-policy change →
   `prompt_pack_bump` (Q6); material revision changed → `material`; any package version changed →
   `packages`; style card changed → `style_card`. Nothing changed and agent live → 409
   `nothing_to_publish`.
4. **Storage:** extend `eval_runs` additively (Q7) with `agent_id`, `status`
   (`queued|running|passed|failed|error`), `changes text[]`, `basis jsonb`, `summary jsonb`
   (groups, stats, cost in micro-USD, error code), `scorecard jsonb`, `published_at`. `suite` =
   `'gate'`, `model` = the judge model id. One open run per agent (partial unique index on
   `agent_id` where status in queued/running). `eval_results.details` = `{origin, group, suite,
   failedChecks: string[], errorCode?, question? (agent-origin only, from the teacher's own
   eval case)}`. No model replies are stored for platform cases.
5. **Who may publish:** a verified teacher only (`teacherProfiles.assertVerifiedForPublish` before
   enqueue → 403 `not_verified`), re-checked inside `goLive`'s transaction with the profile row
   locked `FOR SHARE` (closes the 8.1b race for the publish side; reject-suspends stays 8.1b).
   A `suspended` agent cannot start a run (409 `suspended`).
6. **The gate agent** is the real turn pipeline (`runTurn`, default steps) over read-only DB ports
   (retrieval, `entitlementStoreFor` with `source: 'eval'` pinned to the candidate package
   versions, a gate-only TurnConfigStore that loads the candidate agent version directly) and
   in-memory/no-op write ports: alerts never page on-call, no safety events, no teacher questions
   (nothing lands in the inbox), in-memory transcripts/session state/profile/traces, a memory usage
   meter whose total is stored in the run summary. Pattern: `apps/cli/src/commands/eval/liveAgent.ts`.
7. **Fails closed:** no model key, `EDMATE_DEV_MODEL=scripted`, missing suites dir or content dir,
   a thrown gate, a stale run → run ends `error` with a code, nothing publishes. B-40 (no
   feedback/revision thresholds) makes every full-scope gate fail today; the UI shows that group's
   reason as is (Q1). No skip flag.
8. **Scorecard:** `buildScorecard(gateResult)` stored on the run; the public scorecard for a live
   agent is the newest passed run's scorecard, with each category carried forward from the newest
   passed run that measured it (Q4), each with its run date.
9. **Job options:** `attempts: 1` (a 2 h job is never auto-retried; the teacher retries). A run
   `queued`/`running` past its deadline + 15 min is stale: the next start marks it `error`
   (`stale`) and proceeds.
10. **Not in 8.7 (M13 follow-ups, list in handoff):** automatic re-gating of a live agent when
    material changes after publish (material reaches students through retrieval until the teacher
    republishes; studio shows "changed since last publish") (Q10); per-package publish/unpublish;
    gate cancel; "sample conversation" on the teacher page (PRD T7) (Q8); gate cost in insights;
    `eval_results` retention; a shared turn-composition module for web and worker.

## Phase A: packages/db (migration + publish repository). Budget 100 tool calls

Tests first:
- `packages/db/test/publish.int.test.ts` (new), red first:
  - `startRun` with no packages → `RepositoryError('invalid')`; unverified teacher → `scope`;
    suspended agent → `invalid`; second start while one is open → `integrity` (unique index);
    stale open run is marked `error` and a new run starts.
  - `startRun` cuts agent version N+1 with the given pins and snapshots each package's newest
    version into `basis.packageVersions`; `changes` = `['first_publish']` the first time;
    later runs derive `material`, `packages`, `style_card`, `prompt_pack_bump`; identical basis on
    a live agent → `RepositoryError('invalid')` with reason `nothing_to_publish` (pick the existing
    error-carrying pattern; no new error codes in contracts).
  - `recordResults` writes one `eval_results` row per case, idempotent on (run, case);
    `finishRun(failed|error)` sets `finished_at`, status, summary; never touches agents/packages.
  - `goLive` in one transaction: profile verified check `FOR SHARE`, `agents.status = 'live'`,
    `agents.live_version` = candidate version, each package `live_version` = basis version, run
    `passed` + `published_at`, audit rows `agent.publish` and `package.publish`. Unverified at
    goLive time → `scope`, nothing changes. goLive on a non-`running` run → `invalid`.
  - `latestRun(scope)` and `failedCases(scope, runId)` (cap 500, newest first) are teacher-scoped:
    teacher B gets null/empty for A's run.
  - `publicScorecard({agentId})`: null for draft/suspended agent or unverified teacher; carry-forward
    per category (Q4); parsed by `ScorecardSchema`-equivalent zod in db (db must not import evals:
    store/parse as a local strict zod mirror; note it in the handoff).
- Add `publish.*` methods to the isolation `CASES` in `packages/db/test/repositories.int.test.ts`
  (tsc-enforced) and run `leak.test.ts`.

Files:
- New `packages/db/migrations/0020_publish_gate_runs.sql` (number: next free at build time; 9.2a
  may take 0020). Additive only: new nullable columns on `eval_runs`, a status check, the partial
  unique index, an index on `(agent_id, created_at)`. No drop, no rewrite.
- Modify `packages/db/src/schema/operations.ts` (eval_runs columns).
- New `packages/db/src/repositories/publish.ts`: `publishRepo(db)` with `startRun(scope, pins)`,
  `markRunning`, `getRun`, `recordResults`, `finishRun`, `goLive`, `latestRun`, `failedCases`,
  `publicScorecard`. `teacherScope`, `parseArg`, `translateWrite` throughout; teacher id from the
  scope only.
- Modify `packages/db/src/repositories/index.ts` (wire `publish` through `guardAll`),
  `packages/db/src/index.ts` (types), `packages/db/src/repositories/README.md` (one section).
- Do not edit `agents.ts`, `teacher-profiles.ts`, `discovery.ts` (9.2a) or `ports.ts`.

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` plus the db int suite.
Commit green. State after Phase A: runs can be started, recorded, finished and published in the DB;
nothing calls them yet.

## Phase B: apps/worker gate agent and gate input (no queue yet). Budget 100 tool calls

Can run in parallel with Phase A (only existing repositories are used; no shared files).

Tests first (scripted gateway, fixtures only; no real model calls):
- `apps/worker/src/gate/agent.test.ts`: the gate EvalAgent answers a per-agent case through the
  pipeline with the candidate's package pinned; a locked-module question comes back blocked; alerts,
  safety events and teacher questions ports record nothing durable (assert the fakes never reach
  repositories); usage totals are summed.
- `apps/worker/src/gate/input.test.ts`: `buildGateInput` maps a run's basis to `GateInput`
  (`platformCases` from the suites dir, `perAgent` via `agentPackagesFromConfigs` +
  `answerableFromTeacherEvalCases` over `teacherEvalCases.listForTeacher`, `agentFor` per package,
  deadline from `defaultGateDeadlineMs`); missing suites dir or zero platform cases → throws
  `gate_unavailable` (fail closed, lessons: silent skip); `listForTeacher` over its cap → error.
- `apps/worker/src/gate/configStore.test.ts`: the gate TurnConfigStore loads exactly the candidate
  agent version, package version and style card; another teacher's ids → null.

Files (all new unless noted):
- `apps/worker/src/gate/agent.ts` (pipeline composition, `collectReply`-style mapping),
  `configStore.ts`, `input.ts`, `models.ts` (judge + agent gateway from env; returns
  `unavailable` for no key or `EDMATE_DEV_MODEL=scripted`), `index.ts`.
- Modify `apps/worker/package.json` (+ `@edmate/evals`, `@edmate/content`).

Gate: `--filter=@edmate/worker...`. Commit green. State after Phase B: the worker can build a gate
input and agent for a run's basis; nothing enqueues or processes gate jobs.

## Phase C: gate queue + worker processor + wiring. Budget 90 tool calls

Needs A and B merged.

Tests first:
- `packages/queue/src/gate.test.ts`: strict `GateJobSchema` `{runId, teacherId}` (extra keys
  rejected), `jobId.gate(runId)` stable, `attempts: 1`.
- `apps/worker/src/gate/processor.test.ts` (scripted gateway and fake repos): pass →
  `recordResults` then `goLive` exactly once (inside `gatedPublish`), run `passed`, scorecard
  stored; fail → `finishRun('failed')`, no `goLive`, failed ids stored; gate throws →
  `finishRun('error')`, no `goLive`; models unavailable → `error` / `gate_unavailable` without
  calling the gate; a run not `queued` → job is a no-op (redelivery safe).
- `apps/worker/src/gate/processor.int.test.ts` (db int suite, scripted gateway): one end-to-end
  run against Postgres: start → process → agent live, packages live, results and scorecard stored.

Files:
- New `packages/queue/src/gate.ts` (`GATE_QUEUE`, `GateJobSchema`, `createGateQueue`,
  `enqueueGate`, job options); modify `packages/queue/src/index.ts` (exports). Do not edit
  `queues.ts` beyond an export if the queue-name list there must include it.
- New `apps/worker/src/gate/processor.ts`, `workers.ts`; modify `apps/worker/src/index.ts` (start
  the gate worker, concurrency 1 job, case concurrency from `GATE_CONCURRENCY`).
- Modify `apps/worker/Dockerfile` (copy `content/` and `evals/suites/`, set `EDMATE_CONTENT_DIR`
  and `EDMATE_EVAL_SUITES_DIR`); a build-layout check in the handoff (lessons: test the shipped
  layout).
- Do not edit `apps/worker/src/alerts/**` (risky path; the gate uses its own no-op sink).

Gate: `--filter=@edmate/queue... --filter=@edmate/worker...` plus int suite. Commit green.
State after Phase C: a gate job published from a script runs and publishes on pass.

## Phase D: studio publish API and page (apps/web). Budget 110 tool calls

Needs C merged and 8.6c merged (imports its pin helpers read-only).

Tests first:
- `apps/web/src/studio/publish.test.ts`: `POST /api/studio/publish` → 202 `{runId}`; teacher id
  from the session only (body is `{}` strict; any key → 400); unverified → 403 `not_verified`;
  no packages → 409 `no_packages`; open run → 409 `gate_running`; nothing changed → 409
  `nothing_to_publish`; body over cap → 413; repo/queue unavailable → 503; `cache-control:
  no-store`. `GET` → latest run `{status, changes, groups, failedCases[], scorecard, startedAt,
  finishedAt, publishedAt}` or `{run: null}`; another teacher's run never appears.
- `apps/web/src/studio/publishRuntime.test.ts`: pins = newest signed prompt pack
  (`readPromptPackLibrary` + `newestSignedSet`), `MODEL_MIX.paid`, newest style card, default
  course; enqueue after `startRun` commits; enqueue failure marks the run `error`.
- `apps/web/app/teacher/publish/PublishView.test.tsx` (RTL + jest-axe): idle, running (polls),
  passed (published time, scorecard), failed (failed cases grouped, B-40-style group reason shown
  as is), error (plain message per code, e.g. "the quality gate needs a model key"); body read
  in try/catch, actions try/catch/finally with a busy flag (lessons: studio page stuck).

Files:
- New `apps/web/src/studio/publish.ts` (handlers), `publishRuntime.ts`, `publishClient.ts`.
- New `apps/web/app/api/studio/publish/route.ts` (`withRole(['teacher'], ...)`, GET/POST).
- New `apps/web/app/teacher/publish/page.tsx`, `PublishView.tsx`.
- Modify `apps/web/app/teacher/view.tsx` (nav link), `apps/web/messages/en.json` (new top-level
  `publish` key only).

Gate: `--filter=@edmate/web...` (full suite, snapshots included). Commit green. Handoff includes the
manual timed walkthrough (dev stack with a model key, a teacher whose gate passes): `finished_at`
→ `published_at` under 1 minute; with B-40 open, the walkthrough uses a scripted-gate worker build
and says so.
State after Phase D: a teacher can publish from the studio and see gate results.

## Phase E: scorecard on the public teacher page. Budget 40 tool calls

Needs D and 9.2c merged (9.2c creates `apps/web/src/discovery/scorecard.ts` `toPublicScorecard`,
`ScorecardPanel.tsx` and the page passing `scorecard={null}`).

- Test first: the teacher page loader passes `repos.publish.publicScorecard({agentId})` through
  `toPublicScorecard`; null → "no scorecard yet"; a draft agent's scorecard never renders.
- Modify only the 9.2c page loader (`apps/web/app/teachers/[slug]/page.tsx` or its loader file) and
  its test. Gate `--filter=@edmate/web...`. State after Phase E: 8.7 complete.

## Files out of bounds

`packages/contracts/**`, `docs/adr/**`, `packages/harness/**`, `packages/evals/**` (call only;
thresholds are 7.4b's), `evals/suites/**`, `content/**`, `apps/web/src/auth/**`,
`apps/web/src/studio/packages*.ts` and `apps/web/app/api/studio/packages/**` (8.6c),
`apps/web/src/studio/testChat/**` and the 8.5b routes, `packages/db/src/repositories/discovery.ts`
(9.2a), `packages/db/src/repositories/{agents,teacher-profiles,ports}.ts`,
`apps/worker/src/alerts/**`, `packages/payments/**`, `packages/db/src/seed.ts`, `.claude/**`,
`.github/**`. A needed change in any of these → stop at PARTIAL and report.

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- Phase A: `packages/db/src/repositories/publish.ts`, `index.ts`, `README.md` match
  `packages/db/src/repositories/**` → reviewers: **security-reviewer** (plus code-reviewer;
  database-reviewer recommended for the migration, not required: additive, no drop/delete).
  Phase A handoff logs a `risk: high` decision ("publish repository: verified-teacher check and
  go-live in one transaction").
- Phases B, C, D, E: none (checked against risk-paths.txt; `apps/worker/src/alerts/**`,
  `apps/web/src/auth/**`, `packages/contracts/**` deliberately untouched).

## Questions for the lead

1. **B-40 / 7.4b blocks every real first publish.** Feedback/revision groups have no threshold and
   no platform accuracy cases, so any full-scope gate fails closed. Recommend: prioritise the B-40
   decision now; 8.7 builds and proves the flow with scripted gates and does not wait.
2. **Live gate cost and time.** A full-scope gate is ~1,000+ cases with judge calls (est. 45 to 80
   min at concurrency 4, real model spend per publish). Recommend: run as specified, show a
   "running" state, store cost in the run summary.
3. **Try-it without a model key** cannot publish (fail closed). Recommend: no skip flag in the app;
   if 9.0 needs a live demo agent, the seed marks it live directly (seed-only follow-up, not this
   task).
4. **Scorecard after a partial-scope republish:** carry each category forward from the newest
   passed run that measured it (recommended), or show only the latest run (unmeasured = "n/a")?
5. **Publish all packages together** (recommended), not per package; per-package publish is M13.
6. **Model-policy change** counts as `prompt_pack_bump` (full scope)? Recommended yes.
7. **Storage:** extend `eval_runs` additively (recommended) rather than a new table.
8. **"Sample conversation"** on the teacher page (PRD T7) deferred to M13? Recommended yes.
9. **8.1b overlap:** 8.7 does the in-transaction verified check for publish; reject-suspends stays
   in 8.1b. Recommended.
10. **Material changes after publish** reach students without a gate until the teacher
    republishes. Recommend: accept for MVP, studio shows "changed since last publish"; automatic
    re-gating is an M13 follow-up.

## Budget

Budget: 440 tool calls (5 phases: A 100, B 100, C 90, D 110, E 40; packages/db, apps/worker, packages/queue, apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test via corepack, db int tests
against the local Postgres, git on the task branch, `python3 .githooks/secret-scan.py --all`).
No network calls to model providers; no `gh pr merge`.

## Exit conditions

- `Status: DONE` for a phase: its tests written first and green, the filtered turbo run
  (typecheck, lint, test, snapshots) green for every package the phase touches, secret scan clean,
  one green commit, handoff with `Tool calls used:`, `## Decisions` (and the Phase A `risk: high`
  entry) and the "state after this phase" note. Task DONE after Phase E.
- `Status: PARTIAL`: past the phase budget; a file out of bounds needs changes; a contracts or
  evals change looks necessary; a dependency (8.6c, 9.2c, previous phase) is not merged; or a
  question above is answered differently in a way that changes the phase. Stop, commit what is
  green, and report.

## Lead answers (22 Oct 2026)
- Q1: 8.7 doesn't wait for B-40; it builds and proves the flow with scripted gates. B-40 stays open with the human.
- Q2: run the gate as specified, show a "running" state and store the cost in the run summary. The live spend per publish is flagged to the human (blocker B-43, non-blocking).
- Q3: no skip flag. If 9.0 needs a live demo agent, the seed marks it live directly (seed-only follow-up).
- Q4: carry each category forward from the newest passed run that measured it.
- Q5–Q9: as recommended (publish all packages together; a model-policy change is full scope; extend `eval_runs`; defer the sample conversation to M13; 8.1b keeps reject-suspends).
- Q10: accepted for MVP with a "changed since last publish" note in the studio; automatic re-gating is board task 13.regate. Flagged to the human in B-43.
- Build order: Phase B (apps/worker) can start first. Phase A (packages/db) starts after 9.2a merges (shared migrations journal, db index) and merges origin/main before pushing. C after A and B; D after 8.6c merges; E after 9.2c.

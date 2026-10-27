# Plan: 13.regate — re-run the quality gate automatically when a published agent's material changes

Status: READY (2 phases; no open decision blocks Phase A).

Board: `13.regate` (M13). Deps: 8.7e (done). Risk: medium.
Spec: `docs/tasks/8.7/plan.md` decision 10 and lead answer Q10 ("automatic re-gating of a live
agent when material changes after publish ... is board task 13.regate"); decision log
"22 Oct 2026 · First-publish gate runs in full; material edits after publish are ungated for the
MVP (B-43, task 8.7)": *"After publish, material edits reach students with a 'changed since last
publish' note until the teacher republishes; automatic re-gating is task 13.regate."*
MVP rules: English only, US only, payments not built; this task makes no model calls itself (the
gate it re-queues already fails closed per 8.7 decision 7, independent of B-40).

## Acceptance (verbatim) and how it will be shown

Board `accept:` field, verbatim:
> per docs/tasks/8.7/plan.md; typecheck, lint and test green for the packages it touches.

| Clause | How it is shown |
| --- | --- |
| per docs/tasks/8.7/plan.md | A new scheduled worker job finds every live agent whose material revision has changed since its last *passed, published* gate run and has no open run, computes the same pins a teacher's manual publish uses (newest signed prompt pack, `MODEL_MIX.paid`, newest style card, default course, the release judge), and calls the existing `publish.startRun` + `enqueueGate` — the identical contract 8.7 Phase D uses, so `startRun` derives `changes: ['material']` itself and `goLive`/fail-closed behaviour is unchanged. Phase A int test: a live agent with a bumped material revision and no open run appears in the candidate list; one with an open run, one that is not live, and one whose material hasn't changed do not. Phase B test (scripted/fake deps, no real model or queue calls): one candidate → `startRun` then `enqueueGate` called once with the run id and teacher id; a refused candidate (suspended, regulated-unapproved, nothing-to-publish) is logged and skipped, the next candidate still runs; an enqueue failure ends that run `error` (mirrors `apps/web/src/studio/publish.ts`'s own enqueue-failure handling) and the sweep continues; missing pins (no prompt-pack dir, unsigned set, no judge key, `EDMATE_DEV_MODEL=scripted`) fail the whole sweep closed before any candidate is touched, logged once (lessons.md: a check that silently skips looks like a pass). |
| typecheck, lint and test green for the packages it touches | `--filter=@edmate/db...` after Phase A, `--filter=@edmate/worker...` after Phase B; both green in the handoff. |

## Design

A new BullMQ job scheduler (`edmate-regate-sweep`, modelled byte-for-byte on
`apps/worker/src/alarms/schedule.ts`'s cost alarm) runs every 15 minutes. Each run:

1. Reads a new system-read `publish.liveAgentsWithMaterialChange()` (no scope — same kind of
   unscoped, cross-teacher aggregate read as `usageLedger.teacherIdsWithUsageSince` (task 3.8)
   and `usageLedger.costByPackageSince` / `subscriptions.activeCountByPackage` (task 13.5, merged
   at `risk: high` with the same reviewer set this plan asks for): the ids of live agents whose
   `teacher_material_revisions.revision` differs from the newest *passed, published* gate run's
   `basis.materialRevision`, excluding any agent with a `queued`/`running` run, oldest-changed
   first, capped at `REGATE_SWEEP_MAX` (200) per sweep. No student, package or figure in the
   result — ids only, same shape as the precedents above.
2. Computes the same pins a manual publish uses, reusing pieces already in `apps/worker` (it
   already reads the prompt-pack library and resolves the judge for every gate run):
   `promptPackVersion` = `newestSignedSet(readPromptPackLibrary(...))`, `modelPolicy` =
   `MODEL_MIX.paid`, `judgeModel` = `judgeModelLabel` of `gateModelsFromEnv(env)`'s judge. Any
   piece missing fails the whole sweep closed (logged once) before any candidate is touched — no
   per-candidate silent skip.
3. For each candidate, sequentially (never `Promise.all`: two writers that lock the same rows in a
   different order deadlock, lessons.md, and `startRun` already takes an advisory lock + the
   agent row per teacher — looping sequentially across *different* teachers adds no new lock-order
   risk, same as the existing per-teacher cost-alarm loop): `styleCards.latest(scope)` and
   `courses.ensureDefault(scope)` for the ids, then `publish.startRun(scope, pins)` and
   `enqueueGate`. A `RepositoryError`/`PublishRefusedError` (suspended, regulated-unapproved,
   scope, nothing-to-publish, gate-running) is logged with its reason and the next candidate still
   runs (cost-alarm's own per-teacher failure pattern). An enqueue failure ends that one run
   `error` (same as the manual flow) and the sweep continues.
4. `startRun` itself derives `changes: ['material']` from the real revision diff inside its own
   transaction (already built in 8.7a) — this task never computes or stores a change kind itself.

No schema change: the comparison reuses `eval_runs.basis`, `teacher_material_revisions` and
`agents.status`, all already queried by the existing (per-teacher) `changedSinceLastPublish`. No
`apps/web` change: the studio's "changed since last publish" note already reads
`changedSinceLastPublish`, which naturally turns false again once the automatic run passes and
publishes (same row, same comparison) — so the UI needs nothing new. No Dockerfile change: the
sweep reuses the same `EDMATE_CONTENT_DIR`, `EDMATE_EVAL_SUITES_DIR`-adjacent prompt-pack path and
judge-model env vars the gate worker already reads, already copied into the image by 8.7 Phase C.

## Phase A: packages/db — the system read. Budget 45 tool calls

Tests first:
- `packages/db/test/publish.int.test.ts` (extend): `liveAgentsWithMaterialChange()` —
  - returns `[]` when no agent is live.
  - returns `{teacherId, agentId}` for a live agent whose current material revision differs from
    its newest passed/published run's `basis.materialRevision`.
  - excludes a live agent whose material has not changed since that run.
  - excludes a live agent with an open (`queued`/`running`) run, even if material changed.
  - excludes a draft/suspended agent.
  - another teacher's unrelated changed agent still appears (it is a system read, not scoped —
    assert this explicitly in the test name/comment so it is never mistaken for a leak).
  - caps at `REGATE_SWEEP_MAX` and orders oldest-changed-first (assert on a small cap in the test,
    not the real constant, so the test stays fast).

Files:
- Modify `packages/db/src/repositories/publish.ts`: add `REGATE_SWEEP_MAX = 200` and
  `async liveAgentsWithMaterialChange(): Promise<{ teacherId: string; agentId: string }[]>` next to
  `changedSinceLastPublish`, reusing its `last` CTE shape but joined across every live agent and
  narrowed to the material clause only (per Q10's scope: material, not style card/packages/outline
  — those stay teacher-initiated). One SQL round trip, no new indexes needed (existing
  `(agent_id, created_at)` and the partial unique "one open run" index already back it).
- Modify `packages/db/src/repositories/README.md`: one sentence next to the existing
  `teacherIdsWithUsageSince` / `costByPackageSince` paragraph: `publish.liveAgentsWithMaterialChange()`
  is the same kind of system read for the scheduled regate sweep (task 13.regate); only the
  worker's sweep job calls it, no route exposes it.
- Do not add a migration (no schema change) and do not touch `repositories/index.ts` (no new
  repository, one method on the existing `publish` repo) or `agents.ts` / `teacher-profiles.ts`
  (read-only joins against tables `publish.ts` already imports).

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` plus the db int suite.
Commit green. State after Phase A: the candidate list can be read; nothing calls it yet.

## Phase B: apps/worker — the scheduled sweep. Budget 70 tool calls

Needs Phase A merged.

Tests first (fake/scripted deps only; no real model, queue or DB calls):
- `apps/worker/src/regate/pins.test.ts`: happy path returns `{promptPackVersion, modelPolicy,
  judgeModel}`; missing prompt-pack dir, an unsigned set, no judge key and
  `EDMATE_DEV_MODEL=scripted` each return an `unavailable` result with a reason (never throw past
  the caller — the sweep job decides whether that fails the run).
- `apps/worker/src/regate/sweep.test.ts`: zero candidates → no-op summary, no repo/queue calls;
  one candidate → `styleCards.latest`, `courses.ensureDefault`, `publish.startRun`, then
  `enqueueGate` called once with `{runId, teacherId}`; a candidate whose `startRun` throws
  `PublishRefusedError` is logged and skipped, the next candidate still runs; an `enqueueGate`
  failure calls `finishRun('error', ...)` for that run and the sweep continues; pins `unavailable`
  → the whole sweep logs once and returns with zero started, no repo call for any candidate.
- `apps/worker/src/regate/schedule.test.ts`: `scheduleRegateSweep` calls `upsertJobScheduler` once
  with the scheduler id, the pattern, `tz: 'UTC'` and the job template/options (same shape as
  `apps/worker/src/alarms/schedule.test.ts`).

Files (new unless noted):
- `apps/worker/src/regate/pins.ts`: `regatePinsFromEnv(env, hooks?)` — reuses
  `readPromptPackLibrary` + `newestSignedSet` (`@edmate/content`) over `gateContentDir(env)` and
  `gateModelsFromEnv` + `judgeModelLabel` (`apps/worker/src/gate/models.ts`, `@edmate/evals`) for
  the judge; returns a tagged `{ok: true, pins} | {ok: false, reason}` (never throws).
- `apps/worker/src/regate/sweep.ts`: `RegateSweepDeps` (`candidates()`, `repos: Pick<Repositories,
  'styleCards' | 'courses' | 'publish'>`, `pins(): Promise<PinsResult>`, `enqueue(job):
  Promise<void>`, `log`), `regateSweepJob(deps): () => Promise<RegateSweepSummary>` (`{candidates,
  started, skipped, failed}`), looping sequentially per the design note above.
- `apps/worker/src/regate/schedule.ts`: `REGATE_QUEUE = 'edmate-regate-sweep'`,
  `REGATE_SCHEDULER_ID`, `REGATE_JOB`, `REGATE_PATTERN = '*/15 * * * *'`, `REGATE_JOB_OPTIONS`
  (mirrors `COST_ALARM_JOB_OPTIONS`), `scheduleRegateSweep(queue, pattern?)`,
  `createRegateSweepWorker(options)` — all modelled on `apps/worker/src/alarms/schedule.ts`.
- `apps/worker/src/regate/index.ts`: barrel export, mirrors `apps/worker/src/alarms/index.ts`.
- Modify `apps/worker/src/index.ts`: `const regateQueue = new Queue(REGATE_QUEUE, {connection})`;
  `const gateProducerQueue = createGateQueue(connection)` (the worker has not enqueued a gate job
  before — only processed one; `apps/web` keeps its own producer); wire `createRegateSweepWorker`
  into the `workers` array; `scheduleRegateSweep(regateQueue).catch(...)` next to
  `scheduleCostAlarm`; add `regateQueue.close()` and `gateProducerQueue.close()` to the shutdown
  `Promise.all`.
- Do not edit `apps/worker/src/alerts/**`, `apps/worker/src/gate/{agent,configStore,input,
  processor}.ts` (only `models.ts`'s exports are read, not modified) or `apps/worker/Dockerfile`
  (no new paths or env vars).

Gate: `--filter=@edmate/worker...`. Commit green.
State after Phase B: task 13.regate done — a live agent's material change is re-gated within one
sweep interval, with the same fail-closed and audit behaviour as a manual publish.

## Files out of bounds

`packages/contracts/**`, `docs/adr/**`, `packages/harness/**`, `packages/evals/**` (call only),
`evals/suites/**`, `content/**`, `apps/web/**` (no UI or route change is needed — see Design),
`packages/db/migrations/**` (no schema change), `packages/db/src/repositories/{agents,
teacher-profiles,ports,index}.ts`, `apps/worker/src/alerts/**`, `apps/worker/Dockerfile`,
`packages/payments/**`, `packages/db/src/seed.ts`, `.claude/**`, `.github/**`. A needed change in
any of these → stop at PARTIAL and report.

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- Phase A: `packages/db/src/repositories/publish.ts` and `README.md` match
  `packages/db/src/repositories/**` → reviewers: **security-reviewer** (required by risk-paths.txt)
  plus **code-reviewer**; **database-reviewer** and **typescript-reviewer** are recommended, not
  required — the same reviewer set task 13.5 used for the same kind of unscoped cross-teacher
  system read. Phase A handoff logs a `risk: high` decision ("new unscoped cross-teacher read:
  publish.liveAgentsWithMaterialChange, following the teacherIdsWithUsageSince / 13.5 precedent").
- Phase B: none (`apps/worker/src/regate/**` and `apps/worker/src/index.ts` are not listed;
  `apps/worker/src/alerts/**` and `apps/worker/Dockerfile` deliberately untouched).

## Questions for the lead

1. **Sweep interval.** Recommend every 15 minutes (`*/15 * * * *`), matching the other scheduled
   workers' grain and cheap (one SQL read, no model call per sweep; a candidate that starts a real
   gate run still costs what a manual publish costs). A tighter or looser interval is a one-line
   change later.
2. **B-40 still blocks every real full-scope gate pass.** An automatic re-gate triggered by this
   task will currently end `failed` in a live environment, same as a manual one, until B-40 is
   resolved — this task does not wait on it (consistent with 8.7 Q1/B-43). Recommend: proceed; no
   behaviour change needed here when B-40 resolves.
3. **No feature flag to turn the sweep off.** The other scheduled workers (cost alarm, retention,
   weekly insights) have none either. Recommend: match that pattern; if a pilot teacher needs the
   sweep paused, that is an ops/runbook follow-up, not board scope.

## Budget

Budget: 115 tool calls (2 phases: A 45, B 70; packages/db, apps/worker)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test via corepack, db int tests
against the local Postgres, git on the task branch, `python3 .githooks/secret-scan.py --all`).
No network calls to model providers; no `gh pr merge`.

## Exit conditions

- `Status: DONE` for a phase: its tests written first and green, the filtered turbo run
  (typecheck, lint, test) green for every package the phase touches, secret scan clean, one green
  commit, handoff with `Tool calls used:`, `## Decisions` (and Phase A's `risk: high` entry) and
  the "state after this phase" note. Task DONE after Phase B.
- `Status: PARTIAL`: past the phase budget; a file out of bounds needs changes; a contracts or
  evals change looks necessary; Phase A is not merged before Phase B starts; or a question above
  is answered differently in a way that changes the phase. Stop, commit what is green, and report.

## Lead answers (26 Oct 2026)
- Q1: every 15 minutes, as recommended.
- Q2: proceed, but one change: **one automatic attempt per material revision.** A candidate must also have no gate run of any outcome (passed, failed or error) started since its material last changed, not just no open run. Otherwise, while B-40 makes every real gate run fail, the sweep would start a new failed run with real judge calls every 15 minutes for every changed agent. Phase A's candidate query and its int test cover this: an agent whose newest run since the material change ended `failed` is not a candidate; a further material change makes it a candidate again.
- Q3: no feature flag, as recommended.
- Shared file: another builder is editing `packages/db/src/repositories/README.md` (9.2g). Phase A does **not** touch it; put the README note in Phase B instead (merge `origin/main` first).

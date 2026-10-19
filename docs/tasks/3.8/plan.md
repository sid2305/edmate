# Task 3.8: `meter` and `commit` via the worker queue

Board: `board.py show 3.8` · M3 · deps 2.6, 3.1, M0 (all done; **3.6 not yet merged, see Open Q1**) · branch `m3/3.8-meter-commit` · planner: sonnet.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "`meter` and `commit` via the worker queue"
Accept: "reply latency unaffected when the DB is slow (injected delay)."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Reply latency unaffected | `runner.test.ts` (new case): with queue-backed `meter`/`commit`/`traces` ports whose underlying queue `add()` resolves fast but whose **worker-side processor** is wired to a DB fake with an injected multi-second delay, `runTurn(...).events` still reaches `done` and `finished` (the point where `meter`/`commit` report `ok`/`failed`) within a tight bound — because `Steps.meter`/`Steps.commit` only call `queue.add()`, never await the DB write. |
| `meter` step | `steps/meter.ts` (new): for every `Usage` in `x.usage`, calls `env.deps.usage.record(u, { teacherId, packageId, studentId, turnId: env.turnId, source })` from `x.entitlement`; a port failure fails the whole step (existing `backgroundStep` catch already reports it). |
| `commit` step | `steps/commit.ts` (new): appends the student message (when `record.input` is non-null) and the assistant message (when `record.replyText` is set) via `env.deps.transcripts.append`, each with a freshly minted id (`env.deps.ids.next('message')`) decided once per turn so a worker-side retry replays the same id; saves help state via `env.deps.sessionState.saveHelpState(record.sessionId, serializeSessionHelp(record.next))` only when `record.next` is present (3.6). |
| `answerKey` never leaks | `commit.test.ts`: a fixture `CommitRecord.next.help.answerKey` with marker strings never appears in any `Message.text`, `transcripts.append` call, or `TurnTrace` the step produces — only in the `sessionState.saveHelpState` call. `runner.test.ts` (existing 3.4 case, re-run) still passes: the marker never reaches a `TurnEvent`. |
| Queue-backed ports | `packages/queue` (new): `UsageMeter`, `TranscriptStore`, `SessionStateStore` and `TraceSink` adapters that `queue.add(name, payload, { jobId })` and resolve once BullMQ confirms the add; unit tests against a fake `Queue` (no real Redis) assert the exact job name/id/payload per call and that a failed `add()` rejects (so the pipeline's step reports `failed`, matching 2.4's and 2.5's deferred findings). |
| Worker consumer | `apps/worker/src/commit/*` (new): BullMQ `Worker`s that take each job and call the real `@edmate/db` adapters; `attempts` + exponential `backoff` per job, and a job that still fails after the last attempt is moved into a dead-letter queue (inspectable, alerted) instead of silently vanishing from Redis. |
| Idempotent retries | Integration test (compose Redis + compose Postgres): the same job (same `jobId`) processed twice (simulated by calling the processor function twice with the same job data) writes the message/usage/help-state exactly once each — no duplicate `usage_ledger` rows (checked via `listForTurn` before insert), no duplicate `messages` row (checked by re-reading history before treating a duplicate-id `not_found` as real), and `saveHelpState` (last-write-wins) is naturally idempotent. |
| `SessionStateStore` db adapter | `packages/db/test/*.int.test.ts` (new, real Postgres): `saveHelpState` writes only the scope's own **open** session (`ended_at IS NULL`); another student's, another teacher's or an ended session is `not_found`; a value whose `JSON.stringify` length exceeds `LIMITS.helpStateMaxJsonLength` is refused before any write (ADR-0005). |
| `TraceSink` db adapter + migration | `packages/db/migrations/0007_turn_trace_fields.sql` (additive: `turn_id`, `agent_version`, `package_version`, `intent`, `move`, `guards` jsonb, `usage` jsonb on `turn_traces`); `turnTracesRepo.insert` now takes the full `TurnTrace`; a new `traceSinkFor(repos, scope)` implements `TraceSink.record`. |
| `checkTeachersCost` scheduler | `apps/worker/src/alarms/schedule.ts` (new): a BullMQ repeatable job that calls `checkTeachersCost(teacherIds, ports)` and **logs every per-teacher failure** (`run.failures`) via the existing `logCostAlarmSink`-style structured log, not just collects it (2.5 review, deferred). A failed teacher this run is picked up again next scheduled run (no bespoke per-teacher retry queue). |
| Gates | `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/db... --filter=@edmate/queue... --filter=@edmate/worker...` green; root secret scan clean; no real Redis/Postgres calls in unit tests (rule 4) — only the named integration tests, run against the compose services. |

## Design

### What's already built (read only)
- `packages/harness/src/pipeline/runner.ts` (3.1): `finish()` already runs `meter` and `commit` as two independent, non-blocking background steps (`Promise.all`, each wrapped by `backgroundStep`, which times nothing, catches, and reports `ok`/`failed` on the trace) **after** `done()` is sent. Reply latency (time to the `done` event) is therefore *already* decoupled from these steps today — the accept criterion is really about `Steps.meter`/`Steps.commit` themselves never awaiting a slow DB call in-process, which the queue design below guarantees.
- `packages/harness/src/pipeline/steps/meter.ts` and `commit.ts` are still `StepNotImplementedError` stubs (fail closed) — this task fills them in.
- `packages/contracts/src/ports.ts`: `UsageMeter`, `TranscriptStore`, `TraceSink`, `SessionStateStore` (ADR-0005) are the frozen ports these steps and their adapters use. No contracts change is needed for this task.
- `packages/db/src/repositories/ports.ts` already has direct (non-queued) `usageMeterFor` and `transcriptStoreFor`; these become the **consumer-side** implementations the worker calls, unchanged.
- `apps/worker/src/worker.ts` (0.1) is the only existing BullMQ scaffold (a no-op queue); `apps/worker/src/alarms/*` (2.5) has `checkTeacherCost`/`checkTeachersCost` and a log-only `CostAlarmSink`, not yet scheduled.
- `packages/harness/src/pedagogy/helpState.ts` (3.4/3.6) already exports `serializeSessionHelp` (throws over `LIMITS.helpStateMaxJsonLength` or on an invalid shape) and `SessionHelp`/`StoredSessionHelp`, publicly from `@edmate/harness`.

### Where "via the worker queue" lives
Harness purity (rule 3) means `packages/harness` can only ever call `env.deps.*` **ports** — it must never import `bullmq`. So the two pipeline steps stay pure, ports-only functions; the queueing is entirely inside the **port adapters** the composition root injects into `PipelineDeps`, not inside the steps:

1. **`packages/harness/src/pipeline/steps/meter.ts`** (real, pure): loops `x.usage` and calls `env.deps.usage.record(u, ctx)` built from `x.entitlement` (`teacherId`, `packageId`, `studentId`, `source`) and `env.turnId`.
2. **`packages/harness/src/pipeline/steps/commit.ts`** (real, pure): builds and appends the student/assistant `Message`s via `env.deps.transcripts.append(record.sessionId, msg)`, and — only when `record.next` is present (3.6) — calls `env.deps.sessionState.saveHelpState(record.sessionId, serializeSessionHelp(record.next))`. `serializeSessionHelp`'s own throw (oversized/invalid) fails the step, same as any other port error; the db adapter re-checks the size independently (defence in depth, ADR-0005 wording).
3. **`packages/harness/src/pipeline/types.ts`**: `PipelineDeps` gains `sessionState: SessionStateStore` (currently missing — `transcripts`, `usage`, `traces` exist but not this one).
4. **`packages/harness/src/pipeline/types.ts` + `runner.ts`**: `CommitRecord` gains `sessionId: string`. Today nothing on `CommitRecord` reliably names the session when `input` is `null` (scrub failed, so the raw text — but not the session id, which is not PII — is dropped); `finish()` already has `this.input.sessionId` (the original, pre-scrub input) in scope for the `TurnTrace`'s own `sessionId` field, so it costs nothing to also put it on `record`. Without this, `commit` cannot append the assistant's escalation reply to the right session when the scrub failed.
5. **`packages/queue`** (new package, see Open Q1): the actual BullMQ-backed port adapters (`UsageMeter`, `TranscriptStore`, `SessionStateStore`, `TraceSink`) that `queue.add(jobName, payload, { jobId })` and resolve on a successful enqueue, never on the DB write. Two queues, `edmate-turn-meter` and `edmate-turn-commit`, each job id the turn id (`env.turnId`); the trace write and the help-state write ride in the same `edmate-turn-commit` queue, named `${turnId}:trace` / `${turnId}` respectively, so one worker owns "everything persisted after a turn" and the meter queue stays about billing only (matches 2.4's "3.8 moves metering onto the worker queue with retry" finding, which is specifically about usage).
6. **`apps/worker`**: new BullMQ `Worker`s (one per queue) whose processors call `@edmate/db`'s real adapters (existing `usageMeterFor`, `transcriptStoreFor`, plus the two new ones below), with `attempts`/`backoff` and a `'failed'` handler that, once attempts are exhausted, moves the job onto a small dead-letter queue and logs (structured, no student text) so it's visible without silently vanishing.

### New db adapters and the trace migration
- **`SessionStateStore` db adapter** (ADR-0005, owned by this task): a `sessionStateStoreFor(repos, scope)` in `packages/db/src/repositories/ports.ts`, bound to one student x teacher like `transcriptStoreFor`/`usageMeterFor`. Needs a new `sessions.saveHelpState` repository method (`packages/db/src/repositories/sessions.ts`): one `UPDATE sessions SET help_state = $1 WHERE id = $2 AND student_id = $3 AND teacher_id = $4 AND ended_at IS NULL`; 0 rows written → `RepositoryError('not_found')`. The adapter itself re-validates `JSON.stringify(helpState).length <= LIMITS.helpStateMaxJsonLength` before calling the repo (the port's input type is `unknown`, so this is the adapter's own job, independent of the harness-side `serializeSessionHelp` check).
- **`TraceSink` db adapter**: `packages/db/migrations/0007_turn_trace_fields.sql` adds `turn_id text not null`, `agent_version integer not null`, `package_version integer not null`, `intent text not null`, `move text not null`, `guards jsonb not null`, `usage jsonb not null` to `turn_traces` (additive, table currently has rows only from the stub path so there's nothing to backfill incorrectly — confirm empty before merge, same pattern as 2.4's migration). `turnTracesRepo.insert` takes the full `TurnTrace` (validated by `TurnTraceSchema` directly, replacing the narrower `TurnTraceInput`). A new `traceSinkFor(repos, scope): TraceSink` wraps it.
- **Usage-ledger idempotency (no schema change)**: before inserting, the meter job processor calls the existing `usageLedger.listForTurn(scope, turnId)`; if it already has rows, skip (already recorded) instead of inserting again. This replaces a unique-constraint approach so no migration is needed here.
- **Messages idempotency**: `messages.append`'s duplicate-id path returns `not_found` (same code as "wrong session", by design, so a duplicate id can't be used to probe another session). The commit processor must disambiguate: on `not_found`, re-read `transcripts.history` (or a light `messages` existence check) for that message id before deciding "already written, skip" vs. "really not_found, don't retry, dead-letter now".

### `checkTeachersCost` scheduler (deferred from 2.5)
`apps/worker/src/alarms/schedule.ts`: a BullMQ repeatable job (`queue.add('check-teachers-cost', {}, { repeat: { pattern: <daily, provisional> } })`) whose processor lists teacher ids (no such repository method exists yet — a small addition, e.g. `subscriptions`/`agents` gains a `listTeacherIds()`-style read, scoped to teachers with at least one subscription, flagged in Open Q3) and calls `checkTeachersCost(teacherIds, { usage: repos.usageLedger, subscriptions: repos.subscriptions, sink: logCostAlarmSink(), now: () => new Date() })`, then logs **every** entry of `run.failures` (teacherId + scrubbed error) — today `checkTeachersCost` only returns them, nothing logs them (2.5 review finding). A failing teacher is simply retried on the next scheduled run (no separate BullMQ retry needed here, per the costAlarm module's own comment that scheduling is the composition root's business).

### Out of scope (flagged, not built here)
- Opening a `TeacherQuestion` for `ask_teacher` and updating learner memory (`ProfileStore.applyEvidence`) — the build plan's row 11 lists both under `commit`, but neither port has a db adapter yet (no `profileStoreFor`, and `teacher_questions` has no `turn_id` column for idempotent retry), and the task's own instructions name only message + trace + usage + help state. Recommend a follow-up task once those adapters exist; noted as a decision, not silently dropped.
- `apps/worker/src/alerts/**` (safety-alert delivery, a risky path needing `safety-reviewer`) — untouched, per the given scope; the dead-letter/failure log added here is a plain structured log, not a `SafetyAlert`.

## Files

Create:
- `packages/harness/src/pipeline/steps/meter.ts`, `meter.test.ts` (overwrite the stub)
- `packages/harness/src/pipeline/steps/commit.ts`, `commit.test.ts` (overwrite the stub)
- `packages/queue/` (new workspace package): `package.json`, `src/index.ts`, `src/queues.ts` (names/job ids), `src/usageMeter.ts`, `src/transcriptStore.ts`, `src/sessionStateStore.ts`, `src/traceSink.ts`, matching `*.test.ts` (fake `Queue`, no real Redis)
- `packages/db/migrations/0007_turn_trace_fields.sql` + generated `meta/0007_snapshot.json`
- `packages/db/test/session-state.int.test.ts`, `packages/db/test/trace-sink.int.test.ts` (real Postgres)
- `apps/worker/src/commit/usageWorker.ts`, `commitWorker.ts`, `deadLetter.ts` + tests (fake BullMQ, per `worker.test.ts`'s pattern) and `apps/worker/test/commit.int.test.ts` (real Redis + Postgres, compose)
- `apps/worker/src/alarms/schedule.ts`, `schedule.test.ts`
- `apps/worker/test/compose.port.yaml` (publish Redis to `127.0.0.1`, mirroring `packages/db/test/compose.port.yaml`) — only if no such override exists for Redis already; confirm before adding.
- `docs/decisions/log.md` entries for every open question resolved below.

Modify:
- `packages/harness/src/pipeline/types.ts` (`PipelineDeps.sessionState`, `CommitRecord.sessionId`)
- `packages/harness/src/pipeline/runner.ts` (`finish()` sets `record.sessionId = this.input.sessionId`)
- `packages/harness/src/testing/memoryAccess.ts` / `memoryPorts.ts` (add an in-memory `SessionStateStore` fake and wire `sessionState` into any test `PipelineDeps` builder; keep `testSteps.ts` compiling)
- `packages/db/src/repositories/sessions.ts` (`saveHelpState` method), `ports.ts` (`sessionStateStoreFor`), `turn-traces.ts` (`insert` takes full `TurnTrace`), `ports.ts` (`traceSinkFor`), `index.ts` (export the new adapters/types)
- `packages/db/src/schema/learning.ts` (`turnTraces` table gains the new columns)
- `apps/worker/package.json` (add `@edmate/db`, `@edmate/contracts`, `@edmate/queue`, `@edmate/harness` as needed), `apps/worker/src/index.ts` (start the new workers + the scheduler alongside the existing no-op worker)
- `apps/worker/src/alarms/index.ts` (export `schedule.ts`'s pieces)

Out of bounds:
- `packages/contracts/**` — no port changes; everything above uses the existing frozen `UsageMeter`/`TranscriptStore`/`SessionStateStore`/`TraceSink`.
- `apps/worker/src/alerts/**` — untouched (see Design).
- `packages/harness/src/pipeline/steps/{decide,generate,postGuard}.ts`, `packages/harness/src/guardrails/**`, `content/**` — unrelated to this task.
- `TeacherQuestionStore`/`ProfileStore` db adapters — explicitly deferred (see Design).
- `apps/web/**`, `apps/cli/**` — no composition root exists yet to wire `PipelineDeps` end-to-end (3.7/3.9); this task only has to make the queue-backed ports and the two steps buildable and testable in isolation (`driveTurn`/`testSteps`-style harness tests), not wire a real HTTP or CLI route.

## Tests first (tdd-guide order)
1. `packages/queue`: fake-`Queue` unit tests for each adapter (job name/id/payload, enqueue failure propagates), then the adapters.
2. `packages/harness/src/pipeline/steps/meter.test.ts`, then `meter.ts`.
3. `packages/harness/src/pipeline/types.ts`/`runner.ts` changes (`sessionId`, `sessionState`) — a failing `runner.test.ts` case first, then the small edits; update `memoryAccess.ts`/`testSteps.ts` fakes to keep every other harness test compiling.
4. `packages/harness/src/pipeline/steps/commit.test.ts` (incl. the `answerKey`-never-leaks case and the null-input/escalation sessionId case), then `commit.ts`.
5. `packages/db`: `sessions.ts`/`ports.ts` (`SessionStateStore`) integration test, then the code; migration + `turn-traces.ts`/`ports.ts` (`TraceSink`) integration test, then the code and migration file.
6. `apps/worker`: fake-BullMQ unit tests for each processor (incl. the idempotent-retry and dead-letter cases), then the processors; `apps/worker/src/alarms/schedule.test.ts` (every-failure-logged case), then `schedule.ts`.
7. One `apps/worker` integration test against compose Redis + compose Postgres: a job added, picked up, written, and — for a forced-failing write — retried then dead-lettered.
8. Full gate run across `@edmate/harness`, `@edmate/db`, `@edmate/queue`, `@edmate/worker`.

## Risky paths touched
- `packages/db/src/repositories/**` → **security-reviewer** (new `sessionStateStoreFor`, `traceSinkFor`, `sessions.saveHelpState`; must prove the student/teacher/open-session scoping ADR-0005 requires, and that `answerKey` only ever reaches the `help_state` column, never `messages`/`turn_traces`).
- `apps/worker/src/alerts/**` → **not touched** (reserved for the safety-alert delivery task; confirmed above).
- `.claude/**` → **not touched**.
- No `packages/contracts/**` or `docs/adr/**` change, so no ADR/architect/typescript-reviewer gate from rule 2 — unless the team lead decides the new `packages/queue` workspace itself needs an architecture sign-off (see Open Q1); recommend treating that as a normal code/typescript review, not a contracts ADR, since no port shape changes.
- Overall reviewers recommended: `security-reviewer` (db scoping, required above), `database-reviewer` (migration 0007, idempotency scheme), `silent-failure-hunter` (dead-letter path, "every failure logged" for both the cost-alarm scheduler and the new workers), `typescript-reviewer` (harness purity unaffected, `Steps`/`PipelineDeps` typing).

## Open questions (recommendations)

- **Q1 Sequencing with 3.6.** The board lists 3.8's deps as 2.6, 3.1, M0 — not 3.6 — but `CommitRecord.next`/`.promptPack` (needed for the help-state write) only exist on branch `m3/3.6-prompt-composer` (PR #27), not on `main`. Recommend the team lead merge 3.6 before or alongside 3.8 so `commit.ts` can be built against the real `CommitRecord` shape once; if 3.6 must stay unmerged, 3.8 can still ship `commit.ts` written against today's narrower `CommitRecord` (no help-state write) and take a small, flagged follow-up once 3.6 lands. Not a human-blocking decision; a sequencing note for the lead.
- **Q2 A new `packages/queue` workspace.** Harness purity forbids `bullmq` inside `packages/harness`, and the producer-side adapters need to be shared by every future composition root (`apps/web`'s turn route, 3.7; `apps/cli`'s chat command, 3.9; the eval runner), none of which exist yet. Recommend a new leaf package `packages/queue` (depends on `bullmq`, `@edmate/contracts`, `@edmate/harness` for `serializeSessionHelp`) holding the four queue-backed port adapters and the shared queue-name/job-id constants `apps/worker` also imports, rather than duplicating constants in `apps/worker` and whichever app composes the pipeline first. Alternative: put the adapters directly in `apps/worker` and have future composition-root apps depend on it — rejected, apps depending on apps is unconventional in this layout. Risk: low, reversible (an internal package, no contracts/ADR implication); still worth the lead's explicit nod since it's a new workspace member.
- **Q3 Listing teachers for the cost-alarm scheduler.** No repository currently lists teacher ids; `checkTeachersCost` takes an explicit list. Recommend a minimal addition (e.g. `subscriptions` or `agents` gains a `listTeacherIds()`-style read limited to teachers with at least one subscription) rather than scanning all `agents` rows, matching the alarm's own "free subscriptions" scope. Low risk; exact SQL left to the builder.
- **Q4 Queue/job layout.** Recommend two BullMQ queues, `edmate-turn-meter` and `edmate-turn-commit`, both jobId'd by `turnId` (the commit queue's trace write uses `${turnId}:trace` to avoid colliding with the commit job's own `${turnId}`). This is a design choice, not a spec requirement; flagging so the builder doesn't have to re-derive it, and so the lead can redirect if a single combined queue is preferred.
- **Q5 Dead-letter implementation.** BullMQ has no built-in dead-letter queue; recommend a `'failed'` event listener that, once `job.attemptsMade >= job.opts.attempts`, adds the job's data to a small `edmate-dead-letter` queue and logs a structured, student-text-free line, rather than leaving failed jobs only in BullMQ's own failed set (easy to lose track of in production). Risk: low, purely operational.

## Lead answers (18 Oct 2026)

- Q1: 3.6 is merged (PR #27); branch from current main.
- Q2: new leaf workspace `packages/queue` (producer adapters); apps/worker consumes it.
- Q3: add a small scoped repository method listing teacher ids for the scheduled cost check; log every per-teacher failure (2.5 deferral).
- Q4: two queues (`edmate-turn-meter`, `edmate-turn-commit`), jobId = turnId, trace as `${turnId}:trace`.
- Q5: a `failed` handler moves exhausted jobs to `edmate-dead-letter`, logged loudly.
- Required: add `CommitRecord.sessionId` (set from the pre-scrub input). Never write systemPrompt, mustNotReveal, `next` or `entitled.helpState` (answer key) anywhere except `sessions.help_state` via saveHelpState with LIMITS.helpStateMaxJsonLength.
- Out of scope → task 3.17: TeacherQuestion for ask_teacher, ProfileStore.applyEvidence.
- Reviewers: security-reviewer, database-reviewer, silent-failure-hunter, typescript-reviewer; risk: high entry.

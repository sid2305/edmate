# 3.8 handoff: `meter` and `commit` via the worker queue

**Status:** DONE
**Branch:** `m3/3.8-meter-commit`
**Worktree:** `.claude/worktrees/agent-ace2f83e502e403fa`

## Acceptance evidence

| Item | Evidence |
|---|---|
| Gates (whole repo, as CI, after merging origin/main at `58140b3`; compose Postgres + Redis up) | `corepack pnpm turbo run build typecheck lint test` → `Tasks: 49 successful, 49 total` |
| harness | `Tests 2111 passed (2111)` · `All files 99.48 / 97.72 / 100 / 100`; `steps/meter.ts`, `steps/commit.ts`, `testing/memoryPorts.ts` 100 / 100 / 100 / 100; lint (purity rule) clean |
| db (real Postgres) | `Tests 398 passed (398)` · `All files 99.89 / 99.17 / 99.66 / 100`; `src/repositories/**` 100 % lines, every new file 100 / 100 / 100 / 100 |
| queue | `Tests 20 passed (20)` · `All files 100 / 100 / 100 / 100` (threshold 100) |
| worker (incl. the Redis + Postgres integration test) | `Tests 99 passed (99)` · `All files 99.14 / 99.24 / 96.92 / 99.54` |
| Agent harness tests | `python3 -m unittest discover .claude/tests` → `Ran 122 tests … OK` |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no findings |
| Reply latency unaffected (slow DB) | `packages/queue/test/latency.test.ts`: the real harness `meter` and `commit` steps on `queuedTurnPorts`; each enqueued job's DB write takes 5 s (real timers). `done` and `finished` arrive in < 500 ms, meter and commit are `ok` on the trace, all 5 jobs (1 meter, 4 commit) are enqueued and none has been written. |
| `meter` step | `steps/meter.test.ts`: one `usage.record` per usage, in order, ctx from the entitlement + `env.turnId`; none for no usage; a port failure fails the step. |
| `commit` step | `steps/commit.test.ts`: student message (scrubbed text, id from `ids.next('message')`, `receivedAt`), then the reply (`record.messageId`, `createdAt`), then `saveHelpState(sessionId, serializeSessionHelp(next))`; null input still appends the reply to `record.sessionId`; no text / no replyText / no next writes nothing; an oversized help state fails the step and is never saved. `runner.test.ts` (new block): the real steps meter and commit both messages, ids differ, student ≤ agent time; a failed scrub still sets `CommitRecord.sessionId`; a failing store is a `failed` commit, not a throw. |
| Answer key only in `sessions.help_state` (canary) | `commit.test.ts`: the canary in `next.help.answerKey`, `decision.systemPrompt` and `mustNotReveal` is in no `transcripts.append` call and no trace, only in `saveHelpState`. `db/test/session-state.int.test.ts`: the real `commit` on the db adapters, then every data-model table is searched as text: the canary is found only in `sessions`. `worker/commit/deadLetter.test.ts`: a dead-lettered help-state job keeps no canary, nor do log lines. The 3.4/3.6 runner canary tests still pass. |
| Queue-backed ports | `queue/test/adapters.test.ts` (fake `Queue`, no Redis): exact job name, id and payload per call for `UsageMeter` (+ `recordUnmetered`), `TranscriptStore`, `SessionStateStore`, `TraceSink`; a failed `add()` rejects; bad scope / other pair's ctx / malformed data rejects before enqueue; oversized help state refused before Redis. |
| Worker consumer, retries, dead letter | `worker/test/commit.int.test.ts` (compose Redis + Postgres): a real harness turn on the queue ports lands in Postgres via the workers (2 messages, 1 usage row, 1 trace, help state); a not_found job is dead-lettered after 1 attempt; an always-failing write is retried (3 attempts) then dead-lettered, logging `job.failed_will_retry` ×2 and `job.dead_lettered`, no payload text in logs. Unit: `processors.test.ts`, `deadLetter.test.ts`, `workers.test.ts`. |
| Idempotent retries | `commit.int.test.ts`: the same usage, message, help-state and trace jobs processed twice → `written` then `already_written`; exactly 1 `usage_ledger`, 1 `messages`, 1 `turn_traces` row; help state as saved. |
| `SessionStateStore` db adapter | `session-state.int.test.ts`: own open session written, last write wins; another student's, another teacher's, missing and ended session → `not_found` and unchanged; exactly `LIMITS.helpStateMaxJsonLength` saved, one more → `invalid`, nothing written. Isolation grid: `sessions.saveHelpState` case (cross-scope writes fail closed; oversized, circular, undefined, BigInt, bad id → `invalid`). |
| `TraceSink` db adapter + migration 0007 | `trace-sink.int.test.ts`: whole trace round-trips as `TurnTraceSchema`, summary columns derived; no usage → `''` and zeros; a second trace for a turn → `invalid`, 1 row; other scope's session → `not_found`; corrupt jsonb → `integrity`. `migrate.int.test.ts`: 0007's guard passes on an empty table and stops when `turn_traces` has a row. |
| `checkTeachersCost` scheduler | `alarms/schedule.test.ts`: one daily UTC job scheduler; a run checks this month's teachers (`usageLedger.teacherIdsWithUsageSince`) and logs **each** per-teacher failure (`cost_alarm.teacher_failed`, level error) plus a summary; a failed teacher list fails the job (retried, logged). Isolation grid: the new read returns exactly the seeded teacher ids, `[]` for a future date, `scope` for bad args. |

## Changes

- **harness** `pipeline/types.ts`: `PipelineDeps.sessionState`; `CommitRecord.sessionId` (from the original input) and `receivedAt` (turn start). `runner.ts` sets both. `steps/meter.ts`, `steps/commit.ts`: the real steps (stubs removed). `testing/memoryPorts.ts`: `memoryTranscriptStore`, `memorySessionStateStore` (exported); `testDeps` has an `unusedPort('sessionState')`.
- **db**: migration `0007_turn_trace_fields.sql` (+ snapshot; empty-table guard, then 7 NOT NULL columns and a unique index on `turn_id`); schema `turnTraces` matches. `turnTraces.insert(scope, trace)` takes the whole `TurnTrace` (summary columns derived); `listForSession` returns it. `sessions.saveHelpState` (one UPDATE scoped to own open session; size cap before SQL). `usageLedger.record`/`recordUnmetered` take an optional row `id`; new `usageLedger.teacherIdsWithUsageSince({ since })`. `ports.ts`: `sessionStateStoreFor`, `traceSinkFor`. README rules 11–12. Isolation cases for the 2 new methods; seed rows updated.
- **queue** (new workspace package `@edmate/queue`): queue names, job names/ids/options, payload schemas, `usageRowId`; `queuedUsageMeter` (also a gateway `MeterSink`), `queuedTranscriptStore`, `queuedSessionStateStore`, `queuedTraceSink`, `queuedTurnPorts`, `createTurnQueues`.
- **worker**: `commit/processors.ts` (idempotent processors on the db adapters), `commit/deadLetter.ts`, `commit/workers.ts`, `alarms/schedule.ts`, `log.ts`; `index.ts` starts the meter, commit and cost-alarm workers and upserts the schedule. Now depends on `@edmate/db`, `@edmate/queue`; uses the app ESLint preset (no `@edmate/db/internal` outside `test/`). `test/commit.int.test.ts`, `test/compose.port.yaml` (Redis on 127.0.0.1:56379).
- **CI** `.github/workflows/ci.yml`: a Redis service (digest-pinned `redis:7.4.6-alpine`) and `TEST_REDIS_URL`; `turbo.json` passes `TEST_REDIS_URL` to tests.

## Deviations

- The latency acceptance test is in `packages/queue/test/latency.test.ts`, not `runner.test.ts`: the harness can't import the queue adapters (rule 3).
- Job ids use `.` not `:` (`<turnId>.trace`, `<turnId>.usage.<n>`, `<messageId>.message`, `<sessionId>.help.<writeId>`): BullMQ rejects `:` in custom ids. Usage, message and help-state jobs can't be keyed by the turn id alone (several per turn; the ports carry no turn id).
- The help-state size check is in the repository (`sessions.saveHelpState`) and the producer, not in `sessionStateStoreFor` itself; the adapter delegates.
- Out of scope, as the lead said: TeacherQuestion for `ask_teacher` and `ProfileStore.applyEvidence` (task 3.17).

## Fix round 1

| Finding | Fix | Evidence |
|---|---|---|
| [privacy MEDIUM] student text kept in the dead-letter queue forever | Dead-letter entries keep `refs` only (a whitelist: student/teacher ids, session, turn, message id + role, package, index), plus the error and attempt count; no `message.text`, sources or help state. `FAILED_JOB_TTL_SECONDS` = 7 days (`@edmate/queue`): failed turn jobs `removeOnFail: { age, count: 1000 }`; dead-letter jobs `removeOnComplete`/`removeOnFail: { age }`; `pruneDeadLetters` removes waiting entries older than that (worker start, then hourly). | `deadLetter.test.ts`: entry has no `student text` / source title, in entry or log; `deadLetterRefs` per job kind and on malformed payloads; prune calls `clean(604800000, 1000, 'wait')`, logs, never throws. `commit.int.test.ts`: the real dead-letter entry has no student-text canary and `removeOnFail: { age: 604800 }`. |
| [LOW] trace duplicate check read every trace of the session | New `turnTraces.findForTurn(scope, { sessionId, turnId })` (uses the turn_id index); the processor uses it. | Isolation-grid case `turnTraces.findForTurn`; `trace-sink.int.test.ts` (own, other session, other student, missing, bad id → `invalid`, corrupt → `integrity`). |
| [db MEDIUM] `teacherIdsWithUsageSince` had no index | `usage_ledger_created_at_source_idx` on `(created_at, source)`, migration `0008_usage_ledger_created_at_index.sql` (generated; CREATE INDEX only). | `migrate.int.test.ts` applies all migrations. |
| [silent-failure MEDIUM] `once()` swallowed the recheck error | Processors take the injected `Log`; a failing recheck logs `job.recheck_failed` (job name, job id, error name/message) and the write's own error still decides the retry. | `processors.test.ts`: exact log line, with and without a BullMQ id. |

Gates: `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker... --filter=@edmate/db... --filter=@edmate/queue...` (compose Postgres + Redis up, no suite skipped) → `Tasks: 26 successful, 26 total`; worker `Tests 102 passed`, db `Tests 401 passed`, queue `Tests 20 passed` (100 %), harness `2111 passed`; `deadLetter.ts`, `processors.ts`, `turn-traces.ts` 100 / 100 / 100 / 100. `python3 .githooks/secret-scan.py --all` → exit 0.

## Decisions

### 18 Oct 2026 · 3.8 Dead letters keep ids only and expire after 7 days · decided by tdd-guide (review fix) · risk: medium
Decided: a dead-letter entry keeps a whitelist of ids, the error and the attempt count, never message text, sources or the help state. Failed jobs and dead-letter entries expire after 7 days; the worker prunes waiting entries hourly, because BullMQ's removeOn options never reach jobs that only wait.
Why: privacy review; an entry still names what to replay.
Alternatives: keep payloads for replay; no expiry.
Reversible: yes.

### 18 Oct 2026 · 3.8 Turn writes go through BullMQ; answer key stays in sessions.help_state · decided by tdd-guide · risk: high
Decided: meter and commit only enqueue; apps/worker writes through the scoped db adapters, retries 5 times with backoff, then dead-letters. The help state is written only by `sessions.saveHelpState` (own open session, size cap); its job is removed on failure and its dead-letter entry drops the value. Touches `packages/db/src/repositories/**` and `.github/**`.
Why: lead answers Q2, Q4, Q5; the canary tests show the answer key reaches no message, trace, log or dead-letter entry.
Alternatives: direct db writes in the turn.
Reversible: yes.

### 18 Oct 2026 · 3.8 Idempotent retries without a new unique column · decided by tdd-guide · risk: medium
Decided: a usage row's id is derived from (turn id, call index); a message's id is the caller's; one trace per turn via a unique index on `turn_traces.turn_id` (migration 0007); help-state saves are last-write-wins. A worker re-running a job checks for its row first and reports `already_written`.
Why: a retry must never bill twice or duplicate a message.
Alternatives: a unique (turn_id, index) column on usage_ledger; Redis idempotency keys.
Reversible: yes.

### 18 Oct 2026 · 3.8 Help-state saves can arrive late · decided by tdd-guide · risk: medium
Decided: the commit worker runs one job at a time so a session's saves apply in order; a save retried after a newer one succeeded can still land last, and the next turn may read a state not yet saved. Accepted; the next turn's save corrects it.
Why: the frozen port has no turn order or version; adding one is a contracts change.
Alternatives: a version column checked in the UPDATE (follow-up if seen in practice).
Reversible: yes.

### 18 Oct 2026 · 3.8 Cost alarm checks teachers with usage this month · decided by tdd-guide · risk: medium
Decided: new system read `usageLedger.teacherIdsWithUsageSince({ since })` (teacher ids only, second exception to "every method is scoped", README rule 11). A daily job at 03:30 UTC (provisional) checks them; every per-teacher failure is logged at error level and retried by the next run.
Why: lead answer Q3; a teacher with no usage this month can't be over the threshold.
Alternatives: teachers with a subscription; all agents' owners.
Reversible: yes.

### 18 Oct 2026 · 3.8 Migration 0007 stops if turn_traces has rows · decided by tdd-guide · risk: medium
Decided: 0007 adds the TurnTrace fields as NOT NULL with no default and refuses to run on a non-empty `turn_traces` (like 0006's guard); the old model/token/cost columns stay, derived from `usage` (model = distinct models, comma-separated, '' when no call).
Why: old rows can't be filled truthfully; additive keeps rollback simple.
Alternatives: nullable columns; backfilling placeholders.
Reversible: yes.

### 18 Oct 2026 · 3.8 Student message timestamp and CommitRecord.receivedAt · decided by tdd-guide · risk: low
Decided: `CommitRecord` gains `receivedAt` (turn start) besides `sessionId`; the student message uses it and the reply uses `createdAt`, so history orders student before agent.
Why: both messages at the finish time would sort by opaque id.
Alternatives: same timestamp; a sequence column.
Reversible: yes.

### 18 Oct 2026 · 3.8 Redis in CI for the worker integration test · decided by tdd-guide · risk: low
Decided: CI gets a digest-pinned Redis service and `TEST_REDIS_URL`; the worker integration test fails (not skips) in CI without it, like the db suites. Locally `apps/worker/test/compose.port.yaml` publishes Redis on 127.0.0.1:56379.
Why: the acceptance needs a real queue round trip.
Alternatives: skip in CI.
Reversible: yes.

### 18 Oct 2026 · 3.8 The queue meter is also the gateway's MeterSink · decided by tdd-guide · risk: low
Decided: `queuedUsageMeter` implements `recordUnmetered` too, so 2.4's metering wrapper can write through the queue (durable retry for 2.4's failed writes). Avoiding double metering (gateway and meter step) is 3.7's (its Q1-B).
Why: 2.4 deferred retries to 3.8.
Alternatives: a separate sink.
Reversible: yes.

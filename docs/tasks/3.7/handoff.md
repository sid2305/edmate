# 3.7 handoff: orchestrator (generate): streaming, tool calls, cost ceiling, turn events

**Status:** DONE
**Branch:** `m3/3.7-orchestrator` (rebased on origin/main `254bb42`)
**Worktree:** `.claude/worktrees/agent-ac205a10058b36c56`

## Acceptance evidence

| Item | Evidence |
|---|---|
| A full turn streams via the scripted gateway | `pipeline/turn.integration.test.ts` › `streams a full turn`. It uses the real admit, entitle, buildContext, decide and generate steps (preGuard, route, postGuard, meter and commit are `testSteps` doubles). Round 1 is text, then `tool_call`, then usage; round 2 is text, then usage. The events are exactly `hint_rung, token, skill, token, sources, done`; every event passes `TurnEventSchema`; there is one terminal event; `done.usage` holds both rounds, priced. ✓ |
| An over-budget turn aborts with `turn_cost_exceeded` | Same file › `aborts an over-budget turn`. Events are `hint_rung, token, replace{''}, error{turn_cost_exceeded, retryable:false}`. One stream call (no second round, no retry), and the iterator's `return()` is called once. postGuard never starts. The trace has generate `failed` and still holds the usage. The commit outcome is `error`. ✓ |
| Tool calls, max 3 rounds | `generate/toolLoop.test.ts` (19 tests): 0, 1 and 3 rounds; the final call has no `tools`; a `tool_call` on a call with no tools fails the attempt; not offered → `not_available`; invalid or non-JSON args → `invalid_arguments` and the tool doesn't run; output fails `tool.output`, is over 4,000 characters, isn't JSON-safe, or the tool throws → `failed` (no internals reach the model); 3 s timeout on the virtual clock → `timed_out`; more than 4 calls → `too_many_calls`. ✓ |
| Cost ceiling | `generate/costCeiling.test.ts`: totals add up across calls and attempts; over the ceiling after a usage → abort; at the ceiling → no new call; unpriced, negative, NaN or throwing prices fail closed; an invalid ceiling fails closed. Runner: `runner.generate.test.ts` › `metering` (unpriced usage → `turn_cost_exceeded`; invalid ceiling → no model call, reported). ✓ |
| Events in order | `generate/generate.test.ts` (19 tests): `hint_rung` only for hint, worked_example and solution; `token`/`skill` come in stream order; `sources` only for cited `[n]` and none for out-of-range numbers; `sources` before `locked`; `locked` names the package only for `name_package`. Runner: `teacher_question` before postGuard's `replace`; `replace ''` before an error. ✓ |
| Cancellation | `runner.generate.test.ts` › `client disconnect`: the consumer `return()`s mid-stream → the spy records one iterator `return()`, one request, no retry, no postGuard, commit `error` with the input and no reply, trace generate `failed`, and the turn ends well before the stream would have. `RunTurnOptions.cancel` works the same way. A cancel before generate, or before the turn starts, makes no stream call. ✓ |
| Every attempt is metered; `source` from the entitlement | `runner.generate.test.ts` › `metering`: a primary attempt that streams usage and then fails keeps its usage in the trace and `done`; so does a timed-out attempt. Every `gatewayFor` billing is `{teacherId, packageId, studentId, turnId, source:'teacher_preview'}` from the entitlement, while the root source is `subscription`. Policies: guards get the full policy, the primary gets no `fallback`, and the retry gets `main := fallback`. A metered gateway's usage stays out of `meter`. ✓ |
| Skill payloads fail closed | `generate/skillEvent.test.ts` (11) and `generate.test.ts`: an answer key (any case, any depth, keys or quoted) drops the event and reports it; a payload over 16 KB, an unentitled skill, a throwing `present` or a malformed presentation are dropped too. ✓ |
| TeacherQuestion before `done` (Q3) | `runner.generate.test.ts` › `teacher_question`: findSimilar then open with the scrubbed text, so the raw text never appears; the event and `CommitRecord.teacherQuestionId` are set. A failure, a 500 ms timeout, another teacher's similar question or a question for someone else each mean no event, `done` still sent, and the failure reported. No text means no call. ✓ |
| Background failures logged (Q7) | `runner.generate.test.ts` › `background failures are logged`: one entry per failure with the task, the ids, `errorName` and `errorMessage`, and never the input text. An invalid id is logged as `invalid`. The message is cut at 300 characters. A non-Error throw logs as its type with no message. A throwing logger doesn't break `finished`. A clean turn logs nothing. ✓ |
| SSE encoder | `pipeline/sse.test.ts`: newlines stay on one data line; every event type round-trips; an invalid event throws. ✓ |
| Gate: harness and its deps | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force` → `Tasks: 10 successful, 10 total`; harness `Tests 2260 passed (2260)` |
| Coverage | All files: 99.17 statements, 98.01 branches, 98.24 functions, 99.49 lines. `src/pipeline` 98.78 / **97.25 branches** / 98.43 / 99.61 (≥ 95% branches). `generate/*` 100% except `steps/generate.ts` (93.75% branches). `tools.ts`, `sse.ts` and `backgroundLog.ts` are 100%. |
| Gate: dependents | `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` → `Tasks: 34 successful, 34 total` (queue latency test green; the db and worker `*.int.test.ts` skip locally without Postgres and Redis, but they typecheck) |
| Contracts untouched | `git diff origin/main -- packages/contracts \| wc -l` → `0` |
| Purity | eslint `harness-purity/no-external-import` clean (only contracts, zod and own modules) |
| Secret scan | `python3 .githooks/secret-scan.py --all` → no findings |
| No real model | every test uses `ScriptedGateway`, through `spyGateway` |

## Changes

- `pipeline/steps/generate.ts`: the real step. It builds `buildModelRequest` plus the entitled tool specs and runs the tool loop through `env.gateway`. It emits `hint_rung`, `token`, `skill`, `sources` and `locked`.
- `pipeline/generate/`:
  - `streamReader.ts`: a cancel-raced reader with chunk validation and a background `return()`.
  - `toolLoop.ts`: the rounds and the per-call checks.
  - `toolMessages.ts`: the JSON envelopes.
  - `costCeiling.ts` (`TurnCost`, `DEFAULT_MAX_TURN_COST_MICRO_USD = 100_000`).
  - `citations.ts`, `skillEvent.ts`.
  - `streamGate.ts` (pass-through seam).
  - `index.ts`.
- `pipeline/tools.ts`: the `ToolRegistry`, `noTools`, `entitledTools` (which rejects duplicates), `policyTools`, `offeredTools` and `toolSpec`. `steps/decide.ts` passes the entitled tools to the policy.
- `pipeline/turnGateway.ts`: the billing from the entitlement, the guards/primary/retry policies, a refusing gateway, and a checked `gatewayFor`.
- `pipeline/runner.ts`:
  - It builds the turn gateways after entitle and prices usage as it streams (`StepEnv.usage`).
  - It enforces the ceiling, keeps the usage of failed attempts, and meters only step-reported usage plus unmetered-gateway usage.
  - It sends `replace ''` before an error and handles cancellation (`EventQueue.onDetach`, `RunTurnOptions.cancel`, `linkCancel`, `TurnCancelled`).
  - It opens the TeacherQuestion before `done` and logs background failures (`backgroundLog.ts`).
- `types.ts`:
  - `PipelineDeps`: `gatewayFor`, `priceUsage`, `maxTurnCostMicroUsd?`, `tools?`, `streamGate?` and `log` replace `gateway`.
  - `StepEnv`: adds `gateway`, `usage` and `report`.
  - `GenerateResult` is now `{ draft }`; `CommitRecord` gets `teacherQuestionId?`; `BackgroundTask` gains `generate` and `teacher_question`.
- `results.ts`, `policies.ts` (`TurnCancelled` is not retried), `spec.ts` (`TEACHER_QUESTION_TIMEOUT_MS = 500`), `events.ts`, `errors.ts`, `clock.ts`.
- `pipeline/sse.ts`: `formatSseEvent`.
- `testing/`:
  - New: `spyGateway.ts`, `memoryToolRegistry.ts`, `memoryTeacherQuestionStore`, `memoryTurnLog`, `stepEnvExtras()`.
  - `testDeps` builds `gatewayFor` (unmetered spy), `priceUsage = u.costMicroUsd` and `log`. The happy `generate` double uses `env.gateway` and `env.usage`.
- Tests: `runner.generate.test.ts` and `turn.integration.test.ts` are new. Existing tests now drop `usage` from generate results and add `...stepEnvExtras()` to `StepEnv` literals. The 3.6 runner tests use the real generate.
- `packages/harness/README.md`: a 3.7 section.

## Deviations

- **Metering split: `TurnGateway.metered` (not in the plan).** `gatewayFor` returns `{ gateway, metered }`. The root's `meterRouter` gateway is `metered: true`, so its usage stays out of the `meter` step. A bare gateway (`testDeps`) is `false`, so its usage still goes to `meter`. This keeps 3.8's `meter` step and the queue and worker tests (out of bounds) unchanged and green, and nothing is billed twice. The plan's version ("meter gets none today") would have broken `packages/queue/test/latency.test.ts` and `apps/worker/test/commit.int.test.ts`.
- **Usage reported in a step's result** (preGuard, route, postGuard) still goes to `meter` and counts at its own cost against the ceiling. Usage streamed through `env.gateway` goes through `env.usage.record`. 4.x guards that call the gateway should record through `env.usage`, not in their result.
- **`deps.streamGate?`**: the 4.5 seam is injected through deps, not a generate factory.
- **Two out-of-plan test edits:**
  - `packages/harness/src/access/property.test.ts` (**risky path `packages/harness/src/access/**`**, so security-reviewer is required; it is already listed) gets one `...stepEnvExtras()` line.
  - `packages/db/test/{session-state,turn-config}.int.test.ts` (listed out of bounds as 3.8's) get the same one-line fix plus the import. Test-only; no production code outside the harness changed.
- Runner tests are in a new file, `runner.generate.test.ts` (describe blocks `metering`, `client disconnect` and so on), so `runner.test.ts` stays readable. `generate/index.ts` is a barrel with no test of its own.
- `pedagogyDecisionAskTeacher` isn't exported from the contracts fixtures, so the runner tests define an ask_teacher decision locally. Contracts are untouched.
- Size: about 1,430 added non-test lines (source, testing helpers, README) and 2,400 test lines in one PR (the lead didn't split it into 3.7a and 3.7b).

## Decisions

### 18 Oct 2026 · 3.7 Tools offered and run only when entitled; skill payloads checked for the answer key; partial text cleared before an error · decided by tdd-guide (lead brief) · risk: high
Decided: a tool is offered and run only when the decision names it, it is in the registry, and its skill is in the entitlement (checked in decide and again in generate; duplicate names fail closed). A `skill` event is dropped and reported unless its skill is entitled, its payload is at most 16 KB of JSON, and it holds no do-not-say string (case-insensitive, JSON text and every string leaf). Any streamed text is cleared with `replace ''` before a retry and before every error, a cancel included.
Why: access rule 5 (locked means locked), no answer leak through structured events, and unguarded text never stays on screen.
Alternatives: trust decide's tool list; leave the payload check to 4.5; leave partial text on an error.
Reversible: yes; 4.5 replaces the substring check with the robust one.

### 18 Oct 2026 · 3.7 Q1 per-turn metered gateway billed from the entitlement · decided by lead · risk: medium
Decided: after entitle the runner calls `gatewayFor({ policy, billing })`, with billing `{teacherId, packageId, studentId, turnId, source}` from the entitlement only. The guards get the full policy, generate's primary gets no `fallback`, and the retry gets `tiers.main := fallback`. `TurnGateway.metered` keeps usage the gateway already metered out of the `meter` step.
Why: 2.4's `meterRouter` meters every attempt, unknown ones included; nothing is billed twice; 3.8's code is unchanged.
Alternatives: (A) the harness prices and meters everything, which loses unknown usage; meter all usage in the step and double-bill.
Reversible: yes.

### 18 Oct 2026 · 3.7 Q2 cost ceiling 0.10 USD; unpriced usage aborts with `turn_cost_exceeded` · decided by lead (code picked by tdd-guide) · risk: medium
Decided: the ceiling is `maxTurnCostMicroUsd` (default 100,000), counting step-reported usage plus every priced gateway call, failed attempts included. The check runs after each usage (over → abort) and before each call (at or over → abort). Unpriced or invalid prices, and an invalid ceiling, abort with `turn_cost_exceeded` (not `provider_error`).
Why: fail closed on cost; the code says why the turn stopped; one call can overshoot by at most its own cost (bounded by `maxOutputTokens`).
Alternatives: `provider_error` for unpriced; treat unpriced as free.
Reversible: yes; tune at 7.6.

### 18 Oct 2026 · 3.7 Q3 the runner opens the TeacherQuestion before `done` · decided by lead · risk: medium
Decided: for `ask_teacher`, the runner runs findSimilar then open with the scrubbed text within 500 ms, before postGuard, and sends `teacher_question` and `CommitRecord.teacherQuestionId`. On a failure, a timeout, or a cross-teacher or cross-student result there is no event, the failure is reported, and the turn still replies.
Why: the event needs the id before `done`; 3.17 shrinks to opening it in commit when it's absent, plus the profile evidence.
Alternatives: open in commit only (no event).
Reversible: yes. Note for 3.17: an open that times out may still land, so commit must open idempotently.

### 18 Oct 2026 · 3.7 Q4 tool results as JSON envelopes over the frozen ModelRequest · decided by lead · risk: medium
Decided: a tool round adds an assistant message (the round's text plus `{"tool_calls":[…]}`) and a user message (`{"tool_results":[…]}`, with output or a fixed error code). Both are built in code, with no prose.
Why: no contracts or prompt-pack change.
Alternatives: an ADR for native tool messages now.
Reversible: yes; that ADR is needed before 5.5's real tools meet a real model.

### 18 Oct 2026 · 3.7 Q5 abort reaches the provider at the next chunk · decided by lead · risk: low
Decided: the reader stops waiting on cancel at once and calls `return()` in the background; the adapter aborts when that reaches it.
Why: `ModelGateway.stream` has no abort signal (frozen contract).
Alternatives: an ADR adding a signal now.
Reversible: yes (a follow-up ADR candidate).

### 18 Oct 2026 · 3.7 Q6 SSE route deferred to 9.4 · decided by lead · risk: low
Decided: only the pure `formatSseEvent` encoder ships in the harness.
Why: auth, sessions and the root don't exist yet, and `apps/web/src/auth/**` is a risky path.
Alternatives: a route now.
Reversible: yes.

### 18 Oct 2026 · 3.7 Q7 sentence-gate seam, and every background failure logged · decided by lead · risk: medium
Decided: text passes `deps.streamGate` (a pass-through now; 4.5 fills it). Every `finished.background` failure goes to `deps.log.backgroundFailure` with the task, the ids (only when valid ids, else `invalid`), `errorName` and `errorMessage` (cut at 300 characters, empty for a non-Error throw), never turn text. A throwing logger is swallowed.
Why: no silent background failures; no text in logs.
Alternatives: leave logging to each caller.
Reversible: yes.

### 18 Oct 2026 · 3.7 Cancellation semantics · decided by tdd-guide · risk: medium
Decided: the consumer `return()`ing `events`, or `RunTurnOptions.cancel`, cancels the turn. Generate stops at once (`TurnCancelled`, never retried); postGuard and teacher_question are skipped; the stream ends `error provider_error`; meter, commit (outcome `error`, input saved, no reply) and the trace (generate `failed`) still run. A turn cancelled before generate makes no model call; steps before generate are not interrupted.
Why: the plan; no wasted model spend after the client leaves.
Alternatives: run the turn to the end; also interrupt earlier steps.
Reversible: yes.

### 18 Oct 2026 · 3.7 Tool-loop limits and event rules · decided by tdd-guide · risk: low
Decided: at most 3 tool rounds, then a final call with no tools; 4 calls per round, run in order; 3 s per tool; a 4,000-character result cap; error codes `not_available | invalid_arguments | failed | timed_out | too_many_calls`. `hint_rung` goes out for hint, worked_example and solution (again on a retry, after `replace ''`); `sources` holds only cited `[n]`; `locked` names only the student's own package and only for `name_package`. A gateway that can't be built becomes a refusing gateway (reported), so every step meets its own failure policy. admit and entitle get a refusing gateway.
Why: the plan's provisional numbers; fail closed.
Alternatives: other limits (revisit at 5.5 and 7.6).
Reversible: yes.

### 18 Oct 2026 · 3.7 `TurnGateway.metered` and the out-of-plan test edits · decided by tdd-guide · risk: medium
Decided: `gatewayFor` returns `{ gateway, metered }` so that 3.8's meter step, the queue latency test and the worker test stay unchanged. Usage a step reports in its result is still metered by `meter`. Three test files outside the plan get a one-line `...stepEnvExtras()`: `access/property.test.ts` (a risky path) and two `packages/db` int tests.
Why: keeps 3.8 green without double billing; keeps `StepEnv` strictly typed.
Alternatives: make the new `StepEnv` fields optional; send no usage to `meter` (breaks the 3.8 tests).
Reversible: yes.

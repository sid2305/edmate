# Task 3.7: Orchestrator (generate): streaming, tool calls, cost ceiling, turn events

Board: `board.py show 3.7` · M3 · deps 2.6, 3.1, M0 (all done; 3.6 merged) · branch `m3/3.7-orchestrator` · planner: opus.
Sequencing: **3.8 is running** and edits `pipeline/types.ts`, `pipeline/runner.ts`, `testing/testSteps.ts` and `testing/memoryPorts.ts`. Build 3.7 after 3.8 merges, or rebase onto it before review. The lead must answer Q1 before the build starts, because the answer changes how 3.8's `meter` step gets its input (see Q1).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Orchestrator: streaming, tool calls (max 3 rounds), per-turn cost ceiling, SSE events incl. `sources`, `locked`, `teacher_question`, `skill` and `replace`"
Accept: "an integration test streams a full turn via the scripted gateway; an over-budget turn aborts with `turn_cost_exceeded`."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| A full turn streams via the scripted gateway | `pipeline/turn.integration.test.ts` › `streams a full turn`. It runs `runTurn` with the **real** admit, entitle, buildContext, decide and generate steps. preGuard, route, postGuard, meter and commit come from `testSteps` (the guards are 4.x). It uses the memory stores and a `ScriptedGateway` script: round 1 is text, then a `tool_call`, then usage; round 2 is text, then usage. The test asserts the exact event sequence `hint_rung, token…, skill, token…, sources, done`, that every event passes `TurnEventSchema`, and that the stream ends with exactly one `done`. It also checks that `done.usage` holds both rounds' usage, priced. |
| An over-budget turn aborts with `turn_cost_exceeded` | Same file › `aborts an over-budget turn`. The scripted usage costs more than `maxTurnCostMicroUsd`. Events end `…token, replace{text:''}, error{code:'turn_cost_exceeded', retryable:false}`. The test asserts: no second stream call and no retry; postGuard is never called; the trace has generate `failed` and still holds the usage; the commit has outcome `error`. |
| Tool calls, max 3 rounds | `pipeline/generate/toolLoop.test.ts`: covers 0, 1 and 3 rounds. After round 3, the final call has no `tools` in its request. A `tool_call` on that final call fails the attempt. Args are checked with `tool.input` (invalid args → the tool is not run, and the model gets an error result). Tools that are not offered, unknown, or not entitled are never run. The output is checked with `tool.output`. Covered too: the per-tool timeout and a cap on calls per round. |
| Cost ceiling from streamed usage | `pipeline/generate/costCeiling.test.ts`: priced usage adds up across rounds and attempts (including a failed primary attempt). A total over the ceiling → `TurnAbort('turn_cost_exceeded')`. A new call is refused once the total is already at or over the ceiling. Unpriced usage fails closed (Q2). |
| Events in order | `pipeline/generate/generate.test.ts` and the runner tests. Order: `hint_rung`? → (`token` \| `skill`)* in stream order → `sources`? → `locked`? → `teacher_question`? → `replace`? → `done`. On failure, `replace ''` (if tokens were shown) comes before `error`. |
| Cancellation | `runner.test.ts` › `client disconnect`. The consumer calls `return()` on `events` in the middle of the stream. Then: generate stops at once; the gateway iterator's `return()` is called (a spy gateway records it); there is no retry and no postGuard; the commit has outcome `error`; the trace has generate `failed`. A turn cancelled before generate makes no stream call. Also checks that `RunTurnOptions.cancel` works the same way. |
| Every attempt is metered, `source` from the entitlement | `runner.test.ts` › `metering`. A primary attempt that streams usage and then throws still has its usage in the trace and in `done`. Under Q1-B, the turn gateway is built with billing `{ teacherId, packageId, studentId, turnId, source }`, all taken from `entitlement`. The fixture uses `source: 'teacher_preview'`, and the test asserts that value. The fallback attempt uses the policy's fallback model. |
| Gates | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` green, coverage of `src/pipeline` ≥ 95% branches. The harness purity hook stays clean (contracts, zod and its own modules only). `git diff origin/main -- packages/contracts` is empty. The secret scan is clean. No real model in any test (rule 4; no real-model turns before 4.5). |

## Design

### Already built (read-only inputs)
- The runner (3.1) runs generate with 15 s per attempt and one retry. It sends `replace ''` before the retry, and a `TurnAbort` is final. It adds usage **only when an attempt succeeds**; 3.1 review LOW, deferred to 3.7.
- `buildModelRequest` (3.6, `pedagogy/modelRequest.ts`; risky path, **not edited**) builds the main request: tier main, the system prompt, history plus the scrubbed input, maxOutputTokens and cacheKey. `DecideResult.sources` holds the `[n]`-numbered sources.
- The SDK adapter aborts the provider request in `finally` when the caller stops iterating. The router falls back only before the first chunk, and only on a retryable `GatewayError`. `meterRouter` meters each adapter attempt (failed, aborted or unknown included) with a per-turn `MeterContext`. Usage chunks pass through with `costMicroUsd: 0`, and `computeCostMicroUsd` is exported for 3.7.
- `decide.run` calls `decidePolicy` **without `tools`**, so `decision.tools` is always `[]` today.

### Generate step (`pipeline/steps/generate.ts` → `pipeline/generate/*`)
1. **Request.** `{ ...buildModelRequest({ ctx, decision, input: env.input, set }), tools }`. `tools` holds the registry tools named in `decision.tools` whose `skill` is in `ctx.entitlement.skills`, rechecked here (access rule 5, defence in depth). Each is `{ name, description, inputSchema: z.toJSONSchema(tool.input) }`, and `tools` is omitted when empty.
2. **Streaming.** A cancellable reader (`streamReader.ts`) races each `next()` against `env.cancel`. On cancel it stops waiting and calls `iterator.return()` in the background, with rejections caught. `text` → `emit({type:'token'})` and appended to the draft. `usage` → `env.usage.record(u)` (below), then the ceiling check. `tool_call` → queued for the round.
3. **Sentence gate seam (Q7).** Tokens pass through `StreamGate.push/flush`. The default is a pass-through that emits each token as it comes, so first-token latency is unchanged. 4.5 swaps in sentence buffering plus the incremental answer and locked n-gram check. 3.7 builds the seam and its tests only.
4. **Tool loop (`toolLoop.ts`).** A round ends when its stream ends. If it had tool calls, they run **sequentially**, at most 4 per round; the extras get an error result. Each call is checked like this:
   - The name must be in the round's offered list. Otherwise the result is `not_available` and nothing runs.
   - `tool.input.safeParse(args)` must pass. Otherwise the result is `invalid_arguments`.
   - `run(input, ctx)` runs with a 3 s timeout on the injected clock, inside the attempt's 15 s.
   - `tool.output.safeParse(result)` must pass. Otherwise the result is `failed`.
   - A JSON result over 4,000 characters gives `failed`.
   Error results carry only a fixed code, never internals. The next request appends one assistant message, `{"tool_calls":[{id,name,args}]}` (with any round text before it), and one user message, `{"tool_results":[{id,name,ok,output|error}]}`. Both are JSON envelopes built in code, with no prose, so no prompt-pack change is needed (Q4). **Max 3 tool rounds.** After the third round, the final call is sent with `tools` removed. A `tool_call` on a call that offered no tools fails the attempt, and the normal retry policy applies. The draft is all the round texts joined together, which is what the student saw.
5. **Skill events.** A registry entry may have `present(output, ctx) → { skill, payload } | undefined`, which the tool author writes (5.5/M6). The event is sent only if all of these hold:
   - `skill` is in the entitlement;
   - `JSON.stringify(payload)` is at most `LIMITS.skillPayloadMaxJsonLength`;
   - the payload contains no `decision.mustNotReveal` string (case-insensitive substring).
   Otherwise the event is dropped and the drop is reported to `background`. This is a cheap, fail-closed answer-key check. 4.5 adds the robust one.
6. **At the end of an attempt:**
   - `hint_rung {rung}` is sent first, before any token, for `hint`, `worked_example` and `solution` moves. Nothing else sends it, and 9.4 needs it.
   - `sources`: only the decide sources whose `[n]` appears in the draft, in `n` order. Out-of-range numbers are ignored (fake citations are 4.7's). The event is omitted when nothing is cited.
   - `locked`: sent when `decision.move === 'locked'`, with `packageName: ctx.pkg.name` only when `pkg.lockedReply === 'name_package'`. This matches 3.6 (only the student's own package is named, never a locked module).
   - The step returns `{ draft }`.

### Cost ceiling (`costCeiling.ts`)
- The harness gets `PipelineDeps.priceUsage(u: Usage): number | undefined`. The composition root binds it to the gateway's `computeCostMicroUsd` plus the price table. It also gets `PipelineDeps.maxTurnCostMicroUsd`, with a default constant `DEFAULT_MAX_TURN_COST_MICRO_USD` (Q2). The root reads the `MAX_TURN_COST_MICRO_USD` env var in 3.9.
- The running total covers every priced usage the turn has seen: steps 3 and 4 so far, plus every generate attempt, including a failed primary. Usage goes into the trace with `costMicroUsd` filled in from `priceUsage`, so `done.usage` never reads as free.
- The check runs **after each usage chunk** (total > ceiling → stop reading, `return()` the iterator, throw `TurnAbort('turn_cost_exceeded')`) and **before each new stream call** (total ≥ ceiling → abort with no call). Usage arrives at the end of each call, so one call can overshoot by at most one call's cost, and `maxOutputTokens` bounds that. This is documented.
- The literal reading applies: an over-ceiling usage aborts even when it comes from the last round.

### Runner changes (`pipeline/runner.ts`, `types.ts`, `results.ts`, `policies.ts`, `events.ts`)
- **Usage recorder.** Each generate attempt gets `env.usage: { record(u) }`, and the runner prices each usage and adds it to the trace **as it arrives**. Usage from attempts that throw or time out is kept. `GenerateResult` drops `usage` (it is now `{ draft }`), so nothing is counted twice.
- **Turn gateway (Q1-B, recommended).** `PipelineDeps.gateway` is replaced by `gatewayFor(t: { policy: ModelPolicy; billing: { teacherId, packageId, studentId, turnId, source } }): ModelGateway`.
  - After entitle, the runner builds `billing` from `entitled.entitlement` and `env.turnId`. It never uses `deps.entitlementSource` or the input, which settles the 2.4 review LOW.
  - It puts the turn gateway on `StepEnv.gateway` for preGuard, route, generate and postGuard.
  - Generate's primary attempt uses the agent's policy **without** `fallback`, so the router doesn't fall back as well. The retry attempt uses `tiers.main := policy.fallback`, which is the spec's "one retry on the fallback model". With no fallback configured, the retry uses main again.
  - The root (3.9) implements `gatewayFor` as `meterRouter(createRouter(policy), sink, billing, prices)`, so each attempt is metered once by 2.4's code, including failed, aborted and unknown ones. The runner then gives `meter` only usage that did **not** come through the turn gateway, which is none today. 3.8's `meter` step code is unchanged and is simply skipped when its list is empty, as it is now.
- **`replace ''` before `error`** whenever any token was shown in the turn: on a cost abort, or when the retry also failed after streaming. Unguarded partial text never stays on screen.
- **Cancellation.**
  - There is a turn-level cancel source. It fires when the consumer detaches from `events` (a new `EventQueue.onDetach`) or when `RunTurnOptions.cancel?: Cancel` fires; the CLI uses the latter for Ctrl-C.
  - Generate's step token is linked to it (`linkCancel`). A cancelled attempt ends with an internal `TurnCancelled`, which is never retried.
  - The runner then skips postGuard and teacher_question and ends the stream with `error provider_error`, which no one receives. It still runs meter, commit (outcome `error`, input saved, no `replyText`) and the trace (generate `failed`).
  - A turn cancelled before generate makes no model call.
- **teacher_question (Q3).** This runs after generate succeeds and before postGuard, for `move === 'ask_teacher'` only.
  - `findSimilar(teacherId, scrubbedText)`, then `open({ teacherId, agentId, studentId, text: scrubbedText, similarIds })`, within one 500 ms budget on the injected clock.
  - On success, the runner sends `teacher_question {questionId}` and sets `CommitRecord.teacherQuestionId`.
  - On failure or timeout: no event, the error goes to `background`, `done` still goes out, and commit (3.17) opens the question if the id is absent. Text is never the raw input.
- **SSE encoder (`pipeline/sse.ts`).** A pure `formatSseEvent(e: TurnEvent): string`, giving `event: <type>\ndata: <json>\n\n`. Its test covers newlines in the text. **No `apps/web` route.** Auth, sessions and the composition root don't exist yet, and `apps/web/src/auth/**` is a risky path. The route handler goes to 9.4/M8 and reuses the encoder (Q6).

### Tool registry stub (`pipeline/tools.ts`)
- The harness type is `ToolRegistry { list(): readonly RegisteredTool[] }`, where `RegisteredTool = { tool: Tool<unknown, unknown>; present? }`.
- `entitledTools(registry, entitlement)` filters on `skill ∈ entitlement.skills`. `decide.ts` passes that list as `PolicyInput.tools`. This is a one-line change; `pedagogy/policy.ts` is untouched.
- The default is `PipelineDeps.tools = noTools`. The test-only `memoryToolRegistry(entries)` goes in `testing/`.
- 5.5 builds the real registry, the sandboxed calculator and the scope fuzz test.

## Files

Create (all under `packages/harness/src/`):
- `pipeline/generate/streamReader.ts`, `toolLoop.ts`, `costCeiling.ts`, `citations.ts`, `toolMessages.ts`, `streamGate.ts`, `index.ts`, each with a `*.test.ts`
- `pipeline/generate/generate.test.ts`
- `pipeline/tools.ts` + `tools.test.ts`
- `pipeline/sse.ts` + `sse.test.ts`
- `pipeline/turn.integration.test.ts`
- `testing/memoryToolRegistry.ts`
- `testing/spyGateway.ts`: wraps `ScriptedGateway`, records requests, billing and iterator `return()` calls

Modify:
- `pipeline/steps/generate.ts`: replace the stub
- `pipeline/steps/decide.ts`: pass `tools`
- `pipeline/types.ts`: `PipelineDeps.gatewayFor/priceUsage/maxTurnCostMicroUsd/tools`; `StepEnv.gateway/usage`; `GenerateResult`; `CommitRecord.teacherQuestionId`; `RunTurnOptions.cancel`
- `pipeline/runner.ts`, `results.ts`, `policies.ts`, `events.ts`, `errors.ts` (`TurnCancelled`), `clock.ts` (`linkCancel`)
- `testing/testSteps.ts`, `testing/index.ts`, `src/index.ts`, `packages/harness/README.md`
- Existing tests that use `deps.gateway` or `GenerateResult.usage` (`runner.test.ts`, `policies.test.ts`)

Out of bounds:
- `packages/contracts/**`: no port change. `ModelGateway.stream` has no abort signal, and `ModelRequest` has no tool-role messages. Both are ADR candidates (Q4, Q5).
- `packages/harness/src/pedagogy/**`, `guardrails/**` and `access/**`; `content/**`
- `packages/gateway/**`: `meterRouter`, `createRouter` and `computeCostMicroUsd` are used by the 3.9 root, unchanged
- 3.8's files: `steps/meter.ts`, `steps/commit.ts`, `packages/queue`, `apps/worker`, `packages/db`
- `apps/web/**` (9.4/M8) and `apps/cli/**` (3.9)

## Tests first (tdd-guide order)
1. `streamReader.test`: cancel during a pending `next()` returns at once; `return()` is called once; late chunks are ignored; a `return()` rejection is swallowed and reported.
2. `costCeiling.test`: the check after usage and the check before a call, an unpriced usage, and totals across attempts.
3. `citations.test`, `toolMessages.test` (the JSON envelope; args and outputs that are not JSON-safe) and `streamGate.test` (pass-through).
4. `tools.test`: the entitlement filter; a duplicate name is rejected.
5. `toolLoop.test`: the full matrix in the acceptance table, on the virtual clock.
6. `generate.test`: the request equals `buildModelRequest` plus the tool schemas, with no locked chunk text (canary); the event order; `hint_rung`, `sources` and `locked` rules; a skill payload containing an answer key is dropped; a payload over 16 KB is dropped.
7. Runner tests: the usage recorder on a failed or timed-out attempt; the turn gateway's billing comes from the entitlement; fallback-policy selection; `replace ''` before an error; cancellation (detach, and `opts.cancel`, both before and during generate); teacher_question (success, failure, timeout, open called once with the scrubbed text).
8. `turn.integration.test`: both acceptance cases.
9. `sse.test`. Then run the full gate, prettier and the secret scan.

## Risky paths touched
None (checked against risk-paths.txt). Every planned path is under `packages/harness/src/pipeline/**`, `packages/harness/src/testing/**`, `packages/harness/src/index.ts`, `packages/harness/README.md` or `docs/tasks/3.7/`. None matches a glob. The untouched risky paths are `pedagogy/**`, `guardrails/**`, `access/**`, `content/**`, `packages/contracts/**` and `apps/web/src/auth/**`.

Even so, the task touches the access rule on tools (only entitled tools are offered and run), the answer-key check on skill payloads, and unguarded streamed text. So per the lead's brief, plan a **`risk: high`** decision entry: "3.7 Tools offered and run only when entitled; skill payloads checked for the answer key; partial text cleared before an error".

Recommended reviewers: `typescript-reviewer`, `silent-failure-hunter` (abort, swallowed rejections, metering gaps), `security-reviewer` (tool scope, billing source, tool output fed back to the model) and `safety-reviewer` (streamed text before postGuard, skill payloads, locked event).

Size: about 900 source lines and 1,300 test lines, which is over rule 9's 600-line aim. The alternative is two PRs: 3.7a covers the stream, ceiling, metering, cancel and events; 3.7b covers the tool loop and the registry stub. The lead's call.

## Open questions (recommendations)
- **Q1 Metering path (answer before the build; affects 3.8).**
  - (A) The harness prices usage, puts it in the trace, and 3.8's `meter` step records it through `UsageMeter`. This cannot record unknown or unpriced usage (an aborted stream, or a `generateObject` call), so a call would be dropped or stored as free. That breaks 2.4's CRITICAL rule.
  - (B, recommended) A per-turn `gatewayFor({policy, billing})`, with billing taken from the entitlement, metered by 2.4's `meterRouter`. It records every attempt, unknown ones included. The harness `meter` step gets only non-gateway usage (none today), so 3.8's code is unchanged. B also gives per-agent `modelPolicy` and a real "retry on the fallback model", which settles 2.3 Q2.
- **Q2 Ceiling value and unpriced usage.** Recommend a provisional default of 100,000 micro-USD ($0.10), injected; 7.6 tunes it. Unpriced usage fails closed (`turn_cost_exceeded`), and 2.4 already logs it loudly.
- **Q3 Opening the TeacherQuestion.** The `teacher_question` event needs the id before `done`, so the runner should open the question before `done` (500 ms budget). 3.17 then shrinks to "open it in commit if it wasn't opened in the turn" plus the profile evidence.
- **Q4 Tool results over the frozen `ModelRequest`.** Recommend the JSON envelopes now. An ADR for native tool messages comes before 5.5's real tools reach a real model.
- **Q5 Abort reaches the provider at the next chunk** (`stream()` has no signal). Accept that now. An ADR adding a signal is a follow-up candidate.
- **Q6 SSE route.** Defer to 9.4/M8; ship only the encoder.
- **Q7 Sentence gate.** Build the seam now as a pass-through; 4.5 fills it.

## Planned decisions (handoff `## Decisions`)
- risk: high: the tool entitlement filter, the skill-payload check and clearing partial text (above).
- medium: the Q1–Q3 outcomes; the cancellation semantics; `replace ''` before `error`.
- low: max 3 tool rounds plus a final call without tools; 4 calls per round; 3 s per tool; a 4,000-character result cap; `hint_rung` for ladder moves; `sources` limited to what is cited; `locked` names only the student's own package; the SSE encoder in the harness.

## Lead answers (18 Oct 2026)

- Q1: per-turn metered gateway on 2.4's `meterRouter`, billing context (incl. `source`) taken from the entitlement, never the request. 3.8's code unchanged.
- Q2: per-turn cost ceiling provisional default 0.10 USD (100_000 micro-USD), configurable, revisit at 7.6; a turn on an unpriced model aborts (`turn_cost_exceeded` or provider_error — pick one and log it). Logged.
- Q3: the runner opens the TeacherQuestion before `done` (3.17 then covers only learner-profile evidence).
- Q4/Q5: tool results as JSON tool messages; abort is observed at the next chunk. Record both as decisions.
- Q6: the SSE route handler is deferred to 9.4.
- Build after 3.8 merges; branch from that main. Scripted gateway only (no real models before 4.5).
- Reviewers: typescript-reviewer, silent-failure-hunter, security-reviewer, safety-reviewer (opus); risk: high entry.

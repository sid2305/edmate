# 3.1 handoff: pipeline runner

Status: DONE
Branch: `m3/3.1-pipeline-runner`
Worktree: `.claude/worktrees/agent-a64f1902711ecb10e`
Risky: no. It only touches `packages/harness/src/pipeline/**`, `packages/harness/src/testing/**`, `packages/harness/src/index.ts`, `packages/harness/README.md` and `docs/tasks/3.1/`, checked against `risk-paths.txt`. Contracts, `package.json` and the lockfile are unchanged.

## Acceptance evidence

Acceptance: "tests for each failure policy; steps 3, 4 and retrieval run concurrently."

| Item | Evidence |
|---|---|
| Each failure policy has a test | `src/pipeline/policies.test.ts` (58 tests) has one `describe` per step: admit, entitle, preGuard, route, escalate, buildContext, decide, generate, postGuard, meter and commit. Each describe is named with the spec's "On failure" text from `STEP_SPEC`, and each covers throw and timeout on the virtual clock. It also covers: admit and entitle make no gateway call (an `unusedPort` gateway, with its call list asserted empty), and these turns get no trace and no commit. A chunk from a locked module never reaches `decide`. Escalate beats both a block and a failed preGuard. Alert retries go 250/500/1000 ms and on up to a 30 s cap (asserted gaps `[250, 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]`). A retry after streamed tokens sends `replace ''`. `TurnAbort('turn_cost_exceeded')` is not retried. A 10 s meter or a 30 s commit doesn't delay `done`. |
| Steps 3, 4 and retrieval run concurrently | `src/pipeline/concurrency.test.ts` has three tests. (a) With preGuard, route and buildContext each sleeping 300/300/299 virtual ms, `decide` starts at `admit 10 + entitle 20 + 300`, and all three start at +30. (b) Barrier test: each step waits until the other two have started, and all three finish `ok`. (c) All three, and generate, see the scrubbed text; the scrub saw the raw text and finished before any of them started. A mutation check (making the group sequential) fails (a) and (b). |
| Timeouts on the injected clock | Every timeout test uses `virtualClock()`. `grep -rnE "setTimeout\|setInterval\|setImmediate\|useFakeTimers" packages/harness/src` → `no matches`. |
| Injected ids | `turnId`, `messageId` and fallback alert ids come from `IdSource` (`turn_1`, `message_1`, `alert_1`). `gives identical events and traces when the same scenario runs twice` compares timed events, the trace and the recorded traces. |
| Trace capture | Every trace in `trace.test.ts` and `runner.test.ts` is checked with `TurnTraceSchema.parse`. Entries are in spec order, not completion order. preGuard `ms` = scrub + checks (70 + 30 = 100). Escalated and blocked turns have `move: 'redirect'`. The trace JSON has none of the input text, draft text or rewritten text. `TraceSink.record` is called exactly once per turn that passed `entitle`, and never for admit or entitle rejections. |
| Streaming | `runner.test.ts` covers: every event passes `TurnEventSchema`; each stream ends with exactly one `done`/`error`; `done` is sent before a commit that never resolves; a consumer that stops early still gets commit and trace; an invalid emitted event counts as the step failing; a step can't send `done`/`error` itself; events sent after a timeout are dropped; a runner bug ends the stream with `provider_error`. |
| Purity and gates | Harness gates below. `src/pipeline/**`: 98.86% statements, 96.61% branches, 100% functions and lines. No new dependency. `git diff --stat origin/main -- packages/contracts pnpm-lock.yaml packages/harness/package.json` → empty. |

`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` (after merging origin/main):
```
@edmate/config:test:      Tests  34 passed (34)
@edmate/contracts:test:   Tests  282 passed (282)
@edmate/harness:test:     Tests  171 passed (171)
@edmate/harness:test: All files          |   99.19 |    96.71 |     100 |     100 |
@edmate/harness:test:  src/pipeline      |   98.86 |    96.61 |     100 |     100 |
 Tasks:    10 successful, 10 total
```

Root gates:
- `corepack pnpm turbo run build typecheck lint test` → `Tasks: 40 successful, 40 total`.
- `corepack pnpm exec prettier --check packages/harness` → `All matched files use Prettier code style!`
- `python3 .githooks/secret-scan.py --all` → exit 0, no output.
- `git merge origin/main` (2.2 adapters, board docs): clean, and the lockfile didn't conflict.

## Fix round 1

These two items came from silent-failure-hunter. Both are on the distress path.

1. **The last-resort caring reply** (HIGH). The escalate step's reply text is used if it is non-empty. Otherwise the runner uses `fallbackReplies.distress(lang, locale)`. If that throws or returns empty text, it sends a constant built into the runner, `LAST_RESORT_DISTRESS_REPLY` in `runner.ts`. This constant is not injected. The `token` text is therefore never empty. The SafetyAlert is still dispatched before the reply, and the message and trace are still saved. The trace marks escalate `failed`, so this is visible apart from an ordinary `fallback`. The failure is also listed in `finished.background`. The text was replaced in fix round 2; the current exact text is under "Fix round 2". Tests in `policies.test.ts` › `last-resort caring reply`:
   - the fallback text throws → the built-in reply;
   - the fallback text returns empty → the built-in reply;
   - each case checks the alert was raised, the commit was `escalated` with this reply, there is one trace, and escalate is `failed`;
   - an escalate step that returns empty text gets the locale fallback.
2. **The distress check when `route.onFailure` fails** (MEDIUM). The plan put the keyword check inside `route.onFailure` (3.3), so it was lost when that function threw. There is now an injected `PipelineDeps.distressCheck(text, lang): boolean`, which runs on the scrubbed text whenever `onFailure` throws or returns invalid data. A hit escalates the turn. If the check also throws, the turn uses `on_task`/`none`, the trace marks route `failed`, and both errors go to `finished.background`. Tests in `policies.test.ts` › `onFailure itself throws or returns junk`: no hit → `on_task`, route `fallback`; a hit → `safety`, an alert, trace intent `distress`; the check throws → `on_task`, route `failed`, two `runner` entries.

`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` → harness `Tests 176 passed (176)`; `src/pipeline` 98.89% statements, 96.13% branches, 100% functions and lines; `Tasks: 10 successful, 10 total`. The root gates and the secret scan were re-run after merging origin/main (results are in the round 1 commit and the report).

## Fix round 2

These four items came from safety-reviewer. Tests are in `policies.test.ts`.

1. **The scrub fails** (HIGH). The distress check (`deps.distressCheck`) now runs in-process on the raw text. It is a keyword check with no model call. The raw text is never stored, traced or reported: if the check throws, a generic error replaces it.
   - On a hit, the runner raises a runner-built alert and sends the last-resort reply. It runs no step on the raw text (escalate, route and guards are skipped).
   - It still saves the commit (`input: null`, outcome `escalated`) and the trace (preGuard `failed`, escalate `fallback`, intent `distress`). Neither contains the raw text.
   - No hit → `guard_blocked` as before.
   - Tests in `distress keyword check when step 3 fails`: scrub throws or times out with a hit; no hit; the check throws (the reported error does not contain the raw text).
2. **preGuard is not ok** (MEDIUM). When preGuard throws or times out and route didn't say distress, the check runs on the scrubbed text, and a hit escalates. Tests: preGuard throws or times out with a hit → escalation; preGuard ok → the check is not consulted.
3. **Building the alert fails** (LOW). The alert is built through `buildAlert`, which never throws and tries `fallbackAlert` twice. The reply is always sent. Each failure goes to `finished.background` (`alert`), and the trace marks escalate `failed`. If both attempts fail, the turn still sends safety, the reply and done, and is saved with no alert. Tests in `building the alert fails`: fails once (built on the retry); fails twice.
4. **New last-resort text** (LOW). The exact text of `LAST_RESORT_DISTRESS_REPLY`, for the safety reviewer:

   > I'm really glad you told me, and I'm sorry it's this hard right now. You matter. I'm an AI, so please reach out to someone you trust right now, like a friend, family member, teacher or counsellor. If you are in danger or might hurt yourself, contact your local emergency services now.

   A test pins the exact string. It also asserts there are no digits and that the text mentions "someone you trust", "I'm an AI" and "emergency services".

`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` → harness `Tests 185 passed (185)`; `src/pipeline` 98.94% statements, 95.91% branches, 100% functions and lines.

## Changes

- `src/pipeline/clock.ts`: `Clock { now, sleep(ms, cancel?) }`, `Cancel`, `CancelToken`, `IdSource`, `IdKind`, `isoAt`, `cancelSource()`.
- `src/pipeline/types.ts`: the step interface (`Steps`, `StepEnv`, `PipelineDeps`, `FallbackReplies`, the result types, `CommitRecord`, `TurnRun`, `TurnRunResult`).
- `src/pipeline/spec.ts`: `STEP_NAMES`, and `STEP_SPEC` (number, timeout and the verbatim "On failure" text). Alert retry constants.
- `src/pipeline/timeout.ts`: `runWithTimeout` (never rejects; it cancels the loser and swallows late rejections).
- `src/pipeline/events.ts`: a push/close async queue with no backpressure. A consumer that stops early detaches.
- `src/pipeline/results.ts`: zod schemas for each step result. A result that fails its schema counts as the step failing.
- `src/pipeline/policies.ts`: the failure-policy mappings and fallbacks.
- `src/pipeline/trace.ts`: `TraceBuilder` (spec order; only guard name, ok and action are copied).
- `src/pipeline/runner.ts`: `runTurn`.
- `src/pipeline/errors.ts`: `TurnRejection`, `TurnAbort`, `StepNotImplementedError`, `InvalidEventError`.
- `src/pipeline/steps/*.ts` + `index.ts`: one stub file per step (preGuard.ts holds `scrub` and `preGuard`) and `defaultSteps`.
- `src/testing/`: `virtualClock`, `sequentialIds`, `memoryTraceSink`/`memoryUsageMeter`/`memoryAlertSink`/`unusedPort`, `testSteps`/`testDeps` (happy-path doubles with a timed call log and a list of commits), `driveTurn`/`driveEvents`. `testing/clock.ts` `Clock` is now `Pick<pipeline Clock, 'sleep'>`; its behaviour is unchanged.
- `src/index.ts` exports the pipeline. `packages/harness/README.md` is new.

## Deviations

- **escalate gets no `emit`.** It returns `{ replyText, alert? }`, and the runner sends `safety`, then the reply as one `token`, then `done`. This keeps event order in runner code, and a failing escalate can't leave half a reply on screen.
- **Step signatures differ slightly from the plan sketch** (the plan left generics to the builder). The concurrent steps and escalate take `Entitled`, not a separate `PreState`, because `StepEnv.input` is already the scrubbed input after step 3. `meter` takes `{ usage, entitlement }`. `generate` takes `{ ctx, decision, attempt }` plus `emit`. `postGuard` takes `{ ctx, decision, draft }`.
- **Extra files:** `errors.ts`, `results.ts`, `testing/memoryPorts.test.ts`, `testing/driveTurn.ts`; `testDeps()` (the plan named only `testSteps`).
- **Usage from a failed generate attempt is not metered.** A step that throws or times out returns no usage. Capturing it is 3.7's job (the orchestrator or the gateway metering).
- **Size:** about 1,380 lines of pipeline source, 510 of test helpers and 1,570 of tests (3,523 lines in total). That is well over rule 9's 600-line aim, but the lead chose one PR.
- **Q4 is left open, as instructed.** No port loads `AgentConfig`, `PackageConfig`, `LocalePack` or `StyleCard`. `entitle` returns them (`Entitled`), and in tests they come from contracts fixtures. Pre-guards get `Entitled` plus the scrubbed input, not a full `TurnContext`. The architect should settle this before 3.2 and 4.1.

## Decisions

### 18 Oct 2026 · 3.1 Clock and IdSource are harness types, not contracts ports · decided by planner · risk: low
Decided: `Clock`, `Cancel` and `IdSource` live in `packages/harness/src/pipeline/clock.ts`. `harness/testing`'s `Clock` is now `Pick<Clock, 'sleep'>`.
Why: They are parameters of the harness entry point, not adapters that db, gateway or worker implement. Every caller already imports the harness, and contracts stay frozen.
Alternatives: A contracts port by ADR.
Reversible: Yes (by ADR later).

### 18 Oct 2026 · 3.1 No production clock or id adapters in the harness · decided by planner · risk: low
Decided: 3.1 ships no `Date.now`/`setTimeout`/`randomUUID` adapters. The first real caller (3.9) provides them.
Why: They need real timers and Node or DOM lib types, which the harness tsconfig doesn't have.
Alternatives: Ship them in the harness behind a lib change.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Stubs fail closed · decided by planner · risk: low
Decided: Every unbuilt step throws `StepNotImplementedError`, so the runner applies that step's policy. The only stub that returns data is `route.onFailure`, and that data is the spec's own default (`on_task`/`none`). `decide.fallback` throws too, because an `ask` decision needs a composed prompt (3.5/3.6).
Why: A stub that succeeds (for example `entitle`) would fail open in production.
Alternatives: Happy-path stubs.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Only generate may emit events · decided by builder · risk: low
Decided: The concurrent steps and escalate get no `emit`. The runner sends `safety`, the escalate reply, `replace`, `done` and `error` itself. Events from `generate` are checked against `TurnEventSchema`. `done`/`error` from a step are invalid, and events sent after a step's timeout are dropped.
Why: Event order never depends on scheduling, and a failed step can't leave a stream half-written.
Alternatives: Give escalate an `emit` (the plan sketch).
Reversible: Yes.

### 18 Oct 2026 · 3.1 Escalate beats block · decided by planner · risk: medium
Decided: After the concurrent group, a preGuard `escalate` or a route intent of `distress` (including from `route.onFailure`) escalates. This happens even when preGuard blocked or failed.
Why: A distressed student must never just be blocked.
Alternatives: Block first.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Meter still runs after escalate and block · decided by planner · risk: low
Decided: `meter` runs whenever the turn has usage, including escalated and blocked turns. It is skipped when there is no usage.
Why: § Model gateway says every call is metered. "Skip to step 11" would lose the small-model usage from steps 3 and 4.
Alternatives: Skip meter on escalate.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Error codes where the spec names none · decided by planner · risk: low
Decided:
- admit throw or timeout → `rate_limited`, retryable.
- entitle throw or timeout → `no_access`, retryable. An invalid or mismatched entitlement → `no_access`, not retryable.
- preGuard failure → `guard_blocked`, retryable. A block verdict → `guard_blocked`, not retryable.
- generate failure, or a runner bug → `provider_error`, retryable.
- An invalid TurnContext even after the fallback → `no_access`, not retryable.
Why: There is no `internal` code and contracts are frozen.
Alternatives: A new error code by ADR.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Runner checks the entitlement against the turn · decided by builder · risk: low
Decided: Besides the schema check, the runner refuses (`no_access`) an entitlement whose `studentId` or `agentId` differs from the input, or whose status is `paused` or `ended`.
Why: Defence in depth: a buggy `entitle` (3.2) can't give one student another student's package.
Alternatives: Trust `entitle` entirely.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Step results are schema-checked · decided by builder · risk: low
Decided: Every step result is parsed with a zod schema built from the contracts (`results.ts`). A result that fails counts as the step failing. Guard trace entries are strict (`name`, `ok`, `action` only).
Why: A buggy step hits its failure policy instead of passing bad data along. No step can put guard reason text into a trace (ADR-0003).
Alternatives: Trust the TypeScript types.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Generate: 15 s per attempt; `replace ''` before a retry after streamed tokens · decided by planner · risk: low
Decided: Each generate attempt gets its own 15 s. If the first attempt had streamed tokens, `replace { text: '' }` is sent before the retry. A `TurnAbort` is final and is not retried.
Why: The student never sees two half-replies. A cost-ceiling abort must not spend more.
Alternatives: One 15 s budget for both attempts.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Alert retry: 250 ms doubling, 30 s cap, no attempt limit, 5 s per attempt · decided by builder · risk: low
Decided: `AlertSink.raise` is retried on the injected clock with backoff starting at 250 ms, doubling to a 30 s cap, with no attempt limit. Each attempt times out after 5 s. The alert is dispatched before the reply is sent, and `finished` waits for delivery. Each failed attempt is listed in `finished.background`.
Why: This is the literal reading of "retried until delivered". The 5 s per-attempt timeout (the builder's addition) stops a hanging sink from blocking retries. Durable delivery is 4.3's worker.
Alternatives: A bounded attempt count.
Reversible: Yes.

### 18 Oct 2026 · 3.1 An invalid TurnContext is treated as a buildContext failure · decided by planner · risk: medium
Decided: If `TurnContextSchema` (retrieved ⊆ allowed modules, same teacher, entitlement matches pkg/agent) rejects the assembled context, the runner retries with the step 6 fallback context and marks buildContext `fallback`. If that also fails, the turn ends with `no_access`. `decide` never sees an invalid context.
Why: An access-filter bug degrades to `ask_teacher` instead of leaking locked material.
Alternatives: End every such turn with an error.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Traces for turns that end early · decided by lead (plan Q1) · risk: low
Decided: Turns rejected at admit or entitle get no trace and no commit. Escalated turns are traced with intent `distress`. Escalated, blocked and errored-before-decide turns get move `redirect`. A turn whose scrub failed uses intent `on_task`.
Why: `TurnTrace.intent`/`move` are required, and a rejected turn never really happened (rate-limit spam would flood traces).
Alternatives: A trace for every request.
Reversible: Yes.

### 18 Oct 2026 · 3.1 All of buildContext runs in the concurrent group · decided by lead (plan Q2) · risk: low
Decided: All of step 6 runs alongside preGuard and route, with one 300 ms budget.
Why: This is a superset of "the retrieval part of 6", and it avoids a second budget after the group.
Alternatives: Only retrieval concurrent.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Fallback texts are injected · decided by lead (plan Q3) · risk: low
Decided: `PipelineDeps.fallbackReplies` supplies `safeReply(lang)` and `distress(lang, locale)`. If one of these throws, the bug is reported in `finished`. postGuard then uses an empty text. escalate uses the built-in last-resort reply (fix round 1). The `safety` event, `done` and alert delivery still happen.
Why: The harness can't use next-intl. The texts come from 3.10/3.11 packs.
Alternatives: Hard-coded English.
Reversible: Yes.

### 18 Oct 2026 · 3.1 meter and commit never see unscrubbed text · decided by builder · risk: medium
Decided: Background steps get the scrubbed input. If the scrub failed, `CommitRecord.input` is `null` and `env.input` has no `text`.
Why: PII the scrub couldn't remove must never be persisted.
Alternatives: Store the raw input.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Built-in last-resort distress reply · decided by lead (fix round 1, silent-failure-hunter) · risk: medium
Decided: When the escalate step gives no reply text and `fallbackReplies.distress` throws or returns empty, the runner sends `LAST_RESORT_DISTRESS_REPLY`. This constant is built into the runner, is country-neutral and has no numbers. Its wording was set by safety-reviewer in fix round 2: it says "I'm an AI" and points to someone you trust and local emergency services. The trace marks escalate `failed`, and the alert, message and trace are still saved.
Why: A distressed student must never get an empty reply. A constant can't fail the way an injected text source can.
Alternatives: An injected text only (the original design); end with an error.
Reversible: Yes. The text should be reviewed by the safety reviewer and replaced by the 3.10/3.11 pack text paths, never removed.

### 18 Oct 2026 · 3.1 Injected distressCheck when route.onFailure fails · decided by lead (fix round 1, silent-failure-hunter) · risk: medium
Decided: `PipelineDeps.distressCheck(text, lang): boolean` is a required dependency. The runner calls it on the scrubbed text when `route.onFailure` throws or returns invalid data, and a hit escalates the turn. If the check also throws, the turn uses `on_task`/`none`, route is marked `failed` in the trace, and both errors are listed in `finished.background`.
Why: "Distress keywords still escalate" must hold even when the route fallback itself breaks.
Alternatives: Only `ROUTE_DEFAULT` (the original design); a check hard-coded in the harness (keywords belong in locale packs).
Reversible: Yes. 3.3/4.3 provide the real keyword check, and the caller wires it in.

### 18 Oct 2026 · 3.1 Distress keyword check on the raw text when the scrub fails · decided by lead (fix round 2, safety-reviewer) · risk: medium
Decided: When the scrub throws or times out, the runner runs `deps.distressCheck` in-process on the raw text. On a hit, it raises a runner-built alert, sends the last-resort reply and saves the commit (with `input: null`) and the trace. No step runs on the raw text. The raw text is never stored, traced or reported, and a check failure is reported as a generic error.
Why: A failed scrub must not silently block a student in distress. The keyword check is local code with no model call, so the raw text never leaves the process.
Alternatives: Always block on a scrub failure (the original design); run the escalate step on the raw text.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Distress keyword check whenever preGuard is not ok · decided by lead (fix round 2, safety-reviewer) · risk: medium
Decided: When preGuard throws, times out or returns an invalid result, and route did not say distress, the runner runs `distressCheck` on the scrubbed text. A hit escalates instead of blocking.
Why: A classifier timeout must not turn a distress message into a plain block.
Alternatives: Rely on route alone.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Building the alert never breaks the escalation · decided by lead (fix round 2, safety-reviewer) · risk: medium
Decided: The runner-built alert is tried twice. Each failure is listed in `finished.background` (`alert`), and the trace marks escalate `failed`. The caring reply, the safety event and `done` are always sent. If both attempts fail, the turn is saved without an alert.
Why: Previously a throwing id source sent `provider_error` to a distressed student, and no alert was raised.
Alternatives: End with an error.
Reversible: Yes.

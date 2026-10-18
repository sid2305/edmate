# Task 3.1: Pipeline runner

Board: `python3 .claude/skills/board/board.py show 3.1` · Milestone M3 · deps: 2.6, M0 · branch `m3/3.1-pipeline-runner` · risk: none found (see Risky paths touched).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Pipeline runner: eleven steps with the concurrency in Turn pipeline spec, timeouts, injected clock and ids, trace capture"
Accept: "tests for each failure policy; steps 3, 4 and retrieval run concurrently."

Spec it must honour:
- Build plan § Turn pipeline spec: the eleven-step table (timeouts, "On failure" column); "Steps 3, 4 and the retrieval part of 6 run concurrently after a regex-only PII scrub"; "each step is a pure function of `(input, ctx) → ctx` plus side effects through ports, with its own timeout"; Determinism: "every step accepts an injected clock, id generator and gateway".
- Build plan § Turn pipeline spec, Streaming with post-guards: "the final post-guard runs on the whole reply before `done`; a failure sends `replace`."
- Build plan § Model gateway, Metering: "every call writes a `usage_ledger` row".
- Contracts (frozen, unchanged): `TurnInput`, `TurnContext` (+ its superRefine: retrieved ⊆ allowed modules, same teacher, entitlement matches pkg/agent), `TurnEvent`, `TurnTrace`, `PedagogyDecision`, `SafetyAlert`, `Usage`, `ErrorCode`, the ports in `ports.ts`.
- ADR-0002 (ports live in contracts; harness uses them), ADR-0003 (the trace has no text field; locked text never enters a trace).
- Rule 3 (harness purity: contracts, zod, mathjs, own modules; no Node built-ins). Rule 4 (scripted gateway, no real model calls). Decision log 18 Oct 2026 "2.6 Clock kept local to harness/testing": 3.1 defines the clock/id shape.

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Each failure policy has a test | `src/pipeline/policies.test.ts` has one `describe` per step (admit, entitle, preGuard, route, escalate, buildContext, decide, generate, postGuard, meter, commit), each covering throw and timeout, run on the virtual clock; test names quote the spec's "On failure" text. |
| Steps 3, 4 and retrieval run concurrently | `src/pipeline/concurrency.test.ts`: (a) each of preGuard, route, buildContext sleeps 300 virtual ms; `decide` starts at `admit + entitle + 300`, not `+ 900`; (b) a barrier test: each of the three waits until the other two have started; it finishes with all three `ok` (it would time out if they ran one after another); (c) all three see the scrubbed text, and the scrub finished before any of them started. |
| Timeouts on the injected clock | Every timeout test uses `virtualClock()`; no `setTimeout`, `vi.useFakeTimers` or wall-clock waits anywhere in `src/` (grep shown in handoff). |
| Injected ids | `turnId`, `messageId` and fallback alert ids come from `IdSource`; a determinism test runs the same scenario twice and gets identical events and traces. |
| Trace capture | Every scenario's trace passes `TurnTraceSchema.parse`; entries are in spec order with `ms` from the virtual clock and the outcomes defined below; `TraceSink.record` called exactly once per turn that passed `entitle`. |
| Streaming | Every emitted event passes `TurnEventSchema`; the stream ends with exactly one `done` or `error`; `done` is emitted before `meter`/`commit` settle (a commit that never resolves does not delay `done`). |
| Purity and gates | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` green; coverage of `src/pipeline/**` ≥ 80%; no new dependency; `packages/contracts/**` untouched. |

## Design

### Clock and ids: harness-internal types, not contracts ports (decided; see Decisions)

```ts
// src/pipeline/clock.ts
export interface Cancel { onCancel(fn: () => void): void }        // runtime-neutral; no AbortSignal (lib is ES2023, types [])
export interface Clock {
  now(): number;                                                  // epoch ms
  sleep(ms: number, cancel?: Cancel): Promise<void>;              // cancelled sleeps resolve at once and drop their timer
}
export type IdKind = 'turn' | 'message' | 'alert';
export interface IdSource { next(kind: IdKind): string }          // must return a contracts-valid id
export const isoAt = (ms: number): string => new Date(ms).toISOString();
```

Why not contracts: ADR-0002 put ports in contracts so `db`/`gateway`/`ingest`/`worker` adapters need not depend on the harness. A clock and an id source are not infrastructure adapters those packages implement; they are parameters of the harness's own entry point, and every caller of `runTurn` already imports the harness. Defining them in the harness adds no dependency edge, needs no ADR and keeps contracts frozen. The 2.6 `Clock` (`{ sleep }`) becomes `Pick<Clock, 'sleep'>` re-exported from `testing/clock.ts`, so `ScriptedGateway` and `manualClock()` keep working unchanged.

Production adapters (`Date.now`/`setTimeout`/`crypto.randomUUID`) are **not** shipped in 3.1: they would need real timers in tests and DOM/Node lib types in the harness tsconfig. The first real caller (3.9 CLI, later the web app) provides them.

### Step interface (`src/pipeline/types.ts`)

Steps never mutate shared state: each returns a typed result, and the runner merges results into an immutable `TurnState`. Each step gets a `StepEnv`:

```ts
interface StepEnv { input: TurnInput; deps: PipelineDeps; cancel: Cancel & { readonly cancelled: boolean }; turnId: string }

interface PipelineDeps {               // all contracts ports, plus harness-internal clock/ids/fallback texts
  clock: Clock; ids: IdSource; gateway: ModelGateway;
  entitlements: EntitlementStore; profiles: ProfileStore; transcripts: TranscriptStore;
  retrieval: RetrievalIndex; teacherQuestions: TeacherQuestionStore;
  usage: UsageMeter; traces: TraceSink; alerts: AlertSink;
  fallbackReplies: FallbackReplies;    // see Q3
}
interface FallbackReplies { safeReply(lang: Lang): string; distress(lang: Lang, locale?: LocalePack): string }

type GuardTrace = TurnTrace['guards'][number];
interface Steps {
  admit(env): Promise<void>;                                                     // reject with TurnRejection(code)
  entitle(env): Promise<{ entitlement: Entitlement; agent: AgentConfig; pkg: PackageConfig; locale: LocalePack; styleCard: StyleCard }>;
  scrub(env): Promise<{ text?: string; guards: GuardTrace[] }>;                  // step 3, phase 1 (regex PII scrub)
  preGuard(env, s: PreState): Promise<{ result: 'ok' | 'block'; guards: GuardTrace[]; usage: Usage[] }
                                     | { result: 'escalate'; alert: SafetyAlert; guards: GuardTrace[]; usage: Usage[] }>;
  route: { run(env, s: PreState): Promise<{ intent: Intent; attempt: Attempt; usage: Usage[] }>;
           onFailure(env, s: PreState): { intent: Intent; attempt: Attempt } };  // default on_task/none; 3.3 adds the distress keyword check
  buildContext(env, s: PreState): Promise<{ profile; history; retrieved; lockedHit; persona?; helpRung }>;
  escalate(env, s: PreState, emit: Emit): Promise<{ replyText: string; alert?: SafetyAlert }>;
  decide: { run(env, ctx: TurnContext): Promise<PedagogyDecision>; fallback(ctx: TurnContext): PedagogyDecision };   // fallback must return move 'ask'
  generate(env, ctx: TurnContext, d: PedagogyDecision, emit: Emit, attempt: 'primary' | 'fallback'): Promise<{ draft: string; usage: Usage[] }>;
  postGuard(env, ctx, d, draft: string): Promise<{ result: 'ok' } | { result: 'replace'; text: string }> & { guards; usage };
  meter(env, usage: Usage[], s: FinalState): Promise<void>;
  commit(env, record: CommitRecord): Promise<void>;
}
```

(Exact generics are the builder's; the shapes above are the contract between 3.1 and the later tasks.) `PreState` = input after scrub + entitlement/agent/pkg/locale/styleCard. Steps in the concurrent group get no `emit`, so event order never depends on scheduling. Errors with meaning: `TurnRejection(code, retryable)` (admit/entitle refuse), `TurnAbort(code)` (generate: e.g. `turn_cost_exceeded`, no retry), `StepNotImplementedError(step)`.

**Stubs:** `src/pipeline/steps/<step>.ts` (one file per step so 3.2–3.8 and 4.x edit separate files) each throws `StepNotImplementedError`; `steps/index.ts` exports `defaultSteps`. A stub therefore hits its failure policy, which fails closed for admit/entitle/preGuard. No stub returns success data (a succeeding `entitle` stub would be fail-open in production). Tests use `testSteps(overrides)` from `harness/testing` (happy-path doubles built on contracts fixtures).

### Order and concurrency (`src/pipeline/spec.ts`, `runner.ts`)

```
admit → entitle → scrub (step 3, phase 1)
      → [ preGuard (step 3, phase 2) ‖ route ‖ buildContext ]      (Promise.all; each wrapper never rejects)
      → escalate (only if distress) ──► skip to meter/commit
      → assemble TurnContext (TurnContextSchema.parse) → decide → generate → postGuard → done
      → meter ‖ commit (background) → TraceSink.record (background)
```

- `buildContext` runs whole inside the group (see Q2): the spec requires the retrieval part to be concurrent; running profile/history reads alongside it keeps one 300 ms budget and the ~600 ms target.
- The scrub and the preGuard checks share step 3's one 400 ms budget (deadline set when the scrub starts).
- After the group, precedence: escalate (preGuard `escalate` or route `intent === 'distress'`) beats block; then preGuard block/fail-closed; then continue. A distressed student whose message also trips moderation still gets helplines.
- `TurnContext` is parsed with `TurnContextSchema` before `decide`. If the superRefine fails (e.g. a chunk from a module not in `allowedModuleIds`), the runner applies step 6's fallback (`retrieved: []`, `lockedHit: false`, outcome `fallback`) and re-parses; if it still fails (entitlement/pkg/agent mismatch), the turn ends with `error no_access`. `decide` never sees an invalid context.

### Timeouts (`src/pipeline/timeout.ts`)

`runWithTimeout(fn, ms, clock)`: races `fn(cancel)` against `clock.sleep(ms, cancel)`; whichever settles first wins, then the cancel fires (timer dropped, step's `cancel.cancelled` true). A late result is ignored and a late rejection is caught (no unhandled rejection). Values from the spec table: admit 50, entitle 50, preGuard 400 (shared by both phases), route 400, escalate 200, buildContext 300, decide 50, generate 15 000 **per attempt**, postGuard 2 000; meter and commit have none ("async") and run in the background.

### Failure policies (`src/pipeline/policies.ts`) and trace outcomes

Outcome meaning: `ok` = the step returned (including a rejection or a block: the step did its job); `fallback` = it threw or timed out and the spec's fallback let the turn continue; `failed` = it threw or timed out and the turn ended with an error, or a background step failed.

| Step | Throw / timeout → | Outcome |
|---|---|---|
| admit | `TurnRejection` → `error {code, retryable}`; other failure → `error rate_limited, retryable: true`. No model call, no later step, no trace (Q1). | ok / failed |
| entitle | `TurnRejection` (`no_access`, `limit_reached`) → that error; other failure or invalid `Entitlement` (schema) → `error no_access` (fail closed). No model call, no trace. | ok / failed |
| preGuard (scrub or checks) | `block` → `error guard_blocked, retryable: false`; failure → `error guard_blocked, retryable: true` (fail closed; the UI shows the localised safe message). Skip to meter/commit. | ok / failed |
| route | `steps.route.onFailure` → default `on_task`/`none`; its keyword check can still return `distress`, which escalates. | fallback |
| escalate | Emits `safety {level: 'alert'}` + caring reply tokens + `done`; skips 6–9. Failure → `fallbackReplies.distress(lang, locale)` and a runner-built alert (`kind: 'distress'`, `level: 'alert'`, `excerptRedacted: ''`). `AlertSink.raise` retried on the clock with backoff 250 ms doubling, capped at 30 s, with no attempt limit ("retried until delivered"). | ok / fallback |
| buildContext | `retrieved: []`, `lockedHit: false`, `history: []`, a blank profile, `helpRung: 0` → `decide` takes the `ask_teacher` path. | fallback |
| decide | `steps.decide.fallback(ctx)`; the runner checks it returns `move: 'ask'`, else `error`. | fallback |
| generate | One retry with `attempt: 'fallback'` (if tokens were already streamed, `replace {text: ''}` first); second failure → `error provider_error, retryable: true`; `TurnAbort(code)` → `error code`, no retry. | fallback / failed |
| postGuard | `replace` result → `replace {text}`; failure → `replace {text: fallbackReplies.safeReply(lang)}` (fail closed); then `done`. | ok / fallback |
| meter | Background; never delays `done`; failure reported in `finished`. Runs whenever usage exists, including after escalate/block (see Decisions). | ok / failed |
| commit | Background; runs for every turn that passed `entitle`; failure reported in `finished`. | ok / failed |

Trace (`src/pipeline/trace.ts`): one entry per executed spec step, in spec order (not completion order); preGuard's `ms` is scrub + checks; skipped steps have no entry. `intent` = route's (or fallback); `'distress'` when escalated. `move` = the decision's move, else `'redirect'` for escalate/block turns (Q1). `guards` from scrub/preGuard/postGuard; `usage` = all step usage, including both generate attempts. The runner parses it with `TurnTraceSchema` and calls `TraceSink.record` after commit's dispatch settles (so commit's own entry is included); a record failure is reported in `finished`, never thrown into the stream.

### Streaming API (`src/pipeline/runner.ts`, `events.ts`)

```ts
export function runTurn(input: TurnInput, opts: { deps: PipelineDeps; steps: Steps }): TurnRun;
interface TurnRun {
  events: AsyncIterable<TurnEvent>;     // ends after exactly one `done` or `error`
  finished: Promise<TurnRunResult>;     // never rejects; resolves when meter, commit, trace and alert retries settle
}
interface TurnRunResult { trace: TurnTrace | null; background: { task: 'meter' | 'commit' | 'trace' | 'alert'; error: unknown }[] }
```

`events.ts` is a small push/close async queue. Each event a step emits is parsed with `TurnEventSchema`; an invalid one counts as that step failing. If the consumer stops iterating early, the turn still runs to the end so the message and trace are saved. An unexpected runner error (a bug) ends the stream with `error provider_error, retryable: true` and goes into `finished.background`; the stream never hangs. `done.messageId` is `ids.next('message')`, drawn at turn start; `done.usage` is the usage so far.

### Test helpers (`harness/testing`)

- `virtualClock()`: `now()`, `sleep(ms, cancel?)` registering a timer at `now + ms`, `advance(ms)` (fires due timers in deadline order, flushing microtasks between them), `pending`, and `drive(promise)`: keeps advancing to the next deadline until the promise settles; throws "deadlock" if it is pending with no timers left (no hangs). Microtask flushing is a bounded `await Promise.resolve()` loop; no `setTimeout`/`setImmediate`.
- `sequentialIds()`: `turn_1`, `message_1`, `alert_1`, … (valid contracts ids).
- `memoryTraceSink()`, `memoryUsageMeter()`, `memoryAlertSink({ failTimes })`, `unusedPort()` (throws if called; proves "no model call" and which ports a step touched).
- `testSteps(overrides)`: happy-path doubles using contracts fixtures and the `ScriptedGateway` for `generate`, plus a call log for order assertions.

## Files

### Create
- `packages/harness/src/pipeline/{clock,types,spec,timeout,events,trace,policies,runner,index}.ts`
- `packages/harness/src/pipeline/steps/{admit,entitle,preGuard,route,escalate,buildContext,decide,generate,postGuard,meter,commit,index}.ts` (stubs; preGuard.ts holds `scrub` and `preGuard`)
- `packages/harness/src/pipeline/{timeout,runner,concurrency,policies,trace}.test.ts`
- `packages/harness/src/testing/{virtualClock,ids,memoryPorts,testSteps}.ts`, `virtualClock.test.ts`, `ids.test.ts`
- `packages/harness/README.md` (short: pipeline order, step interface, how later tasks replace a stub)
- `docs/tasks/3.1/handoff.md` (builder), `docs/tasks/3.1/review.md` (reviewers)

### Modify
- `packages/harness/src/index.ts`: export `runTurn`, the types, `defaultSteps`, the errors, `STEP_SPEC`.
- `packages/harness/src/testing/index.ts`: add the new helpers.
- `packages/harness/src/testing/clock.ts`: `Clock` becomes `Pick<pipeline Clock, 'sleep'>` (same shape; no behaviour change).

### Out of bounds
- `packages/contracts/**`, `docs/adr/**` (no contracts change, no ADR).
- Real step logic: admit/entitle (3.2), route (3.3), buildContext (3.4), decide (3.5), prompts (3.6), generate/orchestrator/tool loop/cost ceiling (3.7), meter/commit queueing (3.8), guards and the rewrite loop (`packages/harness/src/guardrails/**`, 4.1–4.9), access filter (`packages/harness/src/access/**`, 5.4), the alert worker (`apps/worker/src/alerts/**`, 4.3).
- `content/**`, `evals/**`, `packages/gateway/**`, `.claude/**`, `.github/**`, `.githooks/**`, any `package.json`/tsconfig/lockfile.

## Tests first (Vitest, red before green, all on `virtualClock()` + `ScriptedGateway`)

1. `testing/virtualClock.test.ts`, `ids.test.ts`: timers fire in deadline order; cancel drops a timer; `drive` resolves and detects deadlock; ids are deterministic and parse as contracts ids.
2. `pipeline/timeout.test.ts`: win (timer cancelled, `pending === 0`); lose (cancel flag set, late result ignored, late rejection does not surface as unhandled).
3. `pipeline/runner.test.ts`: happy path: event sequence `token…, done`; step call order; `done` before a never-resolving `commit` settles; one trace recorded; usage summed; same scenario twice gives identical output; every event and trace schema-valid; invalid emitted event = step failure; a consumer that stops early still gets commit and trace.
4. `pipeline/concurrency.test.ts`: the three proofs in "How it is shown".
5. `pipeline/policies.test.ts`: every row of the policy table, throw and timeout each, plus: admit/entitle make no gateway call (gateway with empty script, `unusedPort` stores); TurnContext superRefine violation never reaches `decide`; escalate beats block; escalate with a failing AlertSink retries with 250/500/1000 ms sleeps until delivered; generate retry after streamed tokens emits `replace ''`; `TurnAbort('turn_cost_exceeded')` is not retried; slow meter (10 s) does not delay `done`.
6. `pipeline/trace.test.ts`: spec order under concurrency, outcomes per the table, preGuard ms = scrub + checks, `move: 'redirect'` on escalate/block turns, no text fields.

Order: clock/ids → timeout → events/trace → runner happy path → concurrency → policies one step at a time → stubs and exports.

Size: likely ~550 lines of source + ~600 of tests, above rule 9's 600-line aim. If the lead prefers, split into 3.1a (clock, timeout, runner, trace, happy path, concurrency) and 3.1b (the policy table and its tests).

## Risky paths touched

Every planned path was checked against `.claude/skills/merge-gate/risk-paths.txt`: `packages/harness/src/pipeline/**`, `packages/harness/src/testing/**`, `packages/harness/src/index.ts`, `packages/harness/README.md` and `docs/tasks/3.1/**` match no glob (only `harness/src/guardrails/**` and `harness/src/access/**` are risky under the harness). Contracts, ADRs, `.claude/.github/.githooks`, content and evals are untouched.

**None (checked against risk-paths.txt).** No `risk: high` entry is planned. Reviewers: code-reviewer, typescript-reviewer, silent-failure-hunter (background errors, swallowed late rejections). safety-reviewer is recommended but not required, because this code carries the fail-closed and escalate policies.

## Decisions (for the handoff `## Decisions`)

- **3.1 Clock and IdSource are harness types, not contracts ports** · planner · risk: low. Why: they are parameters of the harness's entry point, not adapters for db/gateway; callers already import the harness; contracts stay frozen. Alternatives: a contracts port by ADR. Reversible: yes (by ADR later).
- **3.1 No production clock/id adapters in the harness** · planner · risk: low. Why: they need real timers and DOM/Node lib types; the first caller (3.9) provides them.
- **3.1 Stubs fail closed** · planner · risk: low. Each unbuilt step throws; no stub returns success data.
- **3.1 Concurrent group steps cannot emit events** · planner · risk: low. Keeps event order deterministic.
- **3.1 Escalate beats block** · planner · risk: medium. A distressed student is never just blocked.
- **3.1 Meter still runs after escalate/block** · planner · risk: low. "Skip to step 11" would lose usage from the small-model calls in steps 3–4; § Model gateway says every call is metered.
- **3.1 Error codes where the spec names none** · planner · risk: low. admit failure → `rate_limited` retryable; preGuard → `guard_blocked`; generate → `provider_error` retryable; a runner bug → `provider_error` retryable. No `internal` code exists and contracts are frozen.
- **3.1 Generate: 15 s per attempt; `replace ''` before a retry that follows streamed tokens** · planner · risk: low.
- **3.1 Alert retry: 250 ms doubling, capped at 30 s, no attempt limit** · planner · risk: low. Literal reading of "retried until delivered"; durable delivery is 4.3's worker.
- **3.1 An invalid TurnContext is treated as a buildContext failure** · planner · risk: medium. An access-filter bug degrades to `ask_teacher` instead of reaching `decide`.

## Open questions (lead can decide; none blocks the build)

- **Q1. Trace for turns that end early.** `TurnTrace.intent` and `.move` are required, but admit/entitle rejections, preGuard blocks and escalations never run `decide`. Recommendation: no trace for admit/entitle rejections (no turn happened; rate-limit spam would flood traces); for escalate/block turns use route's intent (`distress` when escalated) and `move: 'redirect'`. No contracts change.
- **Q2. All of step 6 inside the concurrent group, or only its retrieval?** The spec names "the retrieval part of 6". Recommendation: all of it. That is a superset of the requirement, keeps one 300 ms budget, avoids a second budget after the group, and the escalate path just discards the result.
- **Q3. Fallback texts (postGuard "safe reply", escalate's caring reply when the step fails).** The harness cannot use next-intl. Recommendation: an injected `FallbackReplies` (caller supplies text from 3.11 prompt packs / 3.10 locale packs; tests use fixture strings). Where an `error` event is enough (preGuard, generate), use the code and let the UI localise it.
- **Q4 (for 3.2/3.4/4.1, not 3.1).** No contracts port loads `AgentConfig`, `PackageConfig`, `LocalePack` or `StyleCard`, yet `TurnContext` needs them and preGuard needs the locale before step 6. `Guard.check` also takes a full `TurnContext`, which does not exist at step 3. 3.1 leaves these as `entitle` outputs filled by test doubles. Recommendation: settle this before 3.2 starts, likely by an ADR adding a config-loading port that db implements (consistent with ADR-0002), plus a note for 4.1 on how pre-guards get their context.
- Note for 3.7/2.3: the gateway router already falls back on 5xx/timeout. 3.7 should make `attempt: 'fallback'` select `modelPolicy.fallback` so the turn doesn't retry twice on the same model.

## Lead answers (18 Oct 2026)

- Q1–Q3: accepted as recommended. Keep one PR (no split).
- Q4 (nothing loads agent/pkg/locale/styleCard; pre-guards lack full context): out of scope for 3.1; the lead has architect settle it before 3.2. Stub it behind the step interface and note it in the handoff.
- Before your final push: merge origin/main and regenerate the lockfile if it conflicts; re-run gates.
- Task 1.2 builds in packages/db in parallel; stay in packages/harness.

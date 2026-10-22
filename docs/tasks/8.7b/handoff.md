# 8.7b handoff: gate agent and gate input (8.7 Phase B)

Status: DONE

- Branch: `m8/8.7b-gate-agent` (pushed from local `work-87b`)
- Worktree: `.claude/worktrees/agent-a6d3905dbb19bba2e`
- Plan: `docs/tasks/8.7/plan.md` (Phase B)

## Summary
`apps/worker/src/gate/` holds the gate's `EvalAgent` and the code that builds a `GateInput`. There is no queue yet (Phase C).
- The agent runs the real turn pipeline (`runTurn` + `defaultSteps`), pinned to the candidate agent version and one candidate package version.
- Reads are limited to retrieval, the db `eval` entitlement, and a gate-only `TurnConfigStore` that reads `agentVersions`, `packageVersions` and `styleCards`.
- Every write port is in memory or a counted no-op: alerts, safety events, teacher questions, traces, transcripts, help state and profiles. Tests use a repositories Proxy that throws on any repository outside the read set, which proves nothing durable is written.
- `buildGateInput` turns a basis into a `GateInput` for `runQualityGate`. If it can't, it throws `GateUnavailableError` (`code: 'gate_unavailable'`) with a reason.
- `gateModelsFromEnv` fails closed. These all return `unavailable`, so the gate can never pass by default:
  - `EDMATE_DEV_MODEL` is set (any non-blank value)
  - `EDMATE_JUDGE_MODEL` is missing or malformed
  - the judge's provider isn't Anthropic
  - `EDMATE_ANTHROPIC_API_KEY` is missing
- Keys come only from env, through `loadProviderKeys`/`envKeySource`.

## Exported names and signatures (for Phase C; all from `apps/worker/src/gate/index.ts`)
```ts
// agent.ts
interface GateAgentDeps { repos: Repositories; retrieval: RetrievalIndex;
  locales(market: string): LocalePack | null; market: string; packMarket(market: string): string;
  promptPacks: PromptPackLibrary; personas?: PersonaLibrary; gatewayFor: PipelineDeps['gatewayFor'];
  priceUsage: PriceUsage; usage: GateUsageMeter; effects: GateSideEffects; clock?: Clock; ids?: IdSource }
function createGateAgent(deps: GateAgentDeps, basis: GateBasis, pkg: PackageConfig): EvalAgent
function gateAgentFactory(deps: GateAgentDeps, basis: GateBasis): (pkg: PackageConfig) => EvalAgent
function collectReply(events: AsyncIterable<TurnEvent>): Promise<EvalAgentReply>
function gateFallbackReplies(): FallbackReplies
function isGuardDetection(error: unknown): boolean
// configStore.ts
interface GateTurnConfigOptions { repos: Pick<Repositories, 'agentVersions'|'packageVersions'|'styleCards'>;
  basis: GateBasis; locales(market: string): LocalePack | null; helpState(sessionId: string): unknown }
function gateTurnConfigStore(opts: GateTurnConfigOptions): TurnConfigStore
// input.ts
interface GateBasis { teacherId: string; agentId: string; agentVersion: number;
  packageVersions: readonly { packageId: string; version: number }[] }
type GateUnavailableReason = 'no_packages'|'package_missing'|'suites_missing'|'no_platform_cases'
  |'content_missing'|'dev_model'|'provider_key'|'judge_model'|'judge_provider'
class GateUnavailableError extends Error { readonly code = 'gate_unavailable'; readonly reason: GateUnavailableReason }
interface BuildGateInputOptions { repos: Pick<Repositories, 'packageVersions'|'teacherEvalCases'>; basis: GateBasis;
  changes: <GateInput['changes']>; suitesDir: string; agentFor(pkg: PackageConfig): EvalAgent;
  judgeGateway: ModelGateway; judgeModel: string; concurrency?: number; styleSampleSeed?: string; now?: () => number }
function buildGateInput(opts: BuildGateInputOptions): Promise<GateInput>
function packageForLabel(packages: readonly PackageConfig[], label: string): PackageConfig | undefined
// models.ts
type Env = Readonly<Record<string, string | undefined>>
interface GateModels { factories: ProviderAdapterFactories; judge: JudgeModelConfig; prices: PriceTable }
type GateModelsResult = { ok: true; models: GateModels } | { ok: false; reason: GateUnavailableReason }
function gateModelsFromEnv(env: Env): Promise<GateModelsResult>
function gateGatewayFor(models: GateModels, meter: GateUsageMeter): (spec: TurnGatewaySpec) => TurnGateway
function gatePriceUsage(models: GateModels): PriceUsage
function gateJudgeGateway(models: GateModels, meter: GateUsageMeter, ctx: { teacherId: string; packageId: string }): ModelGateway
// ports.ts
interface GateSideEffects { alerts; safetyEvents; teacherQuestions; traces; backgroundFailures: number }
function gateSideEffects(): GateSideEffects
interface GateUsageTotals { calls: number; costMicroUsd: number; unmetered: number; unmeteredReasons: string[] }
interface GateUsageMeter { record(u: Usage, ctx?: unknown): Promise<void>;
  recordUnmetered(u: UnmeteredUsage): Promise<void>; totals(): GateUsageTotals } // fits UsageMeter and MeterSink
function gateUsageMeter(): GateUsageMeter
function gateCasePorts(effects: GateSideEffects): GateCasePorts
function systemClock(): Clock
function systemIds(): IdSource
```
How Phase C wires it:
1. Call `gateModelsFromEnv(process.env)`. On `ok: false`, the run ends `error` with that reason.
2. Create one `gateUsageMeter()` and one `gateSideEffects()` per run.
3. Build the agent deps with `gatewayFor: gateGatewayFor(models, meter)` and `priceUsage: gatePriceUsage(models)`.
4. Call `buildGateInput` with `agentFor: gateAgentFactory(deps, basis)`, `judgeGateway: gateJudgeGateway(models, meter, …)` and `judgeModel: models.judge.model`.
5. Call `runQualityGate`, then read `meter.totals()` and `effects`.

## Files
- `apps/worker/package.json`: adds `@edmate/evals` and `@edmate/content`, and moves `@edmate/contracts` and `@edmate/harness` to `dependencies`. `pnpm-lock.yaml` is updated to match.
- `apps/worker/src/gate/agent.ts`: the gate agent.
- `apps/worker/src/gate/configStore.ts`: the gate-only `TurnConfigStore`.
- `apps/worker/src/gate/input.ts`: builds the `GateInput`.
- `apps/worker/src/gate/models.ts`: models from env, gateways and the judge.
- `apps/worker/src/gate/ports.ts`: the no-op and in-memory ports, and the usage meter.
- `apps/worker/src/gate/index.ts`: re-exports the above.
- `apps/worker/src/gate/testkit.ts`: test-only fakes. `fakeRepos` is a Proxy that throws on any repository outside the read set.
- Tests: `agent.test.ts`, `configStore.test.ts`, `input.test.ts`, `models.test.ts`, `ports.test.ts`.

## Tests (acceptance evidence)
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...
 Tasks:    11 successful, 11 total
@edmate/worker:test: Tests 212 passed | 19 skipped (231)
  agent.ts 98.41 / 89.74 br | configStore.ts 100 | input.ts 97.91 / 92.85 br | models.ts 100 | ports.ts 100
python3 .githooks/secret-scan.py --all   -> clean (no findings)
```
- `agent.test.ts` runs the real pipeline over a scripted gateway; no real model is called. It checks:
  - a pinned package gets an answer, retrieval is scoped to that package's modules, and usage totals are summed;
  - a locked-module question gets the locked reply, which names the package;
  - a jailbreak is blocked: `safetyEvents` counts 1 and no repository is reached;
  - distress escalates: `alerts` counts 1 and no `safetyEvents`/`teacherQuestions` repository is reached;
  - prior turns are seeded into the in-memory transcript;
  - an unpinned package, version or agent is refused;
  - an error turn fails the case with its code;
  - a background failure fails the case;
  - unit tests for `collectReply` and `isGuardDetection`.
- `input.test.ts` checks:
  - the basis is mapped to a `GateInput`, including free/paid label mapping and teacher cases;
  - a missing suites dir gives `suites_missing`;
  - zero platform cases gives `no_platform_cases`;
  - `listForTeacher` over the cap propagates its error.
- `configStore.test.ts` checks that exactly the candidate agent version, package version and style card are loaded, and that another teacher's or agent's ids return null.
- `models.test.ts` checks the env fail-closed cases, the B-42 tier routing, that unpriced usage is counted as unmetered (never $0), and the judge.

## Decisions
1. Platform cases are labelled `package: free|paid`. A label first matches a package id exactly. Otherwise `free`/`paid` picks the widest candidate package of that price tier (price 0 = free), with ties broken by id. A label no package fits gets an agent that rejects, so those cases fail and are never skipped.
2. `outOfCourse` is `[]` for now. Phase B has no content loading; Phase C or 8.7 content work fills it.
3. Any non-blank `EDMATE_DEV_MODEL` makes the gate unavailable, not only `scripted`. The scripted dev model answers every classifier "all clear", so a gate over it would pass by default.
4. The judge must be Anthropic (`judge_provider` otherwise). The judge model comes only from `EDMATE_JUDGE_MODEL`, as the decision log's eval-judge entry requires (pinned per release, no default). Judge calls are metered into the same run meter as `eval` usage.
5. Unpriced or unknown usage is counted as `unmetered` with its reason, never as free.
6. A turn that ends in an `error` event (other than `guard_blocked`), or that has any background failure, fails its case. The one exception is `LockedLeakDetected`: the locked-stream guard withheld text and replaced the reply, and that reply is what the case scores. Every background report is still counted in `effects.backgroundFailures`.
7. The gate fixture agent is English-only (`languages: ['en']`), as the English-only pilot requires. Otherwise `PilotLanguageClamped` is reported in the background, and under decision 6 that fails the case. Agents with other languages will fail gate cases this way until that policy changes.
8. `GateBasis` is a local type until Phase A's contract or db shape lands. Phase C should switch to it.
9. `gateFallbackReplies` and `collectReply` copy the web and CLI versions. A shared composition module is an M13 follow-up (plan scope 10).
10. `@edmate/contracts` and `@edmate/harness` moved from devDependencies to dependencies, because worker runtime code now imports them.
11. The gate's `TurnConfigStore` is its own: the production `turnConfigStoreFor` needs session rows, and the gate writes none.

## Left to do (Phase C and follow-ups)
- Queue and processor; persisting run results; reading Phase A's basis.
- Content loading for `outOfCourse`, plus the `content_missing` reason (declared but unused for now).
- Docker: the worker image needs `evals/suites` copied in, for `suitesDir`.
- An OpenAI-compatible judge is not supported (`judge_provider`).
- The gateway's `MODEL_MIX.paid` names Haiku as `claude-haiku-4-5`, but the brief says `claude-haiku-4-5-20251001`. Not changed, because `packages/**` is out of bounds. The lead should decide whether the gateway id needs the date suffix.
- `fakeRepos` only lets the gate's read set through. If Phase C adds reads, it must widen `GATE_READ_REPOS`.

Tool calls used: 115

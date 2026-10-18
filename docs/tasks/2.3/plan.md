# Task 2.3: Router: tiers, per-agent override, fallback

Board: `python3 .claude/skills/board/board.py show 2.3` · Milestone M2 · deps: 2.2, M0 · branch `m2/2.3-router` · risk: none found.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Router: tiers, per-agent override, fallback"
Accept: "a simulated 5xx fails over within one retry."

Spec it must honour:
- Build plan § Model access: `ModelPolicy { tiers: Record<'small'|'main', {provider,model}>; fallback?: {provider,model} }`; `ModelGateway { stream, generateObject, embed }`.
- Build plan § Model gateway (prose): "**Routing:** `small` and `main` tiers; per-agent override; fallback model on 5xx, timeout or rate limit; models that fail the safety, leak or locked suites cannot be selected." The last clause is an eval-time constraint on which models may go *into* a `ModelPolicy` (M7's job); it is not something the router checks per call, and is out of bounds here (see below).
- Turn pipeline spec, step 8 `generate`: "Stream from main model... abort if `MAX_TURN_COST_MICRO_USD` is exceeded | main | 15 s | **One retry on the fallback model; then apologetic error**." One retry, not a retry loop — matches the accept line.
- Decision log, 18 Oct 2026, "2.2 Output that stops early is a failure": `stream()` yields whatever it already streamed and the usage, then throws a non-retryable `GatewayError` with `reason: 'truncated'|'content_filter'`. The router must never fall back on these — they are not retryable, and output was already on its way to the caller either way.
- Decision log, 18 Oct 2026, "2.2 No SDK retries; errors mapped to fixed codes": "retry and fallback are the router's job (2.3)"; `GatewayError` carries `code`, `retryable`, `provider`, `message`, optional `reason`.
- Decision log, 18 Oct 2026, "2.2 Capabilities live beside the port, not inside it": `AdapterCapabilities`/`ModelAdapter` are gateway-only types, not contracts; this task's capability checks stay the same way (no contracts change).
- Decision log, 18 Oct 2026, "2.6 Scripted provider errors and usage record": `gatewayFixtures.ts`'s `scriptedStreamProviderError` is explicitly captioned "for 2.3's 'a simulated 5xx fails over within one retry'" — but its steps are `[text, error]` (text yielded *before* the error). That shape is the fixture for the "never fall back once something was already streamed" case, not the fail-over-succeeds case (see Design).
- Rule 3 (harness purity) does not apply here: this task is entirely in `packages/gateway`, which has no import restriction.
- Rule 4: no real model calls in tests.

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Tier selection | A `ModelRequest` with `tier: 'small'` is sent to the adapter configured for `'small'`; `tier: 'main'` to `'main'`'s adapter. Two `Router`s built from two different `ModelPolicy`s route the same tier to different adapters (per-agent override). |
| Fails over within one retry | Primary adapter's `stream()` throws a retryable `GatewayError` (e.g. mapped from a 5xx) **before yielding any chunk**; the router's single fallback attempt on the configured fallback adapter succeeds; the caller sees only the fallback's chunks. Exactly one fallback call is made (asserted via a call counter), never a loop. Same for `generateObject`/`embed`. |
| No fallback once streamed | Primary adapter's `stream()` yields a `text` chunk, then throws a *retryable* `GatewayError`; the router re-throws without calling the fallback adapter at all (asserted: fallback adapter's `stream` was never invoked). Reuses `scriptedStreamProviderError` (text then error) wrapped as a fake adapter, per its doc comment. |
| No fallback on non-retryable | Primary throws `GatewayError('provider_error', false, ..., reason: 'truncated')` (and separately `reason: 'content_filter'`); router re-throws as-is; fallback never called, even with zero chunks yielded. |
| No fallback configured | `ModelPolicy` with no `fallback`: a retryable primary failure propagates unchanged; no fallback lookup attempted. |
| Capability pre-check | A request with `tools` set routed to an adapter whose `capabilities.tools === false` throws a `validation` `GatewayError` naming the capability and the adapter, **without calling the adapter**. Same for `generateObject` and `capabilities.json`, `embed` and `capabilities.embeddings`. |
| Per-agent override via policy | `createRouter(policyA, factories)` and `createRouter(policyB, factories)` (same factories, different `ModelPolicy`) produce routers that pick different concrete adapters for the same tier — the override is just "a different `ModelPolicy`", nothing merged inside `Router`. |
| Default policy is config, not code | `grep -rn "claude-\|gpt-" packages/gateway/src/router/router.ts packages/gateway/src/router/factory.ts` — no matches; the only model-id strings in `packages/gateway/src/router/**` live in `default-policy.ts`, clearly marked provisional. |
| Coverage | `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...` green; coverage at the package's existing threshold or better. |

## Design

### What exists already (2.1, 2.2, 2.6 — nothing here changes it)
- `ModelGateway` (contracts `ports.ts`): `stream(req): AsyncIterable<ModelChunk>`, `generateObject<T>(req, schema): Promise<T>`, `embed(texts): Promise<number[][]>`. **No agent id, no provider/model field** — a `ModelGateway` instance already "knows" what it talks to.
- `ModelPolicy` (contracts `model.ts`): `{ tiers: Record<'small'|'main', {provider: string; model: string}>; fallback?: {provider; model} }`. **One shared `fallback` target, not per-tier.**
- `AgentConfig.modelPolicy: ModelPolicy` (contracts `teacher.ts`) is **required**, not optional. Every agent already carries a fully-resolved policy — there is no separate "override" field to merge. "Per-agent override" (build-plan prose) means exactly this: two agents' `AgentConfig.modelPolicy` can differ, so the thing built *from* each one (a `Router`, wired to that policy's concrete adapters) differs too. No merge-with-default logic belongs inside `Router` itself.
- `ModelAdapter` (gateway `adapters/types.ts`): `ModelGateway & { id: ProviderId; model: string; capabilities: AdapterCapabilities }`. `AdapterCapabilities = { tools, streaming, json, vision, embeddings, maxContextTokens }`.
- `GatewayError` (gateway `adapters/errors.ts`): `{ code, retryable, provider, message, reason? }`. `reason` (`'truncated'|'content_filter'`) is only ever set with `retryable: false` (confirmed by reading `errors.ts`/`sdk-adapter.ts`: `stopFailure` always constructs with `false`). **So the router's whole fallback rule collapses to one check: `err instanceof GatewayError && err.retryable`.**
- `createAnthropicAdapter`/`createOpenAICompatibleAdapter` (gateway `adapters/*.ts`) both already say in a doc comment: "the model id, chosen by the router from ModelPolicy (task 2.3)" — confirms adapters are built once per `{provider, model}`, and the router's job is to pick *which already-built adapter* serves a given tier, not to construct adapters per call.
- `@edmate/harness/testing` (2.6) exports `ScriptedGateway` (implements `ModelGateway`) and `scriptedStreamProviderError` (`[text, {type:'error', code:'provider_error'}]`), with `gatewayFixtures.ts`'s own comment naming this task as a consumer. `ScriptedGateway` throws `ScriptedProviderError` (harness-local: `{code, message}`, no `retryable`) — **not** a `GatewayError**, because `harness` cannot import `@edmate/gateway` (purity rule). The router's tests therefore need a thin translation at the fake-adapter boundary (see Tests).

### `Router` (`packages/gateway/src/router/router.ts`)

```ts
export interface RouterOptions {
  readonly tiers: Record<ModelRequest['tier'], ModelAdapter>;
  readonly fallback?: ModelAdapter;
}

export class Router implements ModelGateway {
  constructor(private readonly opts: RouterOptions) {}
  stream(req: ModelRequest): AsyncIterable<ModelChunk> { ... }
  generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T> { ... }
  embed(texts: string[]): Promise<number[][]> { ... }
}
```

`Router` never hard-codes a model id or provider id; it only ever reads `opts.tiers`/`opts.fallback`, which a caller supplies already built. This is what makes "no hard-coded model ids beyond a default config file" true of `router.ts` itself.

**Capability pre-check** (before any adapter call, same for primary and — if tried — fallback):
- `stream`/`generateObject`: if `req.tools` is present and non-empty, the target adapter's `capabilities.tools` must be `true`.
- `generateObject` additionally requires `capabilities.json`.
- `embed` requires `capabilities.embeddings`.
- A failed check throws `new GatewayError('validation', false, adapter.id, "<adapter.id>/<adapter.model>: no <capability> support for this request")` immediately — no provider call, no fallback attempt (a capability mismatch is a configuration problem the policy author must fix, not a transient failure fallback exists for).
- **Vision is a documented no-op for now.** `ModelRequest` has no field that signals "this request needs vision" (attachments don't flow into `ModelRequest` yet — confirmed by reading `contracts/model.ts`), so there is nothing to check against `capabilities.vision` today. The check function takes a `vision: boolean` flag for forward compatibility but every call site in this task passes `false`. Flagged as **Open question Q1** below; not a blocker.

**`stream()` fallback rule — the core of this task:**
1. Call `tiers[req.tier].stream(req)` (after its capability check) and iterate it, re-yielding each `ModelChunk` to the caller, tracking `yieldedAny = true` the moment the first chunk is yielded.
2. If the underlying iterator throws:
   - If the error is **not** a `GatewayError`, or `retryable === false`, or `yieldedAny === true`, or `opts.fallback` is undefined, or `opts.fallback` fails its own capability check: **re-throw as-is**. (Four independent reasons collapse to the same action — "give up, don't guess" — so they share one branch, not four.)
   - Otherwise (retryable, nothing yielded yet, a fallback adapter is configured and capable): call `opts.fallback.stream(req)` **once**, and iterate *that* instead, re-yielding its chunks. Any error from the fallback attempt (retryable or not) is re-thrown as-is — there is only one fallback target, so there is nothing left to fall back to.
3. This is exactly "one retry on the fallback model" (pipeline spec, step 8) and exactly why `scriptedStreamProviderError`'s `[text, error]` shape matters: once `text` was yielded, step 2's `yieldedAny` guard fires and the router must not silently splice a second model's output onto a reply the caller (and, downstream, the student) already started receiving.

**`generateObject()`/`embed()` fallback rule:** no streaming, so there is no "already sent to the caller" concern — nothing is returned until the `Promise` resolves. Rule: call the tier adapter; on a retryable `GatewayError` (and a capable, configured fallback), call the fallback once; any other error (non-retryable, no fallback, or the fallback's own failure) propagates.

### `createRouter` (`packages/gateway/src/router/factory.ts`)

Resolves a `ModelPolicy` into a `Router`, given already-constructed per-provider adapter factories (so this file, not `router.ts`, is the only place that turns `{provider, model}` strings into a real `ModelAdapter`):

```ts
export type AdapterFactory = (model: string) => ModelAdapter;
export type ProviderAdapterFactories = Partial<Record<ProviderId, AdapterFactory>>;

export function createRouter(policy: ModelPolicy, factories: ProviderAdapterFactories): Router
```

- For each of `policy.tiers.small`, `policy.tiers.main`, and `policy.fallback` (if present), looks up `factories[target.provider]`; if missing, throws a plain, descriptive `Error` **at construction time** ("createRouter: no adapter factory for provider '<id>' (tier '<tier>')") — a config problem, fixed before any call, in the same fail-fast spirit as `keys/load.ts` (2.1).
- Caches adapters by `` `${provider}:${model}` `` so a policy where `fallback` repeats a tier's target (or `small`/`main` share a target) builds one adapter instance, not two.
- This is the one function 2.3 expects a later composition root (not built yet — no `apps/*` wiring exists for the pipeline) to call with real factories (`(model) => createAnthropicAdapter(keys, { model })`, etc.) and a resolved `AgentConfig.modelPolicy`. Building that composition root is **out of bounds** here (no task owns it yet; flagged as Open question Q2).

### `DEFAULT_MODEL_POLICY` (`packages/gateway/src/router/default-policy.ts`)

A single `ModelPolicy` constant, clearly commented as **provisional**: the decision log already lists "Default model mix: decide after 7.6" as an open item (build plan § table, row "Default model mix"). This task does not decide that; it only gives every other task (1.8's demo agent, 3.1's/3.7's pipeline tests, any seed data) one place to import a working default from instead of inventing model-id strings per call site — satisfying "no hard-coded model ids beyond a default config file" without pre-empting 7.6. Values: Anthropic for both tiers (main provider, decision log 18 Oct 2026), no `fallback` set by default (a deployment that wants one sets it explicitly). Flagged as **Open question Q3** — see below; not a blocker, reversible, and 7.6 is expected to replace it regardless.

### Files

**Create**
- `packages/gateway/src/router/router.ts` — `Router`, `RouterOptions`, the capability-check helper.
- `packages/gateway/src/router/factory.ts` — `createRouter`, `AdapterFactory`, `ProviderAdapterFactories`.
- `packages/gateway/src/router/default-policy.ts` — `DEFAULT_MODEL_POLICY`.
- `packages/gateway/src/router/index.ts` — barrel for the three files above.
- `packages/gateway/test/router/router.test.ts`, `packages/gateway/test/router/factory.test.ts`.
- `docs/tasks/2.3/handoff.md` (builder), `docs/tasks/2.3/review.md` (reviewers).

**Modify**
- `packages/gateway/src/index.ts`: add `export * from './router/index.js';`.
- `packages/gateway/package.json`: add `@edmate/harness: workspace:*` as a **devDependency only** (test-only reuse of `ScriptedGateway`/`scriptedStreamProviderError`; see Decisions). No runtime dependency changes.

**Out of bounds**
- `packages/contracts/**` — `ModelPolicy`, `ModelRequest`, `ModelGateway`, `AgentConfig.modelPolicy` already exist and already say everything this task needs; no contract change, no ADR.
- `packages/gateway/src/keys/**`, `packages/gateway/src/adapters/**` — untouched; 2.2's adapters and 2.1's keys are consumed as-is.
- Metering (`UsageMeter`, `usage_ledger` rows) — task 2.4. The router passes `usage` chunks/returns through unchanged; it does not record them.
- Caps (rolling message limit, cost alarm) — task 2.5.
- "Models that fail the safety/leak/locked suites cannot be selected" — an eval-time constraint on *building* a `ModelPolicy` (M7), not a per-call check; out of bounds.
- Any `apps/**` composition root that calls `createRouter` with real keys/factories at startup — no such wiring task exists yet (Open question Q2).
- Vision-aware routing (no signal in `ModelRequest` to route on — Open question Q1).
- `.claude/**`, `.github/**`, `.githooks/**`, `docs/adr/**`.

## Tests first (Vitest, TDD — red before green)

All tests use fake `ModelAdapter`s (plain objects satisfying the interface, built in-test) or `ScriptedGateway` wrapped as a fake adapter — never a real provider call (rule 4).

**Test-adapter helper** (local to `packages/gateway/test/router/`, not exported): wraps a `ScriptedGateway` so its `stream()` matches `ModelAdapter`, translating `ScriptedProviderError` into a `GatewayError` with a `retryable` flag the test chooses (mirrors what `mapProviderError` does for a real provider at the adapter boundary — the only place such a translation can live, since `harness` cannot know about `GatewayError`). Takes `{ id, model, capabilities, retryableOnError }`.

1. **`factory.test.ts`**
   - `createRouter` with a policy using two different providers routes `tiers.small`/`tiers.main` to the matching factory's adapter.
   - A policy whose `fallback` repeats `tiers.main`'s `{provider, model}` results in one adapter instance being reused (factory called once for that pair, asserted by a call counter), not two.
   - A policy naming a provider with no matching factory throws synchronously, naming the provider id and the tier.
   - A policy with no `fallback` builds a `Router` with `opts.fallback === undefined`.
2. **`router.test.ts`**
   - **Tier selection:** `stream({tier:'small', ...})` calls the `'small'` adapter, never `'main'`'s.
   - **Per-agent override:** two `Router`s built from policies that map `'main'` to different adapters route the same `tier:'main'` request to each one's own adapter.
   - **Fails over within one retry (the accept line):** primary adapter's fake `stream` throws a retryable `GatewayError` with zero chunks yielded; `Router.stream` yields the fallback adapter's chunks instead; fallback adapter's call counter is exactly 1; primary's is exactly 1.
   - **Never falls back after streaming started:** primary's fake `stream`, built from `scriptedStreamProviderError` (`[text, error]`) with `retryableOnError: true`, yields `'Partial'` then the router's `for await` throws; fallback adapter's call counter is 0.
   - **Never falls back on a non-retryable error:** primary throws `GatewayError(..., false, ..., reason: 'truncated')` with zero chunks yielded; router re-throws immediately; fallback never called. Repeat for `reason: 'content_filter'`.
   - **No fallback configured:** `Router` built with `fallback: undefined`; a retryable primary failure propagates; no fallback lookup attempted (nothing to assert a call count on, but no throw from the router's own code either).
   - **Fallback itself fails:** primary retryable + nothing yielded → fallback called once → fallback also throws → router re-throws the fallback's error (not the primary's), and makes no third attempt.
   - **`generateObject` fallback:** same retryable/non-retryable/no-fallback matrix, without the "already streamed" case (nothing streams).
   - **`embed` fallback:** same matrix.
   - **Capability pre-check, tools:** a request with a non-empty `tools` array routed to an adapter with `capabilities.tools: false` throws `validation` before the adapter's `stream` is ever called (counter stays 0); a request with `tools: undefined` or `[]` is unaffected.
   - **Capability pre-check, json:** `generateObject` against an adapter with `capabilities.json: false` throws `validation` without calling it.
   - **Capability pre-check, embeddings:** `embed` against an adapter with `capabilities.embeddings: false` throws `validation` without calling it.
   - **Determinism:** the same policy/fixtures run twice produce the same chunk sequence (mirrors 2.6's own determinism test, cheap to add here too).

Implementation order: `factory.ts` (and its test) first, since `router.ts`'s tests need adapters to route between; then `router.ts`'s tier-selection and capability checks (no fallback yet); then the fallback matrix; then `generateObject`/`embed`; then `default-policy.ts` last (it has no logic to test beyond "parses as a valid `ModelPolicy`", one assertion).

Commands: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...`.

## Risky paths touched

Checked every planned path (including the new `router/` folder and the `package.json` edit) against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/gateway/src/router/**`, `packages/gateway/test/router/**`, `packages/gateway/src/index.ts` — not listed (only `packages/gateway/src/keys/**` is risky under `gateway`, for `security-reviewer`).
- `packages/gateway/src/keys/**` — **untouched**, as expected (confirms the task prompt's assumption).
- `packages/contracts/**`, `docs/adr/**` — untouched.
- `.claude/**`, `.github/**`, `.githooks/**` — untouched.
- `packages/harness/src/guardrails/**`, `packages/harness/src/access/**`, `content/**`, `evals/suites/safety/**`, `evals/suites/locked/**`, `apps/worker/src/alerts/**`, `packages/payments/**`, `apps/web/app/api/webhooks/**`, `apps/web/src/auth/**`, `packages/db/src/repositories/**` — untouched.

**None (checked against risk-paths.txt).** No `risk: high` decision entry is planned.

## Decisions (to copy into the handoff `## Decisions`)

### 2.3 Fallback rule collapses to one check · decided by planner · risk: low
Decided: the router falls back only when the error is a `GatewayError` with `retryable: true`, nothing has been yielded yet for this `stream()` call, and a capable fallback adapter is configured. All other cases (non-`GatewayError`, `retryable: false`, already streamed, no fallback, fallback not capable) re-throw as-is.
Why: `reason` (`truncated`/`content_filter`) is only ever paired with `retryable: false` in `gateway/adapters/errors.ts`, so the "never fall back on a cut-off or filtered answer" rule (decision log, 2.2) is already covered by checking `retryable`; a separate `reason` check would be redundant.
Alternatives: check `reason` explicitly as a second, belt-and-suspenders condition.
Reversible: yes.

### 2.3 Router takes already-built adapters; a separate factory resolves `ModelPolicy` · decided by planner · risk: low
Decided: `Router` never sees a `{provider, model}` string — only `ModelAdapter` instances, supplied via `RouterOptions`. A separate `createRouter(policy, factories)` in `factory.ts` is the only place that turns policy strings into adapters.
Why: keeps `Router`'s own fallback/capability logic testable with plain fake adapters and free of any provider-construction concerns (keys, base URLs); matches the adapters' own doc comments ("the model id, chosen by the router from ModelPolicy").
Alternatives: one class that both resolves the policy and does the routing.
Reversible: yes.

### 2.3 Capability mismatch fails closed, never silently reroutes to fallback · decided by planner · risk: low
Decided: if the tier's adapter lacks a capability the request needs, the router throws a `validation` `GatewayError` immediately; it does not check whether the fallback adapter could have served the request instead.
Why: a capability mismatch is a configuration bug (the `ModelPolicy` author picked an adapter that can't do what the agent needs), not a transient failure; routing around it silently would hide the bug and pick a model nobody chose for that tier.
Alternatives: if the tier's adapter fails the capability check, try the fallback adapter's capabilities before giving up.
Reversible: yes.

### 2.3 Router tests reuse `@edmate/harness/testing`'s `ScriptedGateway`, via a devDependency · decided by planner · risk: low
Decided: `packages/gateway/package.json` gains `@edmate/harness: workspace:*` as a **devDependency** so the router's tests can wrap `ScriptedGateway` (and reuse `scriptedStreamProviderError`) as a fake `ModelAdapter`'s transport, rather than re-implementing a script player in `packages/gateway/test`.
Why: `gatewayFixtures.ts`'s own comment names this task as the consumer of `scriptedStreamProviderError`, and the 2.6 decision log says the scripted gateway's single-error-point design exists so "callers such as the 2.3 router only need to handle errors in one place". No purity rule is crossed: rule 3 restricts what `packages/harness` may import, not who may import `@edmate/harness/testing` as a test tool; `gateway` is not the harness.
Alternatives: duplicate a small script player directly in `packages/gateway/test`.
Reversible: yes — the devDependency can be dropped if a later reviewer prefers the duplication.

## Open questions (lead can decide; none blocks the build)

- **Q1. Should the capability check cover vision now, given `ModelRequest` has no field that signals a vision need?** Recommendation: ship the check function with a `vision` parameter for forward compatibility, but every call site passes `false` today (a documented no-op) rather than inventing a signal that doesn't exist in the contract. Revisit when attachments flow into `ModelRequest` (not scheduled yet).
- **Q2. Who builds the composition root that calls `createRouter` with real keys and `AgentConfig.modelPolicy` at runtime?** No task currently owns "wire a per-agent `Router` into the turn pipeline's `generate` step". Recommendation: leave it for whichever task actually calls `ModelGateway` from the pipeline (3.1's runner or 3.7's orchestrator) to construct a `Router` via `createRouter`, since that is the first point an `AgentConfig` is actually in hand; 2.3 only has to make `createRouter` ready for that.
- **Q3. Is `DEFAULT_MODEL_POLICY`'s choice of "Anthropic for both tiers, no fallback" an acceptable provisional default, given the decision log lists "Default model mix" as "decide after 7.6"?** Recommendation: yes, with the file clearly commented as provisional and expected to be replaced; it unblocks 1.8 (demo course) and any pipeline tests that need a real-looking `ModelPolicy` before 7.6's cost/eval analysis exists, and is one line to change later. If the lead would rather this default not name any real provider/model at all until 7.6, the alternative is a visibly-synthetic placeholder (e.g. `provider: 'unconfigured'`) that forces every caller to override it explicitly — flagging this up rather than guessing, since 7.6 is an explicitly deferred decision in the spec.

## Lead answers (18 Oct 2026)

- Q1–Q3: accepted as recommended (vision check a documented no-op; wiring left to 3.7; DEFAULT_MODEL_POLICY clearly marked provisional until 7.6).
- Before your final push: merge origin/main, regenerate the lockfile if it conflicts, re-run gates. Task 3.12 builds in packages/evals in parallel; don't touch it.

# 2.3 handoff: Router: tiers, per-agent override, fallback

Status: DONE
Branch: `m2/2.3-router`
Worktree: `.claude/worktrees/agent-abff0c7af01736451`
Risky: no. Every touched path checked against `.claude/skills/merge-gate/risk-paths.txt`; `src/keys/**` untouched.

## Acceptance evidence

Acceptance: "a simulated 5xx fails over within one retry."

| Item | Evidence |
|---|---|
| Tier selection | `router.test.ts` "sends tier small to the small adapter and main to the main adapter": the `small` request is served by the small adapter and the main adapter's `stream` counter stays 0, then the reverse. |
| Fails over within one retry | "a simulated 5xx before any chunk fails over within one retry": primary throws `GatewayError('provider_error', true, ..., '(HTTP 503)')` before any chunk; the caller sees only `[text('from backup')]`; primary and fallback `stream` counters are both exactly 1. Same for `generateObject` and `embed` ("a retryable failure fails over within one retry"). "when the fallback also fails": the fallback's error propagates, counters 1/1, no third attempt. |
| No fallback once streamed | "never falls back once a chunk reached the caller, even on a retryable error": primary built from `scriptedStreamProviderError` (`[text, error]`) mapped to a retryable `GatewayError`; caller sees `[text('Partial')]` then the retryable error; fallback `stream` counter 0. Also covered for a `truncated` error after partial output. |
| No fallback on non-retryable | `it.each(['truncated','content_filter'])` for `stream` (zero chunks yielded) and `generateObject`: error re-thrown as the same object; fallback never called. Also a plain `Error` (not a `GatewayError`) is never retried. |
| No fallback configured | `Router` without `fallback`: retryable primary failure propagates as the same object (`stream`, `generateObject`, `embed`, and via `createRouter` without `policy.fallback`). |
| Capability pre-check | `tools` (non-empty) on an adapter without tools: `stream` throws `validation` synchronously, message `anthropic/no-tools: no tools support for this request`, adapter and fallback counters 0; `tools: undefined` and `[]` unaffected. `generateObject` without `json` and `embed` without `embeddings` reject with `validation` without calling the adapter. A fallback that lacks the capability is skipped and the primary error re-thrown. Vision: `missingCapability` reports it; every call site passes `vision: false` (lead answer Q1). |
| Per-agent override via policy | `factory.test.ts` "per-agent override: same factories, different policies, different adapters": `createRouter(policyA, factories)` and `createRouter(policyB, factories)` serve the `main` tier from `anthropic:a` and `openai-compatible:b`. Also `router.test.ts` with two `Router`s. |
| Default policy is config, not code | `grep -rn "claude-\|gpt-" packages/gateway/src/router/router.ts packages/gateway/src/router/factory.ts` → no output (exit 1). `grep -rln` over `src/router` → only `default-policy.ts`, which is headed PROVISIONAL until 7.6. |
| Coverage | `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...` → `Tasks: 14 successful, 14 total`; gateway `Tests 215 passed (215)` (44 new in `test/router/`); coverage All files 100/100/100/100. New threshold `src/router/**` = 100%. |

Root gates:
- `corepack pnpm turbo run typecheck lint test` → `Tasks: 32 successful, 32 total`.
- `corepack pnpm format:check`: only `.github/workflows/ci.yml` flagged, unformatted on main already, out of bounds.
- `python3 .githooks/secret-scan.py --all` → exit 0, no output.

## Changes

- `packages/gateway/src/router/router.ts`: `Router implements ModelGateway` over `RouterOptions { tiers, fallback? }`; `CapabilityNeeds`, `missingCapability` (module-level, not exported from the package).
- `packages/gateway/src/router/factory.ts`: `createRouter(policy, factories)`, `AdapterFactory`, `ProviderAdapterFactories`; one adapter per `provider:model`; fails at construction on an unknown provider (own keys only, so `toString` etc. are not providers) or a missing tier.
- `packages/gateway/src/router/default-policy.ts`: `DEFAULT_MODEL_POLICY` (frozen, provisional).
- `packages/gateway/src/router/index.ts`, `src/index.ts`: barrels.
- Tests: `test/router/{fake-adapter.ts, router.test.ts, factory.test.ts}`; `test/keys/exports.test.ts` updated for the new exports.
- `package.json`: `@edmate/harness: workspace:*` devDependency; `pnpm-lock.yaml`.
- `vitest.config.ts`: `src/router/**` 100% threshold.

## Deviations

- `missingCapability` is exported from `router.ts` (not from the package) so the vision branch, which no call site uses yet, can be tested directly.
- `stream()` runs the capability check synchronously, so a mismatch throws from the `stream()` call itself rather than on first iteration. Both reject before any provider call.
- Fake adapters wrap `ScriptedGateway`; the "throws before any chunk" cases use a tiny `failingAdapter` that rejects `next()` directly, since a scripted `[error]` step does the same thing through more code.

## Decisions

### 18 Oct 2026 · 2.3 Fallback rule collapses to one check · decided by planner · risk: low
Decided: the router falls back only when the error is a `GatewayError` with `retryable: true`, nothing has been yielded yet for this `stream()` call, and a capable fallback adapter is configured. Everything else re-throws as is.
Why: `truncated`/`content_filter` are only ever paired with `retryable: false` in `adapters/errors.ts`, so checking `retryable` already covers "never fall back on a cut-off or filtered answer".
Alternatives: also check `reason` explicitly.
Reversible: yes.

### 18 Oct 2026 · 2.3 Router takes already-built adapters; a separate factory resolves ModelPolicy · decided by planner · risk: low
Decided: `Router` only sees `ModelAdapter` instances; `createRouter(policy, factories)` is the only place that turns policy strings into adapters.
Why: keeps fallback and capability logic testable with plain fakes and free of key or base-URL concerns.
Alternatives: one class that resolves the policy and routes.
Reversible: yes.

### 18 Oct 2026 · 2.3 Capability mismatch fails closed, never reroutes to fallback · decided by planner · risk: low
Decided: if the tier's adapter lacks a capability the request needs, the router throws a `validation` `GatewayError` before any call and does not try the fallback.
Why: it is a policy configuration bug, not a transient failure; rerouting would hide it.
Alternatives: try the fallback's capabilities before giving up.
Reversible: yes.

### 18 Oct 2026 · 2.3 Router tests reuse harness/testing via a devDependency · decided by planner · risk: low
Decided: `@edmate/gateway` gains `@edmate/harness: workspace:*` as a devDependency; router tests wrap `ScriptedGateway` and reuse `scriptedStreamProviderError`.
Why: the 2.6 fixtures name this task as their consumer; rule 3 limits what harness imports, not who uses its test helpers.
Alternatives: duplicate a script player in `packages/gateway/test`.
Reversible: yes.

### 18 Oct 2026 · 2.3 embed() is served by the main tier's adapter · decided by builder · risk: low
Decided: `Router.embed` uses `tiers.main` (and the fallback on a retryable error), since the `ModelGateway.embed` port has no tier.
Why: the plan did not say which tier embeds; main is the agent's primary adapter. Embeddings are platform-wide config, so a deployment that needs them routes `main` to an embedding-capable adapter or uses a separate gateway for indexing. With `DEFAULT_MODEL_POLICY` (Anthropic, no embeddings) `embed` throws `validation` without calling the provider.
Alternatives: the small tier; a separate embedding adapter in `RouterOptions` (would need a config shape the contract does not have).
Reversible: yes.

### 18 Oct 2026 · 2.3 Provisional default model ids · decided by builder · risk: low
Decided: `DEFAULT_MODEL_POLICY` = Anthropic `claude-haiku-4-5` (small) and `claude-sonnet-4-5` (main), no fallback; frozen and headed PROVISIONAL until 7.6.
Why: lead answer Q3 accepted a provisional Anthropic default; these ids match the ones already used in gateway tests.
Alternatives: a synthetic `unconfigured` provider that forces every caller to override.
Reversible: yes.

### 18 Oct 2026 · 2.3 Router coverage held at 100% · decided by builder · risk: low
Decided: `vitest.config.ts` adds a 100% threshold for `src/router/**`, beside keys and adapters.
Why: the fallback rule decides whether a second model may answer; every branch should stay tested.
Alternatives: the package's 80% default.
Reversible: yes.

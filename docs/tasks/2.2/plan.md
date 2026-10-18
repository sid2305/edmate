# Task 2.2: Two adapters for the MVP (Anthropic main + OpenAI-compatible), with capability declarations

Board: `python3 .claude/skills/board/board.py show 2.2` · Milestone M2 · deps: M0 · branch `m2/2.2-provider-adapters` · **risky** (touches `packages/gateway/src/keys/**`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Two adapters for the MVP: one main provider and OpenAI-compatible (which covers OpenRouter and self-hosted), with capability declarations"
Accept: "shared adapter contract tests (stream, tool call, JSON, embed) pass on fixtures; a third adapter needs no caller changes."

Spec it must honour:
- Build plan § Tech stack, Model access: "Vercel AI SDK provider packages behind our own `gateway` interface"; "Edmate-held keys; MVP: one main provider + OpenAI-compatible (covers OpenRouter); embeddings platform-wide".
- Build plan § Model gateway: "Adapters: MVP ships two (one main provider and OpenAI-compatible); more can be added without changing callers. Each declares capabilities (`tools`, `json`, `embeddings`, `vision`, `maxContext`)."
- `packages/contracts/src/ports.ts` `ModelGateway`: `stream(req): AsyncIterable<ModelChunk>`, `generateObject<T>(req, schema): Promise<T>`, `embed(texts): Promise<number[][]>`. Unchanged by this task.
- Decision log, 18 Oct 2026 "Main model provider": Anthropic is the main adapter; second stays OpenAI-compatible (covers OpenRouter).
- Decision log, 18 Oct 2026 "2.1 Review": "2.2's adapters must always pass the key so the OpenAI SDK never falls back to `OPENAI_API_KEY`."
- Rule 3: gateway is not the harness, so it may import AI SDK packages freely (the harness-purity hook only blocks `ai`/`@ai-sdk/*`/etc. under `packages/harness/**`).
- Rule 4: no real model calls in tests; scripted gateway/fixtures only.
- Rule 5: secrets never logged, stored or returned.

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Contract tests pass | `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...`, listing `test/adapters/{anthropic,openai-compatible}.test.ts` running the shared suite (stream, tool call, generateObject/JSON, embed) against fixtures, all green. |
| Third-adapter claim is real | The shared suite lives in `test/adapters/contract-suite.ts` and takes only a factory + fixtures + capabilities; it is not Anthropic/OpenAI-compatible specific. |
| Key never falls back to the SDK default | `test/adapters/env-fallback.test.ts`: `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` set to sentinel values, adapters built with a different `Secret`; the sentinel is never read (tracked) and never sent (captured request), the real key is. |
| No key leak through errors | `test/adapters/errors.test.ts`: every mapped `GatewayError`'s `message`/`stack`/`JSON.stringify`/`util.inspect` contain no fragment of the fake key. |
| No real network | `test/helpers/fetch-mock.ts` is the only thing adapters call through in tests; a check (reused from `single-door.test.ts`'s style) that no test file imports `node:http`/hits a real URL. |
| Coverage | `src/adapters/**` at 100%, package at 80%+, same thresholds as 2.1. |
| Repo stays clean | `python3 .githooks/secret-scan.py --all` exits 0. |

## Design

### Two adapters, one shape
`packages/gateway/src/adapters/types.ts` defines:
- `AdapterCapabilities`: `{ tools: boolean; streaming: boolean; json: boolean; vision: boolean; embeddings: boolean; maxContextTokens: number }` — a superset of the build plan's `tools/json/embeddings/vision/maxContext` and the task's `tools/streaming/json/vision/maxContext`; `streaming` is included too since nothing in the two lists conflicts, it's just data.
- `ModelAdapter`: `ModelGateway & { readonly id: ProviderId; readonly capabilities: AdapterCapabilities }`. Capabilities sit beside the port, not inside it — `ports.ts` (contracts) is unchanged, so no ADR.

`createAnthropicAdapter(keys: KeysFor<'anthropic'>, opts: { model control passed per-call via ModelRequest is NOT here — the adapter is single-provider; the router (2.3) picks provider+model from `ModelPolicy` and calls the matching adapter })`. In practice the factory signature is `createAnthropicAdapter(keys: KeysFor<'anthropic'>): ModelAdapter` — Anthropic's model id travels in `ModelRequest` is **not** how the port works today (`ModelRequest` has no `model` field; `ModelPolicy` outside the request carries `{provider, model}` per tier). For 2.2, each adapter is constructed already bound to one concrete model id (and, for openai-compatible, one `baseURL`), passed as plain config at construction time, e.g. `createAnthropicAdapter(keys, { model: 'claude-...' })` / `createOpenAICompatibleAdapter(keys, { model: '...', baseURL: '...' })`. Picking *which* model/baseURL per tier/agent is the router's job (2.3); 2.2 only builds adapters that work correctly once given a model id and (for the second adapter) a base URL.

### SDK choice (second adapter)
Use `@ai-sdk/openai-compatible` (`createOpenAICompatible`), not `@ai-sdk/openai` with a custom `baseURL`. Reason: `@ai-sdk/openai` assumes OpenAI-specific request/response shaping (strict JSON-schema mode, OpenAI-only parameters, moderation endpoint) that OpenRouter and self-hosted engines (vLLM, Ollama, etc.) don't reliably implement; `@ai-sdk/openai-compatible` is the AI SDK's own thinner client built for exactly this "OpenAI-shaped but not OpenAI" case, matching the task's own name for the adapter.

### Key use
Both adapters take their `Secret` at construction and call `.reveal()` exactly once, when building the AI SDK provider client (`apiKey: keys.apiKey.reveal()`), same discipline as `single-door.test.ts` already expects (`.reveal(` allowed under `src/keys/` and `src/adapters/`). Neither adapter ever reads `process.env` directly — `env-fallback.test.ts` proves the SDK's own fallback (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) is never read or sent, by (a) wrapping `process.env` access to those two names in a tracking `Proxy` during the call and asserting zero reads, and (b) asserting the sentinel string is absent from, and the real key's header is present in, the captured outgoing request.

### Streaming, tool calls, JSON, embeddings
- `stream(req)`: AI SDK `streamText({ model, system, messages, tools, maxOutputTokens, temperature })` over a provider model built with the revealed key; maps AI SDK stream parts to `ModelChunk` (`text-delta` → `{type:'text'}`, `tool-call` → `{type:'tool_call', id, name, args}`, `finish`/usage → `{type:'usage', usage}`, mapping provider token counts and `prices.yaml`-independent `costMicroUsd: 0` here — real cost comes in 2.4's metering, out of bounds).
- `generateObject(req, schema)`: AI SDK `generateObject({ model, schema, system, messages, maxOutputTokens })`; a response that doesn't validate against `schema` is mapped to `GatewayError('validation', false, ...)`, not thrown raw.
- `embed(texts)`: capability-gated. When `capabilities.embeddings` is `true` (openai-compatible, if the configured backend has an embedding model), uses AI SDK `embedMany`. When `false` (Anthropic has no embeddings API), throws `GatewayError('provider_error', false, '<provider> has no embedding model; embeddings are platform-wide config, see task 2.7')` — **flagged as Open question Q1**, since "embed... pass on fixtures" in the acceptance could be read as "returns vectors"; recommendation below.

### Error mapping
New `packages/gateway/src/adapters/errors.ts`: `GatewayError extends Error { readonly code: ErrorCode; readonly retryable: boolean }` (a plain carrier, not a contracts type — `ErrorCode` itself is unchanged) and `mapProviderError(err: unknown, provider: ProviderId): GatewayError`:
- HTTP 429 → `rate_limited`, retryable `true`.
- HTTP 400/422 whose body/message names context/token length → `input_too_large`, retryable `false`.
- HTTP 400/404/422 otherwise → `validation`, retryable `false`.
- HTTP 401/403 (bad/expired provider key) → `provider_error`, retryable `false` — **not** `unauthorized`/`forbidden`; those codes are reserved for Edmate's own student/API auth, not a provider-key problem.
- HTTP 5xx, timeout, network/`TypeError`, or anything unrecognised → `provider_error`, retryable `true` for 5xx/timeout, `false` otherwise.
- The mapper builds its own message; it never echoes the provider's raw error body verbatim if that body could itself contain request internals (defensive; `errors.test.ts` checks no key fragment survives regardless).

### Test doubles: mocked fetch, not MSW
AI SDK provider settings accept a `fetch` function. Tests pass a `vi.fn` that returns queued `Response` objects built from fixture bytes (`test/helpers/fetch-mock.ts`) and records every request (`url`, `headers`, `body`) for assertions. No MSW dependency: this is enough to satisfy "mocked fetch / MSW-style interceptor" and keeps the dependency surface small (decision below).

## Files

### Create
- `packages/gateway/src/adapters/types.ts` — `AdapterCapabilities`, `ModelAdapter`.
- `packages/gateway/src/adapters/errors.ts` — `GatewayError`, `mapProviderError`.
- `packages/gateway/src/adapters/anthropic.ts` — `createAnthropicAdapter(keys, opts: { model: string })`.
- `packages/gateway/src/adapters/openai-compatible.ts` — `createOpenAICompatibleAdapter(keys, opts: { model: string; baseURL: string; capabilities?: Partial<AdapterCapabilities> })` (capabilities overridable per deployment — see Q3).
- `packages/gateway/src/adapters/index.ts` — barrel.
- `packages/gateway/test/adapters/contract-suite.ts` — shared Vitest suite factory (stream/tool-call/JSON/embed), parameterised by adapter factory + fixtures + expected capabilities.
- `packages/gateway/test/adapters/anthropic.test.ts`, `openai-compatible.test.ts` — run the suite, plus provider-specific header/auth-style checks (`x-api-key` + `anthropic-version` vs `Authorization: Bearer`).
- `packages/gateway/test/adapters/errors.test.ts`, `env-fallback.test.ts`, `capabilities.test.ts`.
- `packages/gateway/test/helpers/fetch-mock.ts` (reuses `test/helpers/fake-key.ts` from 2.1 for the "real" key).
- `packages/gateway/test/fixtures/anthropic/**`, `test/fixtures/openai-compatible/**` — hand-built, realistically-shaped SSE/JSON bodies for: text stream, tool-call stream, JSON/object response, embeddings (openai-compatible only), and error bodies (429, 400-context, 500). Not real recordings (rule 4 forbids real calls); shaped from each provider's public API docs.
- `docs/tasks/2.2/handoff.md` (builder), `docs/tasks/2.2/review.md` (reviewers).

### Modify
- `packages/gateway/src/keys/providers.ts`: add `anthropic: { apiKey: { variable: 'EDMATE_ANTHROPIC_API_KEY' } }` to `PROVIDER_KEYS`.
- `packages/gateway/src/index.ts`: re-export `src/adapters/*`.
- `packages/gateway/package.json`: add `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible` as dependencies, pinned exactly to current stable (builder looks up via `docs-lookup`, same pattern as 2.1's Pino pin).
- `docker/env.example`: add `EDMATE_ANTHROPIC_API_KEY=` (empty) under "Model provider keys", noting it's the main provider.
- `pnpm-lock.yaml`: from `corepack pnpm install`.

### Out of bounds
- `packages/contracts/**`, `docs/adr/**` — `ModelGateway`/`ModelRequest`/`ModelChunk`/`ErrorCode` are unchanged; capabilities live only in gateway.
- `packages/harness/**` — the harness never imports AI SDK packages; it only ever sees the `ModelGateway` port (through the scripted gateway in 2.6, or later real wiring).
- Routing/tiers/fallback (2.3), metering (2.4), limits (2.5), scripted gateway (2.6), transcriber + the platform's actual embedding model choice (2.7).
- `apps/**`, `docker/compose.yaml` — no app/worker wiring of real adapters yet.
- `packages/payments/**`.

## Tests first (Vitest, no network, no real keys — rule 4)

Reuse 2.1's fake-key discipline: no key-shaped literal in any test file; build long fake values at runtime; leak assertions are booleans (`expect(corpus.includes(key)).toBe(false)`), never `not.toContain` (which would echo the value in CI logs on failure).

1. **`contract-suite.ts`** (shared, parameterised):
   - `stream()` yields fixture text chunks in order, a `tool_call` chunk with parsed `args` when the fixture includes one, then a `usage` chunk.
   - `generateObject()` returns a value matching the given Zod schema from the fixture; a fixture that fails the schema throws `GatewayError('validation', false)`.
   - `embed()`: when capability is `true`, returns `number[][]` matching fixture dimensions; when `false`, throws `GatewayError('provider_error', false)` naming the provider.
   - Every captured request's auth header is built from the `Secret` passed at construction.
2. **`anthropic.test.ts`**: the suite with Anthropic fixtures/capabilities (`embeddings: false`); plus `x-api-key`/`anthropic-version` headers present and correct, no `Authorization: Bearer`.
3. **`openai-compatible.test.ts`**: the suite with configured capabilities (including `embeddings: true` case); plus requests go to the configured `baseURL`, never a default OpenAI URL.
4. **`errors.test.ts`**: one case per mapped status/shape (429, 400-context, 400-other, 401/403, 404, 500, timeout, unknown) → asserts `.code`/`.retryable`; for every case with a fake key in play, `message`/`stack`/`JSON.stringify`/`util.inspect` contain no 8-character fragment of it (same technique as 2.1's `load.test.ts`).
5. **`env-fallback.test.ts`** (acceptance-critical, both adapters):
   - `vi.stubEnv('ANTHROPIC_API_KEY', sentinel)`, `vi.stubEnv('OPENAI_API_KEY', sentinel)` — sentinels built at runtime, not literals.
   - Adapter built with a different `fakeKey()`-sourced `Secret`.
   - A `Proxy` around the two env names records reads during `stream()`/`generateObject()`/`embed()`; asserts zero reads of either sentinel-holding name.
   - The captured request's auth header matches the real key's revealed value, not the sentinel; the sentinel string is absent from the entire corpus (headers + body + any thrown error).
6. **`capabilities.test.ts`**: each adapter's exported `capabilities` has the full shape (booleans + positive `maxContextTokens`); `openai-compatible`'s capabilities are overridable via constructor options, Anthropic's are not (fixed per the one provider).

Commands: `source ~/.nvm/nvm.sh && corepack pnpm install`, then `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...`, then `python3 .githooks/secret-scan.py --all`.

## Implementation order
1. `providers.ts` + `env.example` (add `anthropic`) — red/green on existing `load.test.ts`/`exports.test.ts` (should stay green; add one case for the new provider id).
2. `types.ts`, `errors.ts` + `errors.test.ts` (red → green), no AI SDK yet.
3. `fetch-mock.ts`, fixtures, `contract-suite.ts` (red, no adapters yet).
4. `anthropic.ts` + `anthropic.test.ts` (green against the shared suite).
5. `openai-compatible.ts` + `openai-compatible.test.ts`.
6. `env-fallback.test.ts`, `capabilities.test.ts`.
7. Barrels (`src/adapters/index.ts`, `src/index.ts`), `package.json` AI SDK pins, coverage, secret scan, handoff.

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`.
- `packages/gateway/src/keys/providers.ts` matches `packages/gateway/src/keys/**` (group "access, money, sign-in, keys"). **Required reviewer: `security-reviewer`.** The handoff needs a `risk: high` decision entry for adding the `anthropic` provider-key entry.
- `packages/gateway/src/adapters/**` is *not* itself a listed risky glob, but it's where `.reveal()` is called and auth headers are built (the same class of risk `src/keys/**` protects). Recommendation: ask `security-reviewer` — already required above — to review `src/adapters/**` too, not just `providers.ts`.
- No match: `packages/gateway/test/**`, `src/index.ts`, `package.json`, `docker/env.example`, `pnpm-lock.yaml`, `docs/tasks/2.2/**`.
- No safety prefix touched; no `packages/contracts/**` or `docs/adr/**` change, so no ADR and no architect/typescript-reviewer requirement from that group (though both are recommended below anyway).
- Recommended in addition: `typescript-reviewer` (generics in `generateObject<T>`, the `ModelAdapter` intersection type), `silent-failure-hunter` (error-mapping fallthroughs, the embeddings-unsupported path), `code-reviewer`.

## Decisions (to copy into the handoff `## Decisions`)

### 2.2 Anthropic provider-key entry · decided by planner · risk: high
Decided: add `anthropic: { apiKey: { variable: 'EDMATE_ANTHROPIC_API_KEY' } }` to `PROVIDER_KEYS`, same shape as `openai-compatible`.
Why: Anthropic is the main provider (decision log, 18 Oct 2026); it needs a key through the same one door as every other provider.
Alternatives: None — the module's whole point is one place for every provider's keys.
Reversible: Yes.

### 2.2 `@ai-sdk/openai-compatible` over `@ai-sdk/openai` + baseURL · decided by planner · risk: low
Decided: the second adapter uses `createOpenAICompatible` from `@ai-sdk/openai-compatible`.
Why: it's the AI SDK's own client for non-OpenAI, OpenAI-shaped backends (OpenRouter, self-hosted); `@ai-sdk/openai` assumes OpenAI-only request/response features that such backends don't reliably support.
Alternatives: `@ai-sdk/openai` with a custom `baseURL`.
Reversible: Yes, swapping the package behind the same `ModelAdapter` shape.

### 2.2 Capabilities live beside the port, not inside it · decided by planner · risk: low
Decided: `AdapterCapabilities` and `ModelAdapter` are new gateway-only types; `packages/contracts/src/ports.ts` `ModelGateway` is untouched.
Why: capabilities are router/config data (which tier can use which adapter), not part of the `stream`/`generateObject`/`embed` contract every caller already relies on; no contract change means no ADR.
Alternatives: Add a `capabilities()` method to the `ModelGateway` port itself.
Reversible: Yes.

### 2.2 Mocked `fetch`, not MSW · decided by planner · risk: low
Decided: tests inject a fake `fetch` through the AI SDK provider settings and record requests themselves, instead of adding an `msw` dependency.
Why: AI SDK providers already accept a `fetch` override; a `vi.fn` plus queued `Response` objects satisfies "no real network" (rule 4) with no new dependency.
Alternatives: `msw` with recorded handlers.
Reversible: Yes.

(The builder adds the exact AI SDK version pins as a `risk: low` decision, same pattern as 2.1's Pino pin.)

## Open questions (lead can decide; none blocks the build)
- **Q1. Does `embed()` need to return real vectors on both adapters to satisfy "embed... pass on fixtures"?** Anthropic has no embeddings API. **Recommendation:** no — the contract suite is capability-aware: `embeddings: true` asserts real vectors (openai-compatible, when configured with an embedding-capable backend), `embeddings: false` asserts a clean `GatewayError('provider_error', false)` naming the provider. Which adapter/model is actually used for the platform's one embedding config is task 2.7's decision.
- **Q2. Where does the OpenAI-compatible adapter's `baseURL` and model id come from at runtime?** Not decided by this task — 2.2 only builds the factory function that takes them as config. **Recommendation:** the router/app bootstrap (2.3 or later) supplies them from `ModelPolicy`/deployment config; no default `baseURL` is hardcoded here.
- **Q3. Are `openai-compatible`'s declared capabilities fixed or overridable?** The adapter covers many different backends (OpenRouter, self-hosted) with different real capabilities. **Recommendation:** overridable via constructor options with conservative defaults (`tools/json/streaming: true`, `vision/embeddings: false` unless told otherwise); Anthropic's are fixed (one provider, one set of models).
- **Q4. Exact `maxContextTokens` and capability booleans per model?** **Recommendation:** builder looks these up via `docs-lookup` at build time rather than the plan guessing numbers that may already be stale; same pattern as 2.1's Pino version lookup.

## Lead answers (18 Oct 2026)

- Q1–Q4: accepted as recommended.
- Before your final push: `git merge origin/main`, regenerate the lockfile if it conflicts (`git checkout --theirs pnpm-lock.yaml && corepack pnpm install`), re-run gates. Other tasks merge in parallel and add dependencies.
- Reviewers will be security-reviewer (keys + adapters), typescript-reviewer and silent-failure-hunter (error mapping); the handoff needs a risk: high entry.

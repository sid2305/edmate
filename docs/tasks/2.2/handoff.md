# 2.2 handoff: Anthropic + OpenAI-compatible adapters with capability declarations

Status: DONE
Branch: `m2/2.2-provider-adapters`
Worktree: `.claude/worktrees/agent-aa619271649da54d8`
Risky: yes, `packages/gateway/src/keys/providers.ts` (group "access, money, sign-in, keys"). Required reviewer:
`security-reviewer` (please cover `src/adapters/**` too: it calls `.reveal()` and builds auth headers). Lead
answers add `typescript-reviewer` and `silent-failure-hunter` (error mapping).

## Acceptance evidence

Acceptance: "shared adapter contract tests (stream, tool call, JSON, embed) pass on fixtures; a third adapter needs
no caller changes."

| Item | Evidence |
|---|---|
| Contract tests pass | `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...` → `Tasks: 10 successful, 10 total`, gateway `Tests 171 passed (171)`. `test/adapters/anthropic.test.ts` (20) and `openai-compatible.test.ts` (43) run the shared suite: stream text + usage, tool call (name mapped back, args parsed), unknown and malformed tool calls, mid-stream error, HTTP 429/400-context/500, truncated and content-filtered streams, early `break` aborts the request, generateObject ok / schema failure / truncated (cut mid-JSON and valid-but-cut) / content-filtered / 429, embed (vectors, empty list, 500) or embed-unsupported. The OpenAI-compatible suite runs twice: chat only, and with an embedding model + raised capabilities. |
| Third-adapter claim is real | `test/adapters/contract-suite.ts` takes only `{ name, build(keys, fetch), fixtures, capabilities, sentKey }`; fixtures share one shape (`test/fixtures/contract.ts`). In src, every adapter goes through `src/adapters/sdk-adapter.ts`; a provider file only builds the AI SDK model with the revealed key and declares capabilities (`anthropic.ts` is 45 lines). Callers see only `ModelAdapter` (= `ModelGateway` + `id`, `model`, `capabilities`). |
| Key never falls back to the SDK default | `test/adapters/env-fallback.test.ts`: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` stubbed with runtime sentinels; `process.env` wrapped in a tracking `Proxy`; each adapter runs stream, generateObject, embed (when declared) and a 429 error path. Asserts zero reads of those names, global fetch never called, every request authenticates with the Secret's key, and no fragment of any sentinel in urls/headers/bodies/errors. A third test proves the proxy does see reads. Manually checked: an Anthropic client built without `apiKey`/`baseURL` reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` through the same proxy. |
| No key leak through errors | `test/adapters/errors.test.ts` (24): one case per mapped status/shape (429, 400 context x2, 413, 400, 404, 422, 401, 403, 408, 409, 500, 529, no status, RetryError, schema errors, timeout/abort, unknown); the source error carries the fake key in message, url, request body, headers and data; `message`/`stack`/`JSON.stringify`/`util.inspect` (incl. `showHidden`)/`String` hold no 8-char fragment of it, no `cause`, and the provider body is not echoed. |
| No real network | `test/setup/no-network.ts` (vitest `setupFiles`) replaces the global fetch with one that always rejects; adapters reach only `test/helpers/fetch-mock.ts`. `test/adapters/no-network.test.ts` (4) checks the stub, that no test imports `http/https/http2/net/tls/dgram/dns/undici/msw/axios/node-fetch`, and that every URL in tests is a reserved `.invalid` host except `https://api.anthropic.com` in assertions. |
| Coverage | `vitest run --coverage`: `Statements 100% (233/233) · Branches 100% (134/134) · Functions 100% (49/49) · Lines 100% (202/202)`. New threshold `src/adapters/**` = 100%, beside `src/keys/**`. |
| Repo stays clean | `python3 .githooks/secret-scan.py --all` → exit 0, no output. |

Root gates, after fix round 1 and a second merge of origin/main (clean merges, no lockfile conflict):
- `corepack pnpm install --frozen-lockfile` → "Lockfile is up to date".
- `corepack pnpm turbo run build typecheck lint test` → `Tasks: 40 successful, 40 total` (gateway 171 tests).
- `python3 -m unittest discover -s .claude/tests` → `Ran 122 tests ... OK`.
- `corepack pnpm format:check`: only `.github/workflows/ci.yml` is flagged, unformatted on main already, out of bounds.

## Pins

Current stable from `corepack pnpm view <pkg> version` on 18 Oct 2026; all three share `@ai-sdk/provider` 4.0.29 and
`@ai-sdk/provider-utils` 5.0.62, peer `zod ^3.25.76 || ^4.1.8` (we have 4.6.7):
- `ai` `7.0.143`
- `@ai-sdk/anthropic` `4.0.82`
- `@ai-sdk/openai-compatible` `3.0.71`
- `@edmate/contracts` `workspace:*` (types `ModelGateway`, `ModelRequest`, `ModelChunk`, `ErrorCode`; `ModelChunkSchema` in tests).

## Changes

- `src/keys/providers.ts`: `anthropic: { apiKey: { variable: 'EDMATE_ANTHROPIC_API_KEY' } }`.
- `src/adapters/types.ts`: `AdapterCapabilities` (`tools`, `streaming`, `json`, `vision`, `embeddings`, `maxContextTokens`), `ModelAdapter`.
- `src/adapters/errors.ts`: `GatewayError` (`code`, `retryable`, `provider`; `toJSON` gives only those + name, message) and `mapProviderError`.
- `src/adapters/sdk-adapter.ts` (internal): the port over any AI SDK model. `streamText`/`generateText` + `Output.object`/`embedMany`, `maxRetries: 0`, no-op `onError`; tool names made provider-safe and mapped back; usage chunk with `costMicroUsd: 0`.
- `src/adapters/anthropic.ts`: `createAnthropicAdapter(keys, { model, fetch? })`, fixed `ANTHROPIC_CAPABILITIES` (tools, streaming, json, vision; no embeddings; 200 000 tokens), explicit base URL.
- `src/adapters/openai-compatible.ts`: `createOpenAICompatibleAdapter(keys, { model, baseURL, embeddingModel?, capabilities?, structuredOutputs?, fetch? })`; https-only `baseURL` (http for loopback); defaults tools/streaming/json on, vision off, 8 192 tokens; `embeddings` follows `embeddingModel`; `includeUsage: true`.
- `src/adapters/index.ts`, `src/index.ts`: barrels (`createSdkAdapter` stays internal).
- Tests: `test/adapters/{contract-suite.ts, anthropic, openai-compatible, errors, env-fallback, capabilities, sdk-adapter, no-network}.test.ts`, `test/fixtures/{contract,anthropic,openai-compatible}.ts`, `test/helpers/fetch-mock.ts`, `test/setup/no-network.ts`; `test/keys/load.test.ts` (+3 for anthropic), `exports.test.ts` (new exports).
- `package.json` (deps), `vitest.config.ts` (setup file, adapters threshold), `pnpm-lock.yaml`.
- `docker/env.example`: `EDMATE_ANTHROPIC_API_KEY=` (empty) as the main provider; says `ANTHROPIC_API_KEY` is never read.

## Fix round 1

Each test-first (red run, then green):
1. **Stop reasons** (silent-failure-hunter, HIGH). `stream()` reads the finish reason. After yielding the streamed text/tool calls and the usage chunk, `length` (Anthropic `max_tokens` / `model_context_window_exceeded`, OpenAI-style `length`) throws `GatewayError('provider_error', false)` with `reason: 'truncated'`; `content-filter` (Anthropic `refusal`, OpenAI-style `content_filter`) throws with `reason: 'content_filter'`. `generateObject()` does the same, whether the JSON was cut mid-way (`NoObjectGeneratedError` carrying the finish reason) or parsed but was still cut. Fixtures per provider: `truncatedStream`, `filteredStream`, `truncatedObject`, `truncatedValidObject`, `filteredObject`. `reason` is gateway-local (`GatewayStopReason`), in `toJSON` only when set; contracts unchanged.
2. **No invented usage** (silent-failure-hunter, MEDIUM). No usage chunk when the provider gives no usage or a count that is not a non-negative integer; real zeros stay zeros (`sdk-adapter.test.ts`). Limit: `@ai-sdk/openai-compatible` itself turns a partly missing usage object (say `completion_tokens: null`) into 0, so that case can't be told apart at the adapter.
3. **Abort on early exit** (security-reviewer, MEDIUM). `stream()` and `generateObject()` pass an `AbortController` signal and abort in `finally`. Contract test: a held-open provider response, the caller `break`s after the first chunk, the captured request's signal is aborted (mutation-checked: without `abort.abort()` the test fails).
4. **https base URL** (security-reviewer, LOW). `createOpenAICompatibleAdapter` throws `openai-compatible: baseURL must be an https URL (http is allowed only for localhost, 127.0.0.1 or ::1)` for any other URL or a non-URL; the value is never echoed.

Build note: `src` compiles with `types: []` (no Node/DOM globals, as 2.1 chose), so `URL` and `AbortController` are typed with module-local `declare const` lines (the signal type comes from the SDK); both are Node 22 runtime globals.

## Deviations

- **Fixtures are TS modules** (`test/fixtures/anthropic.ts`, `openai-compatible.ts`) rather than `test/fixtures/<provider>/**` files: SSE bodies are built from typed objects, so one shape (`ContractFixtures`) is checked by the compiler.
- **`generateText` with `Output.object` instead of `generateObject`.** In `ai` 7, `generateObject` is deprecated in favour of this; behaviour is the same (schema-checked, `NoObjectGeneratedError` on mismatch → `validation`).
- **`instructions` instead of `system`** in AI SDK calls (`system` is deprecated in `ai` 7).
- **Connection failures are retryable.** The plan said network/`TypeError` → not retryable. The SDK wraps a failed fetch as an `APICallError` with no status; that maps to `provider_error`, retryable `true` (a dropped connection is the textbook transient failure). Anything truly unrecognised stays non-retryable.
- **Extra status cases:** 413 → `input_too_large`; 408 → retryable `provider_error`; other 4xx (e.g. 409) → non-retryable `provider_error`.
- **Tool-name mapping** (not in the plan): Edmate tool names may contain dots (`practice.next_item`), which Anthropic and OpenAI-style APIs reject. Names go out with unsafe characters replaced by `_`, cut to 64 characters and suffixed `_2`, `_3` on collision, and come back under the Edmate name. A call of a tool never offered, or with unparseable arguments, is a non-retryable `provider_error`.
- **`structuredOutputs` option** on the OpenAI-compatible adapter (default off → `response_format: json_object`; on → `json_schema`). The SDK prints a Node warning when a schema is given without it; the output is still schema-checked by the SDK.
- **`capabilities.test.ts` is small**: the contract suite already asserts each adapter's full capability object and freezing.
- **Embedding-capable OpenAI-compatible needs `embeddingModel`**: `embeddings` can't be overridden through `capabilities`, so it can never claim embeddings it can't serve.

## Decisions

### 18 Oct 2026 · 2.2 Anthropic provider-key entry · decided by planner · risk: high
Decided: add `anthropic: { apiKey: { variable: 'EDMATE_ANTHROPIC_API_KEY' } }` to `PROVIDER_KEYS`, same shape as `openai-compatible`.
Why: Anthropic is the main provider (decision log, 18 Oct 2026); its key enters through the same one door as every other provider.
Alternatives: None; the module's whole point is one place for every provider's keys.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Anthropic base URL is always passed · decided by builder · risk: high
Decided: the Anthropic adapter always passes `baseURL: https://api.anthropic.com/v1` (and always the key), so the SDK never reads `ANTHROPIC_BASE_URL` or `ANTHROPIC_API_KEY`. No base-URL override is offered for Anthropic.
Why: `@ai-sdk/anthropic` reads `ANTHROPIC_BASE_URL` when no base URL is given; a stray variable in the environment would send Edmate's key to another host. `env-fallback.test.ts` proves neither variable is read.
Alternatives: Let the SDK default apply; offer a configurable base URL (a proxy can be added later as an explicit option).
Reversible: Yes.

### 18 Oct 2026 · 2.2 `@ai-sdk/openai-compatible` over `@ai-sdk/openai` + baseURL · decided by planner · risk: low
Decided: the second adapter uses `createOpenAICompatible` from `@ai-sdk/openai-compatible`.
Why: it is the AI SDK's own client for OpenAI-shaped backends that are not OpenAI (OpenRouter, self-hosted); it never reads `OPENAI_API_KEY`.
Alternatives: `@ai-sdk/openai` with a custom `baseURL`.
Reversible: Yes, swapping the package behind the same `ModelAdapter` shape.

### 18 Oct 2026 · 2.2 Capabilities live beside the port, not inside it · decided by planner · risk: low
Decided: `AdapterCapabilities` and `ModelAdapter` are gateway-only types; `ModelGateway` in contracts is untouched. Anthropic's capabilities are fixed; OpenAI-compatible's are overridable per deployment with conservative defaults (vision off, 8 192 tokens) and `embeddings` follows whether an embedding model is configured.
Why: capabilities are routing data for 2.3, not part of the call contract; no contract change means no ADR.
Alternatives: a `capabilities()` method on the port.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Mocked fetch, not MSW · decided by planner · risk: low
Decided: tests inject a fake `fetch` through the AI SDK provider settings; a vitest setup file makes the global fetch always reject.
Why: AI SDK providers accept a `fetch` override; this keeps rule 4 with no new dependency, and an adapter that ignored the override would fail loudly.
Alternatives: `msw`.
Reversible: Yes.

### 18 Oct 2026 · 2.2 AI SDK pins · decided by builder · risk: low
Decided: `ai` 7.0.143, `@ai-sdk/anthropic` 4.0.82, `@ai-sdk/openai-compatible` 3.0.71, pinned exactly.
Why: current stable on 18 Oct 2026; all three share the same `@ai-sdk/provider`/`provider-utils` versions.
Alternatives: caret ranges.
Reversible: Yes.

### 18 Oct 2026 · 2.2 No SDK retries; errors mapped to fixed codes · decided by builder · risk: low
Decided: adapters call the SDK with `maxRetries: 0` and replace its console `onError`. Provider errors become `GatewayError` with a contracts `ErrorCode` (`rate_limited`, `input_too_large`, `validation`, `provider_error`), a `retryable` flag and a message written by the mapper; nothing from the provider error (body, url, request, headers, cause) is kept. A wrong or revoked provider key is `provider_error`, not `unauthorized`/`forbidden` (those are for Edmate's own auth). A failed connection is retryable.
Why: retry and fallback are the router's job (2.3), and one retry layer is easier to reason about and to meter; provider errors can carry request content.
Alternatives: keep the SDK's default 2 retries; pass the provider message through.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Output that stops early is a failure · decided by lead (fix round 1) · risk: low
Decided: when the model stops because of the token cap (`truncated`) or the provider's content filter / a refusal (`content_filter`), `stream()` first yields what it streamed and the usage, then throws `GatewayError('provider_error', retryable false)` with a gateway-local `reason`. `generateObject()` throws the same, even when the cut-off JSON happens to parse.
Why: a cut-off or filtered answer must not reach a student as if complete; the pipeline discards the partial answer, and the spent tokens still reach metering. `reason` lives in the gateway because contracts are frozen.
Alternatives: return the partial output with a flag; a new contracts error code (needs an ADR).
Reversible: Yes.

### 18 Oct 2026 · 2.2 No usage chunk when usage is unknown · decided by lead (fix round 1) · risk: low
Decided: `stream()` emits a usage chunk only when the provider reports both token counts as non-negative integers; real zeros stay zeros. For 2.4 (metering): a turn can end with no usage chunk; treat that as "usage unknown" (flag it, don't record it as free). Known gap: `@ai-sdk/openai-compatible` turns a partly missing usage object into zeros before the adapter sees it.
Why: a made-up zero makes a paid turn look free and hides a provider that stopped reporting usage.
Alternatives: report zeros (the first version); estimate tokens from text.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Tool names are made provider-safe · decided by builder · risk: low
Decided: tool names are sent with characters outside `[A-Za-z0-9_-]` replaced by `_`, cut to 64 characters, `_2`/`_3` added on collision, and mapped back to the Edmate name on the way out. A call of a tool never offered or with unparseable arguments is a non-retryable `provider_error`.
Why: Edmate tool names such as `practice.next_item` contain dots, which Anthropic and OpenAI-style APIs reject.
Alternatives: forbid dots in tool names (a contracts change); encode names reversibly (longer, less readable to the model).
Reversible: Yes.

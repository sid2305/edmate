# Task 2.7: Transcriber and embedding adapters (embedding model is platform-wide config)

Board: `python3 .claude/skills/board/board.py show 2.7` · Milestone M2 · deps: `2.2`, `M0` · branch `m2/2.7-transcriber-embeddings` · **risky** (new `packages/contracts/**` port, needs an ADR; touches `packages/gateway/src/keys/**`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Transcriber and embedding adapters (embedding model is platform-wide config)"
Accept: "a 60-minute audio fixture transcribes through the scripted adapter; a live smoke test runs behind `--live`."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Transcriber port exists and is used | `packages/contracts/src/ports.ts` has `Transcriber`; `packages/gateway/src/transcriber/*.test.ts` build adapters against it only. |
| 60-minute fixture transcribes | `test/transcriber/scripted.test.ts`: a fixture shaped like a 60-minute recording (long `segments[]`, realistic byte size metadata) round-trips through `createScriptedTranscriber` with no network call. |
| Real adapter mapped correctly | `test/transcriber/<vendor>.test.ts`: mocked-`fetch` request/response fixtures for success, empty transcript, and truncated/cut-off responses, asserting `GatewayError`-style codes, never a silently empty `text`. |
| Embedding adapter serves real vectors | `test/adapters/openai-compatible.test.ts` (extended) and a new `test/embedding/platform-config.test.ts`: the platform-wide embedding config builds an `openai-compatible` adapter with `embeddingModel` set; `embed()` returns vectors of the configured dimension on fixtures. |
| Metering wired for both | `test/transcriber/metering.test.ts` mirrors `meteredGateway.test.ts`'s pattern: every attempt (success or failure) writes exactly one sink call; embeddings reuse the existing, unmodified `meterAdapter(...).embed` path from 2.4. |
| Live smoke gated | `test/transcriber/live.smoke.test.ts` and `test/embedding/live.smoke.test.ts`: skipped unless `EDMATE_LIVE_TESTS=1` (not in the default `test` script or CI); when run, make one real call with a real key from the environment and assert a non-empty, sane result. Never part of `corepack pnpm turbo run test`. |
| No real calls in the normal suite | `rule 4` check (reused style from 2.2's `no real network` test): no test file other than the two `*.live.smoke.test.ts` imports `node:http`/hits a real URL. |
| Repo stays clean | `python3 .githooks/secret-scan.py --all` exits 0. |
| Coverage | `src/transcriber/**` and the embedding-config code at 100%, package at 80%+ (same bar as 2.1/2.2). |

## Spec it must honour

- Tech stack, Transcription row: "**Decided: provider speech-to-text API behind the Transcriber port** (18 Oct 2026)".
- Decision log, 18 Oct 2026 "Transcription": hosted speech-to-text API for the MVP ("No GPU to run, fastest to ship"); "the Transcriber port keeps it swappable."
- Decision log, 18 Oct 2026 "Main model provider": Anthropic is main; second adapter is OpenAI-compatible, which also covers OpenRouter. Neither does speech-to-text as a chat completion, so transcription is a **third** provider/key, same one-door discipline as 2.1.
- Decision log, 18 Oct 2026 "2.3 `embed()` is served by the main tier's adapter": "a deployment that needs [embeddings] routes `main` to an embedding-capable adapter **or uses a separate gateway for indexing**." The MVP's `DEFAULT_MODEL_POLICY` (both tiers Anthropic, no fallback) means nothing already uses the `openai-compatible` key for chat — 2.7 is free to dedicate it to a separate, embedding-only adapter instance with no key-variable conflict.
- `packages/db/src/schema/content.ts` `chunks.embedding` / `_shared.ts` `vector(...)`: "pgvector `vector` with no fixed dimension. The embedding model (and so its dimension and the HNSW index) is chosen in tasks 2.7/5.3, which add both in a later, additive migration."
- ADR-0001 (tech stack): speech-to-text behind a `Transcriber` port — already decided *that* it exists; ADR-0002 (ports and adapters) lists the ports that exist today and `Transcriber` is **not** among them. Adding it is a Core-contracts change (rule 2 / build plan § Core contracts: "Task 0.3 creates them; changing one afterwards needs an ADR").
- Rule 3: `packages/harness` never imports AI SDK/HTTP packages; `Transcriber` is consumed later by ingestion (5.1/5.2, in `packages/ingest`/`apps/worker`), not by the harness. 2.7 itself only adds the port (contracts) and the gateway-side adapter; it does not wire ingestion.
- Rule 4: no real model/transcription calls in the normal test run; the live smoke tests are explicitly opt-in and excluded from the default `test` script and CI.
- Rule 5: `EDMATE_`-prefixed keys only, through 2.1's `loadProviderKeys`/`PROVIDER_KEYS`; no key logged, stored or echoed in an error.

## Design

### 1. New port: `Transcriber` (contracts change → ADR-0005)
`packages/contracts/src/ports.ts`:
```ts
export interface Transcriber {
  transcribe(input: {
    /** A signed URL into object storage (never raw bytes in memory for a 60-minute file). */
    url: string;
    mimeType: string;
    languageHint?: string;
  }): Promise<{
    text: string;
    segments: readonly { text: string; startMs: number; endMs: number }[];
    language?: string;
  }>;
}
```
An empty `text` or empty `segments` on an otherwise-successful call is never returned as success — the adapter throws instead (see Error mapping). This is new Core contracts text, so: an ADR (next number, `docs/adr/0005-transcriber-port.md`) drafted by `architect`, written to the repo by the builder, reviewed by `architect`, `security-reviewer` and `typescript-reviewer`; the lead logs `risk: high`. This is not a blocker for planning (per the lead's guidance: a contracts change plans the ADR and its reviewers, it doesn't BLOCK on that alone).

### 2. Vendor and transport (open question needing the human — see below)
Recommendation: **Deepgram** (Nova-2 or later pre-recorded model), called either through an AI SDK provider package if one exists for the pinned `ai` version (builder confirms via `docs-lookup`, same pattern as 2.2's AI SDK pins) or, if not, a plain HTTP client reusing 2.2's `fetch`-injection test style.
- Deepgram's pre-recorded endpoint accepts a **URL** directly, so a 60-minute file goes straight from its signed object-storage URL to the provider with no size cap requiring our own chunking (OpenAI's Whisper API caps uploads at 25 MB, which a 60-minute recording can exceed, forcing the adapter to split and re-stitch audio — real complexity this task would otherwise own).
- Lower per-minute cost than Whisper; broad language coverage, fitting the locale-neutral goal.
- Alternative considered: OpenAI Whisper/`gpt-4o-transcribe` via `@ai-sdk/openai` — simpler (same vendor family already touched for "openai-compatible"), but needs adapter-side chunking for long files and a 25 MB practical limit.
Either way: a **new** `PROVIDER_KEYS` entry (`packages/gateway/src/keys/providers.ts`), e.g. `deepgram: { apiKey: { variable: 'EDMATE_DEEPGRAM_API_KEY' } }`, loaded through 2.1's `loadProviderKeys` — same shape as 2.2's Anthropic entry, same `risk: high` decision pattern.

### 3. Transcriber adapter and error mapping (mirrors 2.2)
`packages/gateway/src/transcriber/<vendor>.ts`: `create<Vendor>Transcriber(keys: KeysFor<'<vendor>'>, opts): Transcriber`. Reuses `mapProviderError`-style mapping (new `TranscriberError` carrying a fixed `ErrorCode` + `retryable`, same shape as `GatewayError` but gateway-local, not a contracts type):
- HTTP 429 → `rate_limited`, retryable.
- Upload/duration over the vendor's limit → `input_too_large`, not retryable.
- A 2xx response with empty `text`/no segments → `validation`, not retryable, message says "empty transcript" (never silently returned as `{ text: '' }` — this is the task's explicit "never silent" requirement, and `silent-failure-hunter` is a required reviewer for exactly this).
- A response flagged by the vendor as cut off/incomplete → `provider_error`, not retryable, `reason: 'truncated'` (mirrors `GatewayStopReason` from 2.2's `errors.ts`).
- 5xx/timeout → `provider_error`, retryable.
- No provider error body is ever echoed verbatim (same discipline as 2.2's `errors.test.ts`).

### 4. Scripted adapter (for the 60-minute fixture, and for 5.1/5.2's later tests)
`packages/gateway/src/testing/scriptedTranscriber.ts`: a hand-scripted `Transcriber`, same shape as `harness/testing/scriptedGateway.ts` (queued entries, one per call, `ScriptedTranscriberError` when the script runs out). Lives in `gateway`, not `harness/testing`, because `Transcriber` is not a harness port (the harness never calls it; only ingestion, in a later milestone, will) — ADR-0002's "harness defines ports it uses, adapters elsewhere" boundary still applies to where the *test double* belongs, not just the real adapter. Exported from a new `./testing` entry point on `@edmate/gateway` so 5.1/5.2 can import it without pulling in any real HTTP/AI SDK code.

### 5. Embedding adapter: platform-wide config, served by a dedicated instance
`openai-compatible`'s adapter already supports an optional `embeddingModel` (2.2). Given the MVP's `DEFAULT_MODEL_POLICY` sends both tiers to Anthropic with no fallback (2.3), nothing currently uses the `openai-compatible` key for chat, so 2.7 dedicates it to embeddings only, per the 2.3 decision log's "or uses a separate gateway for indexing":
- `packages/gateway/src/embedding/config.ts`: a frozen `EMBEDDING_CONFIG = { provider: 'openai-compatible', baseURL: 'https://api.openai.com/v1', model: 'text-embedding-3-small', dimension: 1536 }` (provisional, headed the same way as `DEFAULT_MODEL_POLICY` until 7.6's cost/eval pass), plus `createEmbeddingGateway(keys): Pick<ModelGateway, 'embed'>` built from `createOpenAICompatibleAdapter` with only `embeddingModel` set (no chat `model` needed for this instance's purpose, though the type requires one — pass the same model id; `stream`/`generateObject` on this instance are simply never called by anyone).
- This instance is **not** plugged into the turn-serving `Router`; ingestion (5.1–5.3) calls `createEmbeddingGateway(keys).embed(...)` directly. 2.7 does not wire ingestion itself (out of bounds), only builds and exports this factory and the config constant.
- Metering: unchanged. `meterAdapter(...).embed` (2.4) already wraps any `ModelAdapter`'s `embed`; 2.7 just needs the dedicated instance to go through it the same way, which needs no new gateway code — only a note for 5.3 that embeddings are *always* recorded as `unmetered`/`no_usage_reported` today (the `ModelGateway.embed` port returns no `Usage`; this is pre-existing from 2.3/2.4, not a 2.7 change).

### 6. Metering for the Transcriber (new; no existing wrapper to reuse)
`packages/gateway/src/metering/meteredGateway.ts`'s `Method` type gains `'transcribe'`; a new `meterTranscriber(transcriber: Transcriber, meter: Meter): Transcriber` mirrors `meterAdapter`: calls `transcriber.transcribe`, records one attempt in a `finally` (success or throw), same "never thrown by metering, only logged" discipline. Because the port returns no token/duration usage, every attempt is recorded via `recordUnmetered({ reason: 'no_usage_reported', ... })` for now — real per-minute pricing (a parallel, duration-keyed price table, since `prices.yaml`/`ModelPriceSchema` is token-only) is **not** built in 2.7; flagged as a follow-up (see Open questions).
**Caveat flagged, not solved, by 2.7:** `UsageMeter.record`'s `ctx` (and `usage_ledger`'s NOT NULL `package_id`/`student_id`) is shaped for a student's turn. Transcription (and ingestion-time embedding) happens per **document/teacher**, with no student, package or turn naturally in scope. 2.7's `meterTranscriber` stays generic (whatever `MeterContext` the caller supplies, same as `meterAdapter` already does) and does not change `MeterContext`'s shape or `usage_ledger`'s schema. Making ingestion-time billing actually fit is handed to 5.1/5.2/5.3 as an explicit open problem (possibly its own small ADR/migration later), not resolved here.

### 7. The pgvector dimension migration — recommend 2.7 does it
**Recommendation: yes, 2.7 adds the additive migration** (`ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(1536)`, plus the HNSW index, e.g. `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`), not 5.3. Reasoning: 2.7 is the task that actually names the model and its dimension (`EMBEDDING_CONFIG.dimension`); leaving the column unconstrained until 5.3 only means an extra task re-derives the same number from the same config this task just wrote, with a window in between where a bug could insert a wrong-dimension vector with no constraint to catch it. The table is empty (no data-loss risk); `schema.test.ts` already expects a nullable `vector` column and will need the dimension-aware assertion updated either way. 5.3 still does the *chunking/ranking* work (recall@5 ≥ 0.8); it just inherits a correctly-shaped column instead of also having to fix it.
- `packages/db/src/schema/_shared.ts` `vector(...)` gains an optional dimension parameter (`vector('embedding', { dimensions: 1536 })`), matching `pgvector`'s typed-dimension column support in Drizzle.
- Reviewer: `database-reviewer` (not a listed risky-path glob for migrations themselves, but good practice per `postgres-patterns`/`database-migrations` skills; recommended in addition to the required reviewers below).

## Files

### Create
- `packages/gateway/src/transcriber/types.ts`, `<vendor>.ts`, `errors.ts`, `index.ts`.
- `packages/gateway/src/testing/scriptedTranscriber.ts`, package `./testing` export.
- `packages/gateway/src/embedding/config.ts` (`EMBEDDING_CONFIG`, `createEmbeddingGateway`).
- `packages/gateway/test/transcriber/{scripted,<vendor>,errors,metering}.test.ts`, `test/transcriber/live.smoke.test.ts`.
- `packages/gateway/test/embedding/{platform-config,live.smoke}.test.ts`.
- `packages/gateway/test/fixtures/transcriber/**` (hand-built, not real recordings — shaped from the vendor's public API docs, same rule-4 discipline as 2.2's fixtures).
- `docs/adr/0005-transcriber-port.md` (architect drafts the text; builder writes the file).
- `docs/tasks/2.7/handoff.md`, `docs/tasks/2.7/review.md`.

### Modify
- `packages/contracts/src/ports.ts`: add `Transcriber`.
- `packages/gateway/src/keys/providers.ts`: add the transcription vendor's `PROVIDER_KEYS` entry.
- `packages/gateway/src/metering/meteredGateway.ts` / `types.ts`: add `'transcribe'` to `Method`; `meterTranscriber`.
- `packages/db/src/schema/_shared.ts`, `content.ts`: fixed-dimension `vector`; new migration under `packages/db/migrations/`.
- `packages/db/test/schema.test.ts`: dimension-aware assertions.
- `docker/env.example`: new `EDMATE_<VENDOR>_API_KEY=`.
- `packages/gateway/src/index.ts`, `package.json` (new AI SDK/HTTP dependency, pinned via `docs-lookup`).

### Out of bounds
- `packages/harness/**` — never touches `Transcriber` or the embedding gateway.
- `packages/ingest/**`, `apps/worker/**` — ingestion wiring is 5.1/5.2.
- Real per-minute pricing / `prices.yaml` schema changes, and any `usage_ledger`/`MeterContext`/`Entitlement.source` reshaping for ingestion-time billing — flagged for 5.1–5.3, not built here.
- Router/tiers (2.3), limits (2.5), scripted *model* gateway (2.6) — unchanged.

## Tests first (Vitest, no network except the two gated live-smoke files — rule 4)
1. `scriptedTranscriber.test.ts`: queued entries replay in order; a 60-minute-shaped fixture (long `segments[]`) round-trips; running out of script throws `ScriptedTranscriberError`, never returns an empty result.
2. `<vendor>.test.ts`: mocked-`fetch` success, empty-transcript, truncated, 429, 5xx, timeout — each maps to the right code/retryable/reason; no key fragment survives in any thrown message (reuse 2.1/2.2's fake-key, boolean-assertion discipline).
3. `errors.test.ts`: table-driven, one case per mapped status.
4. `metering.test.ts`: one sink write per attempt, success and failure; failing sink write only logs, never throws to the caller (same contract as `meteredGateway.test.ts`).
5. `platform-config.test.ts`: `createEmbeddingGateway` returns vectors of `EMBEDDING_CONFIG.dimension` on fixtures; never silently returns a shorter/longer vector.
6. `live.smoke.test.ts` (both): `it.skipIf(process.env.EDMATE_LIVE_TESTS !== '1')`; never imported by any other test file; not part of the coverage/typecheck/lint gates that must stay fast and offline.

Commands: `source ~/.nvm/nvm.sh && corepack pnpm install`, then `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway... --filter=@edmate/db...`, then `python3 .githooks/secret-scan.py --all`.

## Implementation order
1. ADR-0005 draft (architect) + `Transcriber` port in contracts.
2. `keys/providers.ts` vendor entry + `docker/env.example`.
3. `transcriber/errors.ts` + tests (red → green, no network yet).
4. `transcriber/<vendor>.ts` + fixtures + its test (mocked fetch).
5. `testing/scriptedTranscriber.ts` + test, including the 60-minute fixture.
6. `metering/meteredGateway.ts` `'transcribe'` method + `metering.test.ts`.
7. `embedding/config.ts` + `createEmbeddingGateway` + `platform-config.test.ts`.
8. `db` migration (fixed-dimension `vector`, HNSW index) + `schema.test.ts` updates.
9. The two `live.smoke.test.ts` files, gated, run manually once with a real key.
10. Coverage, secret scan, handoff, ADR review.

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`.
- `packages/contracts/src/ports.ts` matches `packages/contracts/**`. **Required reviewers: `architect`, `security-reviewer`, `typescript-reviewer`.** Needs ADR-0005 and a `risk: high` decision entry.
- `packages/gateway/src/keys/providers.ts` matches `packages/gateway/src/keys/**`. **Required reviewer: `security-reviewer`** (already required above). `risk: high` decision entry for the new provider-key.
- `packages/gateway/src/transcriber/**`, `src/embedding/**` are not themselves listed globs but call `.reveal()` and build auth headers (same class as `src/keys/**`) — recommend `security-reviewer` cover these too (as 2.2's plan did).
- `packages/db/migrations/**`, `src/schema/**`: not a listed risky glob, and this migration is additive/no data loss (table is empty), so it doesn't trigger merge-gate's drop/delete check — recommend `database-reviewer` anyway (good practice, not required by the gate).
- No safety-prefix path touched.
- No match: `packages/gateway/test/**`, `src/testing/**`, `src/metering/**` (extension only, no port/contract change), `docker/env.example`, `package.json`, `docs/tasks/2.7/**`.
- Recommended in addition: `typescript-reviewer` (already required above), `silent-failure-hunter` (empty/truncated transcript must never pass silently — this is the task's explicit "never silent" requirement), `code-reviewer`.
- This task plans a `risk: high` decision entry for the handoff (contracts change), per the lead's instruction that a risky task also plans one.

## Decisions (draft, to copy into the handoff `## Decisions`)

### 2.7 New `Transcriber` port in contracts · decided by planner · risk: high
Decided: add `Transcriber { transcribe(input): Promise<{ text, segments, language? }> }` to `packages/contracts/src/ports.ts`, via ADR-0005.
Why: ADR-0001 already named the port conceptually ("speech-to-text behind a Transcriber port"), but ADR-0002's enumerated port list and the Core contracts code block don't define its shape; 5.2 needs it to exist to depend on it.
Alternatives: keep transcription entirely inside `packages/ingest` with no contracts port (breaks the "db/gateway/ingest/worker implement ports from contracts" pattern ADR-0002 set; would also make it un-swappable, contradicting the decision log's "the Transcriber port keeps it swappable").
Reversible: Only by ADR (same as every other port).

### 2.7 Embeddings served by a dedicated, separate gateway instance, not the turn-serving router · decided by planner · risk: medium
Decided: `createEmbeddingGateway` builds its own `openai-compatible` adapter instance (own `baseURL`, own `embeddingModel`) for ingestion to call directly; it is never plugged into the `Router`/`ModelPolicy` that serves turns.
Why: the 2.3 decision log already anticipated this ("a separate gateway for indexing"); the MVP's `DEFAULT_MODEL_POLICY` sends both chat tiers to Anthropic, so the `openai-compatible` key is otherwise unused and free to dedicate to embeddings with no key conflict.
Alternatives: override `ModelPolicy.tiers.main` to an embedding-capable provider (would also change which model answers chat turns — wrong); add a dedicated `ModelPolicy.embedding` field (a contracts change, bigger than needed).
Reversible: Yes.

### 2.7 Transcriber metering records every attempt as unmetered for now · decided by planner · risk: medium
Decided: `meterTranscriber` always calls `recordUnmetered({ reason: 'no_usage_reported', ... })`; no per-minute cost is computed or stored in 2.7.
Why: the port returns no duration/usage figure, and `prices.yaml`/`computeCostMicroUsd` is token-only; building a parallel duration-priced table is real new work the task's acceptance criteria don't ask for (a 60-minute fixture "transcribes", nothing about cost).
Alternatives: add a duration-keyed price file and real cost computation now.
Reversible: Yes; 5.1–5.3 (or a dedicated later task) can add real pricing without changing the port.

## Open questions

- **Q1 (needs the human). Which vendor for the Transcriber?** Recommendation: **Deepgram**, for native long-form transcription via a URL (fits the signed-URL object-storage model and the 60-minute fixture without custom chunking) and lower per-minute cost. Alternative: OpenAI Whisper/`gpt-4o-transcribe` (simpler, same family as other OpenAI-shaped wiring, but needs the adapter to chunk audio past its ~25 MB upload limit). Either needs its own new `PROVIDER_KEYS` entry and `EDMATE_`-prefixed variable.
- **Q2. AI SDK provider or plain HTTP client for the Transcriber?** Recommendation: try the AI SDK provider package for the chosen vendor first (consistency with 2.2's pattern, reused error classes); fall back to a plain HTTP client behind the same port if no AI SDK package exists for the pinned `ai` version (builder confirms via `docs-lookup`).
- **Q3. Exact embedding model and dimension?** Recommendation: `text-embedding-3-small` (1536 dims) via a direct OpenAI endpoint, PROVISIONAL and headed the same way as `DEFAULT_MODEL_POLICY` until 7.6's cost/eval pass. Needs the embedding vendor's key confirmed as the same `openai-compatible` key or a dedicated one (low risk either way; recommend reusing `openai-compatible`'s existing key for the MVP, since nothing else uses it).
- **Q4. Does 2.7 or 5.3 fix the pgvector dimension?** Recommendation: **2.7** (see Design §7) — it already names the dimension; no reason to defer a one-line, no-data-loss migration.
- **Q5. Ingestion-time billing shape (`MeterContext`/`usage_ledger` assume a student turn).** Not solved here; flagged for 5.1/5.2/5.3. Recommendation: those tasks decide whether to relax `usage_ledger`'s NOT NULL columns, add a new `Entitlement.source` value for ingestion, or bill transcription/embedding to a synthetic "teacher's own" turn — each has its own trade-offs best judged once 5.1's actual document/job model exists.

## Lead answers (18 Oct 2026)

- Q1: OpenAI Whisper (human decision 18 Oct 2026); the adapter splits recordings over 25 MB into chunks and stitches transcripts in order.
- Q2: AI SDK provider if one exists for the pinned `ai` version, else a plain HTTP client.
- Q3: text-embedding-3-small, 1536 dimensions, via the OpenAI-compatible path; provisional until 7.6.
- Q4: 2.7 fixes the pgvector dimension now (vector(1536) + HNSW index; table empty, no data lost).
- Q5: ingestion-time billing shape is deferred to 5.1–5.3.
- The Transcriber port is NOT added here: task 3.15 adds it (ADR-0005, combined with 3.4's help-state change). 2.7 builds after 3.15 merges and implements the port as merged.

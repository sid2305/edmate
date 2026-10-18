# 2.7 handoff: Transcriber and embedding adapters (embedding model is platform-wide config)

Status: DONE (fix round 1 applied)
Branch: `m2/2.7-transcriber-embeddings`
Worktree: `.claude/worktrees/agent-a3d8597f09b4bc7df` (under the main checkout)
Reviewers needed: security-reviewer (gate-required: `packages/gateway/src/keys/providers.ts`; it should also cover `src/transcriber/**`, which fetches signed URLs, and `src/adapters/openai.ts`, which reveals the key), database-reviewer (migration `0006` changes a column type; the gate does not flag it as destructive), silent-failure-hunter (empty or cut-off transcripts), typescript-reviewer, code-reviewer. `packages/contracts` is untouched: the `Transcriber` port and media schemas are used exactly as merged in ADR-0005 (3.15).

## Fix round 1

| Finding | Fix | Test |
|---|---|---|
| [HIGH, silent-failure] `readCapped` returned a short buffer when the stream ended before its `content-length` | With a usable `content-length` (no `content-encoding`, or `identity`) the body must deliver exactly that many bytes. Fewer bytes is a retryable `provider_error` with `reason: 'truncated'` ("ended early (60 of 100 bytes)"). More bytes is a retryable size mismatch. A compressed response is not held to its compressed length. | `source.test.ts`: a stream closed after 60 of 100 bytes, a stream longer than declared, a matching stream read into one buffer, a connection dropped mid-stream (retryable, no URL), gzip vs identity. |
| [MEDIUM, silent-failure] an empty piece of a split recording was skipped as silence, leaving an unflagged gap | In a split recording, a piece with no speech (blank text and no kept segments) now fails the call (`provider_error`, "piece 2 of 3 came back empty"). The one exception is the final piece when its known length (the provider's duration or the chunker's) is under 1 s. That piece is skipped, and its trace line carries `anomaly: 'empty_final_piece'`. A piece with blank text but spoken segments takes its text from the segments. A single empty upload is still the `validation` "empty transcript" error. | `whisper.test.ts`: an empty middle piece fails, and the third piece is never sent. An empty final piece of 1 s, or of unknown length, fails. A 400 ms empty tail is skipped with the anomaly in the trace. Blank text with segments; a lone empty upload. The old "silent piece in the middle is fine" test is replaced. |
| [LOW, security] 1 GiB default download cap, about 3x peak memory | `DEFAULT_MAX_DOWNLOAD_BYTES` is 600,000,000. With a content-length the body is written straight into one buffer of that size (no list of parts and second copy). MP3 pieces are `subarray` views, not copies. Peak memory is about 1x the recording for MP3 and 2x for WAV (each WAV piece carries its own header). | `whisper.test.ts` "the default download cap is 600 MB"; `source.test.ts` checks the single buffer's size. |

Gates after fix round 1 (merged `origin/main`, docs only):

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway...
→ gateway Tests 405 passed (405); coverage 100/100/100/100

corepack pnpm turbo run typecheck lint test --concurrency=2   (root)
→ Tasks: 40 successful, 40 total (gateway 405, db 360 from turbo's cache of the Postgres run, since db is unchanged this round)

python3 .githooks/secret-scan.py --all
→ exit 0
```

## Acceptance evidence

Accept: "a 60-minute audio fixture transcribes through the scripted adapter; a live smoke test runs behind `--live`."

| Item | Evidence |
|---|---|
| Transcriber port used as merged | `createWhisperTranscriber` returns `Transcriber` from `@edmate/contracts` (plus `model` for metering). It parses the input with `TranscribeInputSchema` and every result with `TranscriptSchema`. `createScriptedTranscriber` parses both too. |
| 60-minute fixture, scripted adapter | `test/transcriber/scripted.test.ts` "transcribes the 60-minute fixture with no network call": 720 segments, `durationMs` 3,600,000, a recording size over 25 MB, `TranscriptSchema` round-trip, and `fetch` is never called. A fixture the real adapter could never return (empty text, no segments, a segment past the duration) is rejected with `ScriptedTranscriberError`, never returned. |
| 60-minute recording, real adapter (mocked fetch) | `test/transcriber/whisper.test.ts` "a 60-minute recording over 25 MB": a synthetic 28.7 MB MP3 (137,813 frames) is split into 2 pieces under 24 MiB, uploaded in order, each piece's segments shifted by its offset (3,160,496 ms for piece 2), stitched, and `durationMs` is within 100 ms of 60 minutes. A WAV over the limit is split too, and an empty middle piece fails the call (fix round 1). |
| Never silent | Empty transcript → `validation` "empty transcript". Text without segment timings → `provider_error`. A 200 cut off mid-JSON → `provider_error`, `reason: 'truncated'`. A piece the provider heard as more than 2 s shorter than its known length → `truncated`. Segments going backwards → `validation`. A later piece failing fails the whole call (no partial transcript). 429 → `rate_limited` (retryable), 503 → retryable `provider_error`, 413 → `input_too_large`, and a hang past the piece timeout → retryable. |
| ADR-0005 host allowlist | `allowedHosts` is a constructor option. An empty list, another host, a suffix or subdomain of an allowed host, the same host on another port and http are all `forbidden` with no request sent. A redirect to another host (or to http, or a subdomain) is refused after one request, and nothing reaches the provider. Same-host https redirects are followed, at most 3. A mistyped entry (`https://…`, a path, userinfo, a port of 443) fails at construction. |
| Signed URL never leaks | Every thrown error in `whisper.test.ts` and `source.test.ts` is checked: its message, stack, `JSON.stringify` and `cause` (always undefined), every `console.*` line (spied) and every trace line hold neither the query string nor the signature, nor any 8-character fragment of the key. Traces name only `https://storage.edmate.invalid/recordings/class-7.mp3`. The provider upload holds the bytes, not the URL. |
| Keys explicit, no SDK env fallback | `test/adapters/env-fallback.test.ts` "openai: Whisper transcription (success and an error) and embeddings use only the Secret": `OPENAI_API_KEY`/`OPENAI_BASE_URL` sentinels are set, the env proxy records no reads, the global fetch is never called, every provider request carries the Secret's key, and Whisper goes to OpenAI's own host, not one from the environment. |
| Embeddings: platform-wide config | `test/embedding/platform-config.test.ts`: `EMBEDDING_CONFIG` is `text-embedding-3-small`, 1536, OpenAI, frozen. `createEmbeddingAdapter` sends that model to `/v1/embeddings` with the `openai` key and returns 1536-number vectors. A shorter or longer vector, or too few vectors, is an error, never returned. It refuses `stream`/`generateObject` before any request. |
| Metering | `test/transcriber/metering.test.ts`: one `no_usage_reported` row per transcription attempt (success, failure and a script that ran out) on the transcriber's model and tier `main`, with only the billing fields. A failing sink gives one `metering.failed` warning with `method: 'transcribe'` and never reaches the caller. Embeddings go through the unmodified `meterAdapter`: one unknown row per `embed` call, success or failure. |
| Live smoke behind `--live` | `test/transcriber/transcriber.live.smoke.test.ts` and `test/embedding/embedding.live.smoke.test.ts` run only through `corepack pnpm --filter @edmate/gateway test:live` (`vitest.live.config.ts`, which sets no network stub). The default config excludes them, and each is `describe.skipIf(!live)` on `EDMATE_LIVE_TESTS=1` plus its key/URL. `no-network.test.ts` checks the exclusion, the gate and that no other test imports them. They were not run here (no real key in this environment). |
| No real network in the normal suite | `no-network.test.ts` passes on the new files (every URL handed to an adapter is `.invalid`, no network module imported). |
| pgvector dimension | Migration `0006_chunk_embedding_dimension.sql`: a guard that stops the migration if any stored embedding is not 1536-dimensional, then `ALTER COLUMN "embedding" SET DATA TYPE vector(1536)`, then `chunks_embedding_hnsw_idx` (HNSW, `vector_cosine_ops`). `schema.test.ts` checks the column type, the index and the guard order. `migrate.int.test.ts` stores and reads a 1536 vector, has Postgres refuse a 3-number one, and runs the guard against a pre-0006 column holding a 3-dimensional vector: it raises, and nothing is changed. |
| Coverage | gateway: 100/100/100/100 for the whole package, with new 100% thresholds for `src/transcriber/**`, `src/embedding/**` and `src/testing/**`. db: All files 100 / 99.04 / 100 / 100. |

Commands (Postgres: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`, which recreated the shared container because the old one pointed at a deleted worktree; stopped afterwards):

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway... --filter=@edmate/db...
→ gateway Tests 394 passed (394); db Tests 337 passed (337) (before merging main)

corepack pnpm turbo run typecheck lint test --concurrency=2 --force     (root, after merging origin/main)
→ gateway 394 passed, db 360 passed (no skips, on Postgres), harness 2000, contracts 322, web 132, ...
→ Tasks: 40 successful, 40 total

python3 .githooks/secret-scan.py --all
→ exit 0

corepack pnpm run format:check
→ only .github/workflows/ci.yml flagged; it comes from main, untouched here
```

The first root run (default concurrency, load average about 40 from other sessions) timed out 4 tests at 5 s, 3 of them older SDK tests. The 60-minute test now has a 30 s timeout (about 170 ms alone); the rerun with `--concurrency=2` passed.

Merged `origin/main` (2.5, 3.4, docs): no conflicts. 2.5 took migration `0005_cost_alarm`, so this branch's migration was regenerated as `0006_chunk_embedding_dimension` on top of it. `corepack pnpm install` reported the lockfile up to date (the only lockfile change is `@ai-sdk/openai`).

## Changes

- `packages/gateway/src/keys/providers.ts`: `openai: { apiKey: { variable: 'EDMATE_OPENAI_API_KEY' } }`. `docker/env.example` and the README list it.
- `packages/gateway/src/adapters/openai.ts`: `createOpenAITranscriptionModel(keys, { model, baseURL?, fetch? })`, the only place the OpenAI key is revealed. The base URL is always passed (default OpenAI's). `openai-compatible.ts` exports `checkBaseURL(value, provider)`; its message is unchanged for openai-compatible.
- `packages/gateway/src/transcriber/`: `whisper.ts` (`createWhisperTranscriber`, `ModelTranscriber`, `TranscriberTrace`, defaults), `source.ts` (allowlist, manual redirects, size-capped download, `redactUrl`), `chunking.ts` (`AudioChunker`, `splitWav`, `splitMp3`, `defaultChunker`), `errors.ts` (`TranscriberError`, `mapTranscriptionError`), `index.ts`.
- `packages/gateway/src/embedding/`: `EMBEDDING_CONFIG`, `createEmbeddingAdapter`.
- `packages/gateway/src/metering/`: `meterTranscriber`; `MeteredMethod` adds `'transcribe'` (also in `MeteringWarning`).
- `packages/gateway/src/testing/`: `createScriptedTranscriber`, `ScriptedTranscriberError`, exported as `@edmate/gateway/testing` (new package export).
- `packages/gateway/package.json`: `@ai-sdk/openai` 4.0.96 (same `@ai-sdk/provider` 4.0.29 / `provider-utils` 5.0.62 as the pinned `ai` 7.0.143), `test:live` script, `./testing` export. `vitest.config.ts`: excludes live tests, adds thresholds. New `vitest.live.config.ts`.
- Tests: `test/transcriber/{whisper,source,chunking,errors,scripted,metering}.test.ts`, `test/embedding/platform-config.test.ts`, two live smoke files, fixtures under `test/fixtures/transcriber/` (synthetic audio built in memory, hand-written Whisper responses). `helpers/fetch-mock.ts` takes response headers and binary bodies. `env-fallback`, `no-network`, `load` and `exports` tests extended.
- `packages/db`: `vector()` takes `{ dimensions }`; `EMBEDDING_DIMENSIONS = 1536`; `chunks.embedding` is `vector(1536)` with `chunks_embedding_hnsw_idx`; migration `0006` + snapshot + journal; `schema.test.ts`, `migrate.int.test.ts`, `helpers.ts` updated.

## Deviations from the plan

- `--live` is the `test:live` script (`vitest -c vitest.live.config.ts` with `EDMATE_LIVE_TESTS=1`), not a CLI flag. Vitest refuses unknown flags, and the default config's network stub would block real calls anyway.
- The live files are named `*.live.smoke.test.ts` (`transcriber.live.smoke.test.ts`, `embedding.live.smoke.test.ts`) so one glob excludes them.
- `TranscriberError` is its own class (codes `validation`, `forbidden`, `not_found`, `input_too_large`, `rate_limited`, `provider_error`), not `GatewayError`: the storage side needs `forbidden` and `not_found`. Provider failures still go through `mapProviderError`.
- The embedding factory is `createEmbeddingAdapter` (a `ModelAdapter`), not `createEmbeddingGateway` (`Pick<ModelGateway,'embed'>`), so 2.4's `meterAdapter` wraps it unchanged.
- The `Transcriber` port was not added here (lead answer: 3.15 added it).

## Decisions

### 18 Oct 2026 · 2.7 New `openai` provider key for Whisper and the platform embedding model · decided by builder · risk: high
Decided: `PROVIDER_KEYS.openai` reads `EDMATE_OPENAI_API_KEY`, loaded through 2.1's `loadProviderKeys`. Both the Whisper transcriber and the embedding adapter take `KeysFor<'openai'>`. The key is revealed only in `src/adapters/openai.ts` and `src/adapters/openai-compatible.ts`, and the base URL is always passed. A test checks that `OPENAI_API_KEY`/`OPENAI_BASE_URL` are never read.
Why: both services live on api.openai.com under one OpenAI account. Keeping them off `openai-compatible` keeps that key free for OpenRouter or a self-hosted chat server.
Alternatives: reuse the `openai-compatible` key for embeddings (the plan's Q3 note), which breaks once a deployment points that key at OpenRouter; a separate key per OpenAI service.
Reversible: yes (one entry and two factory signatures).

### 18 Oct 2026 · 2.7 Whisper through the AI SDK's OpenAI transcription model, called at the model level · decided by builder · risk: medium
Decided: `@ai-sdk/openai` 4.0.96 (lead Q2: an AI SDK provider exists for the pinned `ai`). The adapter calls `transcription('whisper-1').doGenerate(...)` directly, not `ai`'s `transcribe()`. It sends `verbose_json` with segment timestamps, the language hint as `language`, and a per-piece timeout. SDK errors go through `mapProviderError`. A 2xx with an unparseable body is `provider_error` with `reason: 'truncated'`.
Why: `transcribe()` guesses the media type from the bytes (falling back to `audio/wav`) and would download a URL itself; the adapter has to send the declared MIME type and do the download itself under the allowlist.
Alternatives: a plain HTTP client; `ai`'s `transcribe()`.
Reversible: yes.

### 18 Oct 2026 · 2.7 Storage download rules for signed URLs · decided by builder · risk: medium
Decided: `allowedHosts` entries must be bare hosts (an optional non-default port is allowed; they are lower-cased). A wrong entry fails at construction. The URL's parsed `host` (including the port) must match exactly. Redirects are followed by hand, only to the same host over https, at most 3. Downloads are capped at 600 MB (refused from `content-length` before reading, or while streaming) with a 10-minute timeout. With a content-length the body must arrive whole (fix round 1). 401/403 → `forbidden`, 404/410 → `not_found`, 429 → `rate_limited`, 5xx → retryable `provider_error`, an empty body → `validation`. Errors never carry a `cause`. Traces name `scheme://host/path` only.
Why: ADR-0005 Decision 5 and its Consequences (SSRF, the signed URL is a bearer credential).
Alternatives: refuse every redirect (some storage gateways redirect within the host); match `hostname` without the port.
Reversible: yes.

### 18 Oct 2026 · 2.7 Recordings over 24 MiB are split by a built-in WAV/MP3 chunker, or by an injected one · decided by builder · risk: medium
Decided: pieces are at most 24 MiB (Whisper's limit is 25 MB, and the multipart envelope needs room). The built-in `defaultChunker` cuts WAV on sample-frame boundaries (each piece gets its own header) and MPEG layer III on frame boundaries (ID3 tags skipped), with exact offsets and durations from the sample counts. Any other format over the limit (webm, m4a, ...) is `input_too_large` unless the composition root passes a `chunker` (for example an ffmpeg one in the worker, 5.2). Unreadable audio is `validation`. A chunker's pieces are checked (non-empty, under the limit, in order) before any upload.
Why: splitting compressed containers needs a decoder, and the gateway takes no native or ffmpeg dependency.
Alternatives: add ffmpeg to the gateway; cut raw bytes (it breaks most containers); transcode everything to MP3 first (that belongs in the worker).
Reversible: yes. 5.1/5.2 should transcode uploads to MP3 or WAV, or inject a chunker.

### 18 Oct 2026 · 2.7 How pieces are stitched, and what counts as cut off · decided by builder · risk: medium
Decided: pieces are transcribed one after another, in order. Segment text is trimmed and blank segments are dropped. Times are `piece offset + round(seconds x 1000)`. The text is the non-empty piece texts joined by a space. `durationMs` is the larger of the last piece's `offset + reported duration` (or the chunker's duration) and the latest segment end. The language is the first piece's valid ISO code (the SDK maps Whisper's names), otherwise omitted. A piece with text but no segment timings fails. So does a piece heard more than 2 s shorter than the chunker says it is (`truncated`). In a split recording an empty piece fails the call, unless it is the final piece and under 1 s, which is skipped and flagged `anomaly: 'empty_final_piece'` in its trace line (fix round 1). Any piece failing fails the whole call.
Why: ADR-0005: the transcriber throws and never returns an empty or partial transcript. The tolerance absorbs rounding but catches a real cut.
Alternatives: transcribe pieces in parallel (rate limits; order is easy either way); keep a partial transcript (forbidden by the port).
Reversible: yes.

### 18 Oct 2026 · 2.7 Migration 0006 stops instead of discarding wrong-sized embeddings · decided by builder · risk: medium
Decided: `0006_chunk_embedding_dimension` first raises an exception if any `chunks.embedding` is not 1536-dimensional, then sets `vector(1536)` (`USING "embedding"::vector(1536)`), then creates `chunks_embedding_hnsw_idx` (HNSW, `vector_cosine_ops`, default build parameters). `EMBEDDING_DIMENSIONS = 1536` lives in `packages/db` beside `EMBEDDING_CONFIG.dimension` in the gateway. The two are kept equal by comments, because db does not depend on gateway.
Why: "data-safe": no stored vector is nulled or rewritten silently. The table is empty today, so the guard passes everywhere it has run.
Alternatives: null the wrong-sized vectors in the same statement; a cross-package test (it would add a dependency between the two packages).
Reversible: yes (a later migration changes the type and rebuilds the index; the model change in 7.6 needs that anyway).

### 18 Oct 2026 · 2.7 Embeddings-only adapter on the OpenAI-compatible path · decided by builder · risk: low
Decided: `createEmbeddingAdapter(keys, { config?, fetch? })` wraps `createOpenAICompatibleAdapter` with `embeddingModel = EMBEDDING_CONFIG.model`. It reports `id: 'openai-compatible'`, `model: 'text-embedding-3-small'` and only the `embeddings` capability. `stream`/`generateObject` throw a `GatewayError` before any request. `embed` fails as `validation` unless it gets one finite vector of `config.dimension` numbers per text. It is never plugged into the turn `Router`.
Why: lead Q3 (the OpenAI-compatible path, 1536 dimensions); 2.4's `meterAdapter` needs a `ModelAdapter`; a wrong-sized vector must never reach `vector(1536)`.
Alternatives: return `Pick<ModelGateway,'embed'>` (it could not be metered unchanged); use `@ai-sdk/openai`'s embedding model.
Reversible: yes.

### 18 Oct 2026 · 2.7 Transcription is metered as unknown on tier main · decided by builder · risk: low
Decided: `meterTranscriber(t, meter)` records one `no_usage_reported` attempt per call on `t.model` (`whisper-1`), tier `main` (the port has no tier, the same as `embed`). The new `MeteredMethod` type includes `'transcribe'`. Per-minute pricing from `Transcript.durationMs`, and the ingestion billing context, are left to 5.1–5.3 (lead Q5).
Why: the lead's instruction and the plan's decision; the port returns no usage figure.
Alternatives: price per minute now.
Reversible: yes.

### 18 Oct 2026 · 2.7 Live smoke tests run only through `test:live` · decided by builder · risk: low
Decided: `corepack pnpm --filter @edmate/gateway test:live` runs `vitest.live.config.ts` (no network stub, only `*.live.smoke.test.ts`, `EDMATE_LIVE_TESTS=1`). The default config excludes those files, and each also skips itself without the variable and its key (and, for Whisper, `EDMATE_LIVE_TRANSCRIBE_URL`, a signed URL to synthetic speech). A test checks the exclusion and the gate.
Why: rule 4 ("live calls only in `--live` runs"); vitest has no `--live` flag.
Alternatives: keep them in the default run, skipped (the default setup's fetch stub would block them anyway).
Reversible: yes.

### 18 Oct 2026 · 2.7 Fix round 1: a download must arrive whole, and an empty piece is a gap · decided by builder · risk: medium
Decided: (1) A download with a usable content-length must deliver exactly that many bytes, or it fails as a retryable `provider_error` (`truncated` when short). Compressed responses are exempt. (2) An empty piece in a split recording fails the call, except a final piece under 1 s, which is skipped and traced as `anomaly: 'empty_final_piece'`. (3) The default download cap is 600 MB, read into one buffer when the length is known.
Why: silent-failure-hunter and security-reviewer, fix round 1. A short body or an empty piece would otherwise become a transcript with a hole in it.
Alternatives: keep skipping empty pieces and only trace them (the gap would still reach ingestion unflagged); a separate anomaly in metering (the meter has no notes field; the trace is where it shows).
Reversible: yes. A class with a long genuine silence (more than one 24 MiB piece) now fails. If that happens in practice, 5.2 can lower the piece size or treat a near-silent piece by its audio level.

### 18 Oct 2026 · 2.7 Review · decided by team lead · risk: low
Decided: The HNSW index in packages/db/migrations/0006_chunk_embedding_dimension.sql keeps pgvector's default tuning (m 16, ef_construction 64). A genuinely silent stretch in the middle of a recording now fails the whole transcription rather than leaving a gap.
Why: Defaults are right at pilot scale; failing loudly lets an operator retry or check a recording instead of storing a transcript with a hidden hole.
Alternatives: Tune the index now; skip silent chunks.
Reversible: Yes.

# @edmate/gateway

The model gateway: provider keys (task 2.1), and later adapters, routing, metering and caps (M2).

## Provider keys

Build plan § Model gateway, Keys: Edmate-held provider keys come from the environment or a secret
manager and are never logged, stored in the DB or returned by any API.

- **One door.** Keys enter the process only through `src/keys`. The app calls
  `loadProviderKeys({ source: envKeySource(process.env), required: [...] })` once at startup.
  No file in `src` reads `process.env` itself. A secret manager later implements the same
  `KeySource` interface.
- **Fail fast, quietly.** A missing or malformed key (empty, whitespace, wrapped in quotes, a
  placeholder such as `changeme`, under 16 characters) stops startup with one `KeyConfigError`
  that names every bad variable but never shows a value, a length or a fragment. A provider that
  is not required is skipped if none of its variables is set, and must be valid if any is.
- **`Secret`.** Each key is wrapped in a `Secret` that prints, serialises and inspects as
  `[redacted]`. `reveal()` is the only way to read it, and only provider adapters
  (`src/adapters`, task 2.2) call it, when they build a client. A test enforces this.
- **Restart to rotate.** Keys are read once.

| Variable                           | Provider                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| `EDMATE_ANTHROPIC_API_KEY`         | Anthropic, the main chat provider (task 2.2)                  |
| `EDMATE_OPENAI_COMPATIBLE_API_KEY` | Any OpenAI-compatible endpoint (covers OpenRouter)            |
| `EDMATE_OPENAI_API_KEY`            | OpenAI: Whisper transcription and embeddings (task 2.7)       |

The main provider's variable is added by task 2.2. Variables use the `EDMATE_` prefix, not SDK
defaults such as `OPENAI_API_KEY`, so a key can reach an SDK only through this module. See
`docker/env.example`. Tests use runtime-generated fake keys and the scripted gateway, never real
keys.

## Transcription and embeddings (task 2.7)

- **`createWhisperTranscriber(keys.get('openai'), { allowedHosts })`** implements the `Transcriber`
  port (ADR-0005) with OpenAI Whisper (`whisper-1`). It downloads the recording through its signed
  URL only from `allowedHosts` (exact host match; an empty list refuses everything; a redirect to
  another host is refused), splits recordings over 24 MiB (WAV and MP3 built in, or pass a
  `chunker`), transcribes the pieces in order, shifts each piece's segment times by its offset,
  and checks the stitched result with `TranscriptSchema`. Every failure is a `TranscriberError`
  with a fixed message; an empty or cut-off transcript is never returned. The signed URL never
  appears in an error, a log line or a trace (traces name `scheme://host/path` only).
- **`createEmbeddingAdapter(keys.get('openai'))`** serves the platform-wide embedding model
  (`EMBEDDING_CONFIG`: `text-embedding-3-small`, 1536 dimensions, matching `chunks.embedding`
  `vector(1536)`). It is embeddings-only and checks every vector's size.
- **Metering.** `meterTranscriber(t, meter)` and `meterAdapter(embedder, meter)` write one usage row
  per attempt; both are recorded as unknown (`no_usage_reported`) until per-minute and embedding
  pricing exist.
- **Tests.** `@edmate/gateway/testing` exports `createScriptedTranscriber` for ingestion tests.
  `pnpm --filter @edmate/gateway test:live` runs the two live smoke tests with real keys from the
  environment; they never run in `test` or CI.

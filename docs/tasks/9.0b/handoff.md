# 9.0b handoff: worker ingest without embeddings (9.0 Phase B, W5)

- **Status:** DONE
- **Tool calls used:** 48 (harness count; budget 40)
- **Written by:** the lead, from the builder's report and the diff. The builder's own handoff was never committed and was lost when its worktree was cleaned up.

## What changed
- `apps/worker/src/ingest/gateway.ts`: reads `EDMATE_INGEST_EMBEDDINGS`.
  - `off` returns no embedder and no transcriber, and reads no key.
  - Unset or `openai` keeps the old behaviour (OpenAI key required).
  - Any other value throws an error that names the variable, never its value.
- `apps/worker/src/ingest/processor.ts`: with no transcriber, a video or audio job marks the document `failed/unsupported` and throws a permanent job error before any storage read or write. The embedder and transcriber are passed to indexing only when present.
- `apps/worker/src/index.ts`: logs `ingest.embeddings_off` once at start-up when the switch is off. A bad value still disables the ingest worker through the existing `ingest.worker_disabled` error log.
- Tests:
  - `gateway.test.ts` covers off, openai, unset and a bogus value; the bogus value is never echoed.
  - `processor.test.ts` covers a recording with no transcriber.
  - `test/ingest.int.test.ts` (real Postgres and Redis) ingests with embeddings off and then finds the document through `retrieval.search` full text.
- No compose change. 9.0a already sets `EDMATE_INGEST_EMBEDDINGS=off` for the worker.

## Evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker`: green (165 passed, 19 skipped), as the builder reported.
- Real Postgres and Redis integration run: 5/5 in `ingest.int.test.ts`, including the new embeddings-off case.
- Secret scan: clean.
- Commit ddf7739.

## Decisions

### 22 Oct 2026 · 9.0b With embeddings off, retrieval runs on full text only · decided by builder · risk: medium
- Decided: `EDMATE_INGEST_EMBEDDINGS=off` stores chunks with no embedding. Retrieval still finds them through its full-text signal (the vector signal skips null embeddings). Video and audio fail as `unsupported` because there is no transcriber.
- Why: the try-it stack must run without an OpenAI key (9.0 plan D3). Relevance is lower without vectors, but chat still quotes the teacher's material. The switch is explicit and logged, never a silent fallback when a key is missing.
- risk: medium

### 22 Oct 2026 · 9.0b An unknown EDMATE_INGEST_EMBEDDINGS value disables ingest · decided by builder · risk: low
- Decided: any value other than unset, `openai` or `off` fails closed. The ingest worker is disabled with an error log that names the variable but not its value.
- Why: a typo must not quietly fall back to either mode.
- risk: low

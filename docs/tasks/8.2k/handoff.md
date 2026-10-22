# 8.2k handoff: caption files (.vtt, .srt) ingested by the worker and searchable

Status: DONE

## Summary
Phase B of 8.2c (docs/tasks/8.2c/plan.md): `packages/queue` and `apps/worker` now accept `vtt` and
`srt` as ordinary file kinds for the ingest pipeline. They carry no `mimeType` and no `url` (same
schema shape as pdf/docx/pptx/markdown), and get the usual file-job retry count (5), not the web
link's capped `WEB_INGEST_ATTEMPTS` (2) — `enqueueIngest`'s existing `data.fileKind === 'web'`
branch already defaulted every other kind to `RETRY`, so no change was needed there beyond the
enum. The worker's processor reads a caption file from storage under the existing
`MAX_DOCUMENT_BYTES` cap (the same `DOCUMENT_KINDS` byte-reading path pdf/docx/pptx/markdown use)
and passes it to `@edmate/ingest`'s `parseDocument`/`indexDocument` (Phase A, 8.2j), which already
dispatches `vtt`/`srt` to `parseVtt`/`parseSrt` and produces timestamp-locator units. No transcriber
is needed, so a caption job reaches `ready` even when `EDMATE_INGEST_EMBEDDINGS=off` leaves
`gateway.transcriber` undefined. A synthetic `.vtt` was run end to end (queue -> worker -> `ready`)
against the builder's own throwaway Postgres (pgvector/pgvector:pg16) and Redis containers, and a
scoped `retrieval.search` call found the chunk with a `0:00` timestamp locator (nested under
`hit.source.locator`, not a top-level field — the only surprise versus the plan's test sketch).

`failWith` and the last-attempt logic in `processor.ts` were not touched (8.2i owns them), and
`packages/db`, `packages/contracts`, `apps/worker/src/webLink/**` were not touched.

## Files
- `packages/queue/src/queues.ts` (edit): `IngestFileKindSchema` adds `'vtt' | 'srt'`, with a comment
  explaining both are an ordinary uploaded file (no `mimeType`, no `url`, file-job retries). The
  existing `mimeType`/`url` `.refine()`s already apply correctly to the new kinds with no change.
- `packages/queue/test/queues.test.ts` (edit): a new `describe('IngestJobSchema: caption files...')`
  covering accept-with-no-mimeType-or-url, refuse-with-mimeType, refuse-with-url, and the file-job
  attempts (5) for both `vtt` and `srt`.
- `apps/worker/src/ingest/processor.ts` (edit): `DOCUMENT_KINDS` adds `'vtt'` and `'srt'`;
  `buildSource`'s `fileKind` parameter and cast name the new kinds; one header-comment line for
  8.2c (Phase B, 8.2k).
- `apps/worker/src/ingest/processor.test.ts` (edit): a new
  `describe('ingestProcessor: caption files (task 8.2c Phase B)')` covering a vtt job reaching
  `ready` with the byte cap asserted, an srt job reaching `ready`, a no-cues caption failing
  `validation`, a missing-header caption failing `unsupported`, an oversized object failing
  `input_too_large`, and a caption job reaching `ready` with `EDMATE_INGEST_EMBEDDINGS=off` (no
  `setEmbeddings` call).
- `apps/worker/test/ingest.int.test.ts` (edit): one new integration test, a synthetic `.vtt` through
  queue -> worker -> `ready`, then a scoped `retrieval.search` hit with `source.locator === '0:00'`.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/queue... --filter=@edmate/worker...`
  green (38/38 tasks; full monorepo filter set since turbo pulls in dependents/dependencies).
  `@edmate/queue` coverage 100% all four metrics. `@edmate/worker`'s `src/ingest/processor.ts`
  coverage 96.77%/95.71%/92.85%/96.42% (uncovered lines are pre-existing branches this task didn't
  touch: 256, 275, 304 — the web-link and last-attempt paths owned by 8.2e/8.2i).
- The integration test ran against the builder's own throwaway containers (`tdd82k-pg` on
  `pgvector/pgvector:pg16`, port 55499; `tdd82k-redis` on `redis:7-alpine`, port 56499), both
  removed with `docker rm -f` after the run. 10/10 tests in `ingest.int.test.ts` passed, including
  the new caption case. The running `edmate-*` containers were never touched.
- `python3 .githooks/secret-scan.py --all` clean. All caption fixture text (in both unit and
  integration tests) is synthetic, written for this task only; no captions from a real video are in
  the repo.

## Decisions

### 22 Oct 2026 · 8.2k vtt/srt are file kinds with file-job retries and no mimeType · decided by builder · risk: low
- Decided: `IngestFileKindSchema` gains `'vtt' | 'srt'`; the schema's existing `mimeType`/`url`
  refines (which key off `fileKind === 'video' | 'audio'` and `fileKind === 'web'` respectively)
  already refuse both fields on a caption job with no further change, and `enqueueIngest`'s existing
  `data.fileKind === 'web'` branch already left every other kind, captions included, on the default
  `RETRY` (5 attempts) options.
- Why: matches the plan (docs/tasks/8.2c/plan.md, Phase B) exactly: "Either one with a `mimeType` or
  a `url` is refused" and "A caption job keeps the file-job attempts (5), not
  `WEB_INGEST_ATTEMPTS`" were both already true of the existing code once the enum included the new
  kinds, so no logic beyond the enum and its comment was needed.
- risk: low (an additive enum value plus tests; no change to the refuse/accept logic, no change to
  `failWith` or retry semantics for any existing kind).

## Left to do
Nothing for Phase B. Phase C (8.2l, apps/web upload centre and the ADR-0014 amendment) is a
separate board task per the plan's "Lead answers" section, with its own handoff. 8.2l must not run
while 8.2i or 12.3c build (per the plan's "Shared files" section).

Status: DONE
Tool calls used: 47

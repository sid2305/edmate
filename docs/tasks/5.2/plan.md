# Task 5.2: Video ingestion — upload → transcription → timestamped chunks

Board: `python3 .claude/skills/board/board.py show 5.2` · Milestone M5 · deps: `2.7`, `5.1` (both DONE; `5.3` chunking/indexing/retrieval is also already DONE, ahead of board order) · not risky (no `packages/contracts/**`, `packages/harness/**`, `.claude/**`, or a safety/access-filter/payments prefix touched — see "Risky paths" below).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Video ingestion: upload → transcription → timestamped chunks"
Accept: "the 60-minute fixture is searchable within the 15-minute budget."

"Upload" is out of scope here (object storage and the upload endpoint are 8.2's "Upload centre"; this task starts from a signed URL, exactly 2.7's `TranscribeInput`). "Searchable" means: indexed through the same `chunks`/`retrieval` path 5.3 already built, so a real `retrievalIndexFor(...).search(...)` call finds a chunk whose text came from the video.

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| 60-minute fixture transcribes and chunks with timestamped locators | `packages/ingest/test/parse/video.test.ts`: a synthetic 720-segment, 60-minute `Transcript` (same shape as `packages/gateway/test/fixtures/transcriber/sixty-minutes.ts`, rebuilt locally — see "No contracts change / fixtures" below) → `parseVideoTranscript` produces units bucketed into fixed time windows, each locator a valid `H:MM:SS`/`MM:SS` timestamp strictly increasing and within `[0, durationMs]`. |
| `indexDocument` accepts a video source | `packages/ingest/test/index/indexDocument.test.ts`: a `{ kind: 'video', sourceTitle, recording }` source, with an injected `transcriber`, is chunked, stored and embedded exactly like a `'parsed'` source; no `transcriber` configured → a clear `IngestError('validation', ...)`; a transcriber rejection → a fixed, non-leaking `IngestError('provider_error', true, ...)` (cause discarded, matching the existing `storeFailed()` pattern in the same file). |
| End-to-end: searchable within the budget | `packages/db/test/video-ingest.int.test.ts` (integration, Postgres): indexes the 60-minute fixture through `@edmate/ingest`'s `indexDocument` (real `writer` = `repos.chunks`/`repos.documents`, a scripted `Transcriber` from `@edmate/gateway/testing`'s `createScriptedTranscriber`, the hashed test embedder), times the call with `performance.now()`, asserts elapsed `< 15 * 60_000` ms, then calls the real `retrievalIndexFor(repos).search(...)` with a phrase from one synthetic segment and asserts a matching chunk comes back with a timestamp locator. |
| No real transcription/model calls in tests | `createScriptedTranscriber` and the hashed embedder only; no `fetch`, no network import (same `no-network.test.ts` style check already in both packages). |
| No contracts change | `git diff origin/main -- packages/contracts` empty. `Transcriber`, `TranscribeInput`, `Transcript` are consumed exactly as ADR-0005 merged them. |
| No large/committed media | The 60-minute "fixture" is a small (~20-line) synthetic `Transcript` object built in code, not an audio/video file — same approach 2.7 used for its own 60-minute fixture. |
| Repo stays clean | `python3 .githooks/secret-scan.py --all` exits 0. |
| Coverage | `packages/ingest/src/**` and the new `packages/db` test at the package's existing threshold (ingest: 100/98+/100/100 per 5.1/5.3; db: 100/97+/100/100 per 5.3). |

## Design

### 1. `parseVideoTranscript`: `Transcript` → `ParsedDocument` (new file, no contracts change)
`packages/ingest/src/parse/video.ts`:
- `VIDEO_UNIT_WINDOW_MS = 90_000` (90 s): segments are bucketed by `floor(segment.startMs / WINDOW)`; each non-empty bucket becomes one `ParsedUnit` (text = its segments' trimmed text, joined by spaces; locator = the window's start timestamp). This mirrors the PDF "one unit per page" precedent exactly — a video "page" is a fixed time slice — and leaves within-unit splitting (paragraph → sentence → word) to 5.3's existing `chunkDocument`, unchanged.
- `formatTimestamp(ms)`: `H:MM:SS` once past an hour, else `MM:SS`, zero-padded seconds/minutes (YouTube-style; matches `SourceRef.locator`'s doc comment "page, slide, heading **or timestamp**" in `packages/contracts/src/turn.ts`, already anticipated — confirm on read, no schema change needed either way since `locator` is a free string).
- `Transcript.segments` is contract-guaranteed non-empty (`TranscriptSchema.segments.min(1)`), so `parseVideoTranscript` always returns ≥1 unit — satisfies `ParsedDocument`'s "never empty" invariant with no extra validation.
- A 60-minute, 5-second-segment fixture (720 segments) buckets into 40 units of ≤90 s each; packed through the unchanged 300-word/4,000-char chunker this lands at roughly one chunk per unit for ordinary speech density — no change to `chunker.ts` needed, `headings: false` (no heading structure in a transcript).

### 2. Wire into `indexDocument` (modify, not a new pipeline)
`packages/ingest/src/index/indexDocument.ts`:
- `IndexDocumentInput.source` gains a third variant: `VideoSource = { kind: 'video'; sourceTitle: string; recording: TranscribeInput }`.
- `IndexDocumentDeps` gains `transcriber?: Transcriber` (same optional-port shape as `embedder?: Pick<ModelGateway, 'embed'>`).
- When `source.kind === 'video'`: require `deps.transcriber` (else `IngestError('validation', false, 'no transcriber configured')`); call `deps.transcriber.transcribe(source.recording)`; any rejection becomes `IngestError('provider_error', true, 'the recording could not be transcribed')` with the cause discarded — the same blanket-wrap-and-discard already used for storage failures in this file (`storeFailed()`), so no new leak surface and no dependency on `@edmate/gateway`'s `TranscriberError` class. Then `chunkDocument(parseVideoTranscript(transcript, source.sourceTitle), { headings: false })`, and the rest of `indexDocument` (store in batches, embed in batches) is untouched.
- `Transcriber`/`TranscribeInput` import from `@edmate/contracts` only (already an `@edmate/ingest` dependency) — no new package dependency.

### 3. Exports
`packages/ingest/src/index.ts`: export `parseVideoTranscript`, `VIDEO_UNIT_WINDOW_MS`, `formatTimestamp` (from `video.ts`), and `VideoSource` (from `indexDocument.ts`).

### 4. End-to-end "searchable" proof lives in `packages/db` (already has `ingest` + `gateway` devDependencies, per 5.3 Phase D/handoff)
`packages/db/test/video-ingest.int.test.ts`, modelled on `test/recall.int.test.ts`: real `createDb`/migrations/repositories, `createScriptedTranscriber([{ transcript: sixtyMinuteTranscript }])` from `@edmate/gateway/testing`, `hashedEmbedding`/a hashed embedder from `@edmate/ingest/testing`, one `documents.create` + one `indexDocument({ ..., source: { kind: 'video', ... } })` call timed against the 15-minute budget, then one `retrievalIndexFor(repos).search(...)` call proving recall.

## Files

**Create:**
- `packages/ingest/src/parse/video.ts`
- `packages/ingest/test/parse/video.test.ts`
- `packages/db/test/video-ingest.int.test.ts`

**Modify:**
- `packages/ingest/src/index/indexDocument.ts` (adds `VideoSource`, `transcriber` dep, the transcribe-and-map step)
- `packages/ingest/test/index/indexDocument.test.ts` (new cases: video source happy path, no transcriber, transcriber rejects)
- `packages/ingest/src/index.ts` (new exports)

**Out of bounds:** `packages/contracts/**` (Transcriber/TranscribeInput/Transcript used unchanged), `packages/harness/**`, `packages/gateway/**` (2.7 is done; this task only consumes its port), `apps/worker/**` and any queue/job wiring (that's 8.2's "Upload centre with live processing status" in M8 — out of scope here, same as 5.1's library-only scope), `packages/db/src/repositories/**` and `src/schema/**` (no production db change; only a new `test/**` file), `packages/ingest/src/chunk/chunker.ts` (reused unchanged).

## Tests first (TDD order)
1. `video.test.ts`: windowing boundaries (segment exactly at a window edge, a trailing partial window, a single-segment transcript, a 60-minute/720-segment fixture), `formatTimestamp` edge cases (0, 59s, 60s, 1h, past 1h).
2. `indexDocument.test.ts` video cases: happy path (chunk count, locators, embeds), missing transcriber, transcriber rejection (assert the thrown error's message/stack/`cause` never contain the injected fake cause text — same style as 2.7's "signed URL never leaks" checks).
3. `video-ingest.int.test.ts`: index then search; budget assertion.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): no `packages/harness/src/guardrails|pedagogy/**`, `content/**`, `evals/suites/**`, `packages/harness/src/access/**`, `packages/payments/**`, any `apps/web/app/api/**`, `apps/web/src/auth/**`, `packages/db/src/identity/**`, `packages/gateway/src/keys/**`, `packages/db/src/repositories/**` (only `packages/db/test/**`, not `src/`), `packages/contracts/**`, `docs/adr/**`, or `.claude|.github|.githooks/**`. Normal review team (code-reviewer, typescript-reviewer) applies; no `risk: high` decision required by the gate. Given 2.7's own fix round was for silent truncation/empty-segment bugs, I'd *recommend* (not require) silent-failure-hunter on the transcript-windowing and error-mapping code, at the lead's discretion.

## Open questions

1. **Production timeout budget vs. the 15-minute SLA.** 2.7's `createWhisperTranscriber` defaults to a 10-minute download timeout and a 10-minute *per-piece* chunk timeout, pieces sent sequentially; a 60-minute recording splits into 2 pieces (2.7's handoff), so worst-case transcription alone could reach ~20 minutes before chunk/store/embed even starts — before 2.7's real per-piece latency (typically much faster than the timeout) is counted. Recommendation: when a later task (8.2 or whichever wires the production `Transcriber` for video ingestion) constructs it, pass tighter `downloadTimeoutMs`/`chunkTimeoutMs` (e.g. ~3 minutes each) so the worst case fits inside 15 minutes with headroom; document the numbers then, since they're constructor options, not a contracts change. Not blocking 5.2 (a pure library task with no real timeout to configure yet), but flagging so the SLA isn't silently lost at the next wiring step.
2. **Time-window size (90 s) and locator granularity.** No spec value given; 90 s was chosen to mirror the "one unit ≈ one page/chunk" precedent at ordinary speech density. Low risk, reversible (one constant); recommend the lead/builder keep it unless review finds a reason to change it.

## Phases

One phase (no split needed): ~6 files across one package plus one integration test in a sibling package that already has the needed devDependencies; well under the ~150-tool-call budget, and no risky-path review group to size around.

## Lead answers (20 Oct 2026)
- Q1 (Whisper timeouts vs the 15-minute budget): not a 5.2 blocker. The task that wires the production transcriber for video (8.2 or later) sets tighter timeouts (about 3 min each); noted on 8.2.
- Q2 (90-second window): keep 90 s. It is one constant and can be changed later.

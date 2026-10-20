Status: DONE

Branch: `m5/5.2-video-ingest` (worktree branch `work-5.2`)
Worktree: `.claude/worktrees/agent-a670e2817ada015f1`
PR: https://github.com/sid2305/edmate/pull/74 (commit `e537f31`)

## Acceptance evidence

| Item | Evidence |
|---|---|
| 60-minute fixture transcribes and chunks with timestamped locators | `packages/ingest/test/parse/video.test.ts`: 15 tests green, incl. a synthetic 720-segment/60-minute `Transcript` bucketed into 40 units (90s windows), `formatTimestamp` edge cases (0, 59s, 60s, 1h, past 1h), boundary/trailing-partial-window cases. |
| `indexDocument` accepts a video source | `packages/ingest/test/index/indexDocument.test.ts` new `describe('a video source', ...)` block: happy path (transcribe → chunk → store → embed, locators `0:00`/`1:30`), missing transcriber → `IngestError('validation', ...)`, transcriber rejection → `IngestError('provider_error', true, ...)` with cause/stack/JSON never containing the injected fake text. |
| End-to-end: searchable within the budget | `packages/db/test/video-ingest.int.test.ts`: indexes a 60-minute synthetic transcript via `createScriptedTranscriber` + hashed embedder + real `repos.chunks`/`repos.documents`, asserts `elapsed < 15*60_000` ms, then `retrievalIndexFor(repos).search(...)` finds the chunk containing "quadratic equations", locator matches `H:MM:SS`/`MM:SS`. |
| No real transcription/model calls in tests | Only `createScriptedTranscriber` (`@edmate/gateway/testing`) and the hashed embedder (`@edmate/ingest/testing`) are used; no `fetch`/network import. |
| No contracts change | `git diff origin/main -- packages/contracts` is empty (not touched). |
| No large/committed media | The fixture is a ~20-line synthetic `Transcript` built in code; no audio/video file committed. |
| Repo stays clean | `python3 .githooks/secret-scan.py --all` exits 0. |
| Coverage | ingest: `100 / 98.25 / 100 / 100` (stmts/branch/funcs/lines). db: `99.86 / 98.78 / 99.76 / 99.92`. Both meet the "ingest 100/98+/100/100, db 100/97+/100/100" bars (db's near-100 figures are pre-existing, not introduced by this task). |

### Commands run
- `PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest... --filter=@edmate/db... --force --concurrency=1` → 26/26 tasks successful (ingest 262 tests, db 630 passed/4 skipped).
- `python3 .githooks/secret-scan.py --all` → exit 0.
- Infra: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres redis` (used for the integration test).

## Changes
- `packages/ingest/src/parse/video.ts` (new): `parseVideoTranscript`, `formatTimestamp`, `VIDEO_UNIT_WINDOW_MS = 90_000`.
- `packages/ingest/src/index/indexDocument.ts`: new `VideoSource`, `IndexDocumentDeps.transcriber?`, `parseVideo()` helper wired into the main `drafts` computation (if/else-if/else replacing the prior ternary).
- `packages/ingest/src/index.ts`: new exports (`parseVideoTranscript`, `VIDEO_UNIT_WINDOW_MS`, `formatTimestamp`, `VideoSource`).
- `packages/ingest/test/parse/video.test.ts` (new), `packages/ingest/test/index/indexDocument.test.ts` (new video cases), `packages/db/test/video-ingest.int.test.ts` (new).

## Deviations
- Added one extra unit test (a whitespace-only segment) beyond the plan's list, to cover a defensive `IngestError` guard added for the theoretical case where every segment's text collapses to blank (schema allows whitespace-only text to satisfy `min(1)`); not required by the spec but keeps `src/parse/video.ts` coverage at 100% lines/branches ≥90%.
- `indexDocument.ts`'s pre-existing `source.kind === 'markdown' || source.kind === 'docx'` branch (unrelated to this task) remains partially uncovered (same gap existed before 5.2, inherited unchanged); overall package branch coverage (98.25%) still clears the 98%+ bar.

## Decisions

### 20 Oct 2026 · 5.2 video ingestion · decided by tdd-guide
Decided: Keep the 90-second time-window size for one video "unit" (bucket), per the plan's lead answer; no change needed, reversible later as one constant.
Why: No spec value was given; 90s mirrors the "one unit ≈ one page" precedent at ordinary speech density and the lead confirmed it in the plan ("Lead answers", Q2).
risk: low

### 20 Oct 2026 · 5.2 video ingestion · decided by tdd-guide
Decided: Production Whisper timeout tuning for the 15-minute SLA is deferred to the task that wires the production transcriber for video (8.2 or later), not blocking 5.2.
Why: 5.2 is a pure library task with an injected `Transcriber`; there is no real timeout to configure here. Flagged in the plan's open questions and already answered by the lead (not a 5.2 blocker).
risk: low

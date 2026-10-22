# 8.2c plan: YouTube material as an uploaded caption file (B-47)

Board: 8.2c (M8), deps 8.2f (done). Planned 22 Oct 2026.

Status: **READY.** The open questions below have recommendations and don't block Phase A or B. Phase C's wording waits on the lead's answers to Q1 and Q4; if they aren't answered, the builder uses the recommendations.

## Acceptance (verbatim)
"per the B-47 answer."

B-47 (human, 22 Oct 2026, decision log "YouTube material comes from the owner's exported captions; web links fetch any public https site (B-47, task 8.2b)"): the teacher uploads the caption file (.vtt or .srt) that they export from YouTube Studio for their own video. Edmate never calls YouTube. Web links stay open to any public https site.

### How it is shown
1. **Parse (Phase A, unit tests):** synthetic `.vtt` and `.srt` files (WebVTT header, NOTE/STYLE blocks, cue settings, tags, entities, CRLF, rolling duplicate lines, hours past 1:00) parse into the same 90 s timestamp units that a Whisper transcript gives, for example `0:00`, `1:30` and `1:02:00`. An empty or malformed file fails with a fixed `IngestError` code and no text from the file.
2. **Ingest (Phase B):** a processor unit test and an integration test in `apps/worker/test/ingest.int.test.ts` (real Postgres and Redis) run a synthetic `.vtt` through queue → worker → `ready`. A scoped retrieval search then finds the chunk, and its locator is a timestamp.
3. **Teacher flow (Phase C):** route tests show that `text/vtt` and `application/x-subrip` are accepted, with a `.vtt`/`.srt` key and chunk kind `transcript`. `complete` enqueues `fileKind: 'vtt' | 'srt'` with no `mimeType`. A YouTube link is still refused with the new fixed words, which point to the caption file. `UploadsView.test.tsx` shows that the picker accepts `.vtt`/`.srt` and that the hint is shown.
4. **No call to YouTube:** no code path fetches a YouTube host. `isYouTubeHost` refusal stays at create and in the worker, and the ingest `no-network` test still passes.

## Already done: not rebuilt here
The board title asks 8.2c to fix the 8.2d review findings and to add a per-teacher link limit first. All of them are already merged. I checked each one in the code on `main` (716e3f5):

| Item (board title) | Fixed in | Evidence on main |
|---|---|---|
| pinnedTransport timer crash, raw error not wrapped | 8.2e | `apps/worker/src/webLink/pinnedTransport.test.ts:297` "a request() that throws synchronously is a fixed error, and the timer never fires" |
| untilAborted orphaned promise | 8.2e | `packages/ingest/src/fetch/webFetch.ts:199-213` handles `p` before the abort check; test `webFetch.test.ts:327` |
| redactUrl removed or host-only | 8.2e | no `redactUrl` in `packages/ingest` (the gateway transcriber has its own, unrelated one) |
| repeated trailing dots | 8.2e, 8.2h | `linkUrl.ts` strips every dot; `..` refused as `invalid_url` (8.2h); `urlTable.ts` rows |
| cancellable resolver | 8.2e, 8.2h | `dns.promises.Resolver`, 2 s x 2 tries, `FAMILY_GRACE_MS` (address.ts) |
| explicit rejectUnauthorized | 8.2e | `pinnedTransport.ts:76`, test `:137` |
| one message for unresolved and non-public | 8.2e | `webFetch.ts:219` `unreachableHost()` |
| 3fff::/20 (code and ADR table) | 8.2e | `address.ts:60`; ADR-0014 Decision 2 |
| retryable transient DNS errors | 8.2e | `webFetch.test.ts:280` (EAI_AGAIN, ESERVFAIL, ETIMEOUT) |
| cancel errors not masking the real one | 8.2e | `webFetch.test.ts:603`, `:618` |
| a real https test | 8.2e | `pinnedTransport.tls.test.ts` (4 cases); cancel mid-body `pinnedTransport.test.ts:313` |
| fake timers in deadline tests | 8.2e | `webFetch.test.ts:300, 314, 328, 580` use `vi.useFakeTimers()` |
| misplaced JSDoc, duplicate import | 8.2e | moved; `webLink/index.ts` imports and re-exports, with no duplicate |
| "odd Promise.reject idiom" (LOW) | not changed | `webFetch.test.ts:47` is a non-async fake that returns a rejection, which is correct. Recommend wontfix |
| per-teacher link-add limit (8.2e security review) | 8.2f | `apps/web/src/studio/linkRateLimit.ts`: 20 links/teacher/hour, atomic Lua, fails closed (503); route test "the 21st call -> 429" |

The Phase A handoff logs one `risk: low` decision that closes these items with this table. No builder time goes to them.

## Out of scope (owned elsewhere)
- 8.2i (todo, M13) owns these: the stuck-`processing` sweeper, compare-and-set on the failed write (`processor.ts` `failWith`), the Host header via `bareHostName` (`pinnedTransport.ts`), the comment on the transient-failure path in `address.ts`, and **ADR-0014 Decisions 1 and 6 and the attempts and grace-period wording**. 8.2c doesn't touch those lines.
- 8.2g (todo, M13) owns the deploy egress rule and the note that the resolver ignores /etc/hosts.
- Any YouTube API or fetch (B-47 option b) needs its own ADR later. It isn't built here.

## Files out of bounds (every phase)
`packages/contracts/**`, `packages/db/**` (no migration: a caption file is an ordinary `documents` row with kind `transcript` and a `.vtt`/`.srt` storage key), `packages/harness/**`, `content/**`, `apps/web/src/auth/**`, `apps/web/app/legal/**` (12.3c), `apps/worker/src/webLink/**`, `packages/ingest/src/fetch/address.ts`, `packages/ingest/src/fetch/linkUrl.ts`, `.claude/**`, `.github/**`, `.githooks/**`. Fixtures are synthetic text only. No caption file from a real video goes in the repo (rule 5).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- Phase A: `packages/ingest/src/**` and `packages/ingest/test/**` match no glob. **None.** Recommended (not gate-required): ask `security-reviewer` to review the new parser for untrusted teacher files, at the lead's discretion.
- Phase B: `packages/queue/**`, `apps/worker/src/ingest/**` and `apps/worker/test/**` match no glob (`apps/worker/src/alerts/**` isn't touched). **None.**
- Phase C: `docs/adr/0014-web-link-egress.md` matches `docs/adr/**`. It needs **architect, security-reviewer and typescript-reviewer** and a `risk: high` decision in the Phase C handoff. The `apps/web/src/studio/**`, `apps/web/app/teacher/**` and `apps/web/messages/en.json` paths match no glob.

## Shared files (don't run alongside)
- `apps/worker/src/ingest/processor.ts` and `processor.test.ts` (Phase B) are shared with **8.2i** (the `failWith` compare-and-set). Don't run Phase B while 8.2i builds.
- `docs/adr/0014-web-link-egress.md` (Phase C) is shared with **8.2i** (Decisions 1 and 6). 8.2c edits only the Status line and Decisions 10 and 11. Don't run both at once. Whichever merges second merges `main` first (no rebase).
- `apps/web/src/studio/routes.ts`, `uploadClient.ts`, `app/teacher/uploads/UploadsView.tsx` and `messages/en.json` (Phase C) are shared with **12.3c** (rights checkbox; todo, waits on 12.3b). Don't run Phase C while 12.3c builds. In en.json, Phase C edits two existing `uploads.*` values and adds one key. 12.3c appends a `legal` block.
- `packages/queue/src/queues.ts` (Phase B) is shared by every queue task. The edit is one enum and its comment.
- `packages/ingest/src/index.ts` (Phase A) is the barrel. The edit only adds exports.

## Phase A: packages/ingest, parsing caption files (~60 tool calls)

### Files
- `packages/ingest/src/parse/captions.ts` (new): `parseVtt(bytes, sourceTitle)` and `parseSrt(bytes, sourceTitle)` → `ParsedDocument`. Rules:
  - Decode as UTF-8 (not fatal) and strip a leading BOM. Accept LF, CRLF and CR.
  - **VTT:** the first line must start with `WEBVTT` (alone, or followed by a space or tab). If it doesn't, fail with `IngestError('unsupported', false, 'the file is not a WebVTT caption file')`. Skip `NOTE`, `STYLE` and `REGION` blocks. A cue identifier line is optional. Timing is `[hh:]mm:ss.ttt --> [hh:]mm:ss.ttt [settings]`.
  - **SRT:** blocks are separated by blank lines. The numeric index line is optional. Timing is `hh:mm:ss,ttt --> hh:mm:ss,ttt`; accept `.` as the separator too.
  - **Cue text:** remove tags with a linear `<[^>]*>` pass. This covers `<c>`, `<c.color…>`, `<v Name>`, `<i>`, `<b>`, `<u>`, `<lang>`, `<ruby>`, `<rt>`, inline `<00:00:01.500>`, and SRT `<font …>`. Also remove SRT `{\…}` override tags. Decode `&amp; &lt; &gt; &quot; &#39; &nbsp; &lrm; &rlm;`, then collapse whitespace.
  - Drop a line that only repeats the previous cue's last line. YouTube's rolling auto-captions repeat each line in the next cue.
  - Skip a block whose timing line doesn't parse. If no cue has text, fail with `IngestError('validation', false, 'the caption file has no captions to learn from')`.
  - Sort cues by start time with a stable sort, then turn them into units with the shared helper below.
  - Use only anchored regexes with no nested quantifiers (no ReDoS). Error messages never quote file text.
- `packages/ingest/src/parse/video.ts` (edit): move the bucketing into an exported `unitsFromTimedText(segments: readonly { startMs: number; text: string }[]): ParsedUnit[]`. `parseVideoTranscript` calls it, with no change in behaviour (`video.test.ts` stays green unchanged).
- `packages/ingest/src/document.ts` (edit): `DocumentKind` adds `'vtt' | 'srt'`, and `parseDocument` dispatches them. The empty and 20 MB checks already run first.
- `packages/ingest/src/index.ts` (edit): export `parseVtt`, `parseSrt` and `unitsFromTimedText`.
- `packages/ingest/src/fetch/webFetch.ts` (edit, one string): the YouTube error text "YouTube links aren't supported yet" becomes "YouTube links aren't fetched" (B-47 answered). No logic change, and `src/fetch/**` keeps 100% coverage.
- Tests: `packages/ingest/test/parse/captions.test.ts` (new), `test/parse/document.test.ts` (edit), `test/index/indexDocument.test.ts` (edit), `test/fetch/webFetch.test.ts` (only if it asserts the old string).

### Tests first (red before code)
- `captions.test.ts`:
  - VTT happy path, with header text after `WEBVTT`.
  - NOTE, STYLE and REGION blocks are skipped.
  - Cue settings are ignored.
  - Every tag kind is stripped, and entities are decoded.
  - CRLF and CR line endings parse.
  - A cue past one hour gets locator `1:02:00`.
  - Rolling duplicate lines are removed.
  - Out-of-order cues are sorted.
  - SRT happy path, with and without index lines, `,` or `.` separators, and `{\an8}` and `<font>` stripped.
  - A missing `WEBVTT` header gives `unsupported`.
  - Only bad timing lines, or only empty cues, give `validation`.
  - No error message contains file text.
  - A 1 MB line of unclosed `<` parses within a loose gross-regression bound. Lessons: no tight timings.
  - Units match `parseVideoTranscript` for the same segments.
- `document.test.ts`: `vtt` and `srt` dispatch; an empty file fails with `validation`; over 20 MB fails with `input_too_large` before parsing.
- `indexDocument.test.ts`: a `vtt` `DocumentInput` is chunked with timestamp locators and `headings: false`, and the answer-bank check still runs.

### State after this phase
`parseDocument` reads `.vtt` and `.srt` bytes. Nothing enqueues them yet. `corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest...` is green with coverage thresholds met, and the secret scan is clean. The handoff logs the "already done" closure (risk: low) and the parser decisions (risk: medium).

## Phase B: packages/queue and apps/worker, ingesting caption files (~60 tool calls)

### Files
- `packages/queue/src/queues.ts` (edit): `IngestFileKindSchema` adds `'vtt'` and `'srt'`, and the comment says why. The `mimeType` and `url` refines stay as they are, so neither is allowed for vtt or srt.
- `packages/queue/test/queues.test.ts` (edit).
- `apps/worker/src/ingest/processor.ts` (edit): `DOCUMENT_KINDS` adds `vtt` and `srt`. `buildSource`'s `fileKind` parameter and cast name the new kinds. The header comment gets one line for 8.2c. `failWith` and the last-attempt logic aren't touched (8.2i owns them).
- `apps/worker/src/ingest/processor.test.ts` (edit).
- `apps/worker/test/ingest.int.test.ts` (edit): one synthetic `.vtt` case.

### Tests first
- `queues.test.ts`:
  - `vtt` and `srt` are accepted with no `mimeType` and no `url`.
  - Either one with a `mimeType` or a `url` is refused.
  - A caption job keeps the file-job attempts (5), not `WEB_INGEST_ATTEMPTS`.
- `processor.test.ts`:
  - A `vtt` job reads bytes with the `MAX_DOCUMENT_BYTES` cap and reaches `ready`, with timestamp locators in the written drafts.
  - An `srt` job reaches `ready`.
  - A caption with no cues ends `failed/validation` as a `PermanentJobError` with no retry.
  - A missing header ends `failed/unsupported`.
  - An oversized object ends `failed/input_too_large`.
  - A caption job needs no transcriber: it still reaches `ready` when `EDMATE_INGEST_EMBEDDINGS=off` leaves `gateway.transcriber` undefined.
- `ingest.int.test.ts` (real Postgres and Redis in the builder's own throwaway containers, removed afterwards, as 8.2e did): `.vtt` → `ready`, then a scoped search hits a chunk whose locator is a timestamp.

### State after this phase
A `.vtt` or `.srt` object enqueued with `fileKind: 'vtt' | 'srt'` is indexed end to end. The web side can't create one yet. `--filter=@edmate/queue... --filter=@edmate/worker...` is green (apps/web still typechecks against the wider enum), and the secret scan is clean.

## Phase C: apps/web upload centre and the ADR-0014 amendment (~75 tool calls)

### Files
- `apps/web/src/studio/files.ts` (edit): add a `caption(contentType, ext, fileKind)` helper and two rows: `text/vtt` → `vtt` and `application/x-subrip` → `srt`. Both get `chunkKind: 'transcript'` (Q2) and `maxBytes: MAX_DOCUMENT_UPLOAD_BYTES` (Q3).
- `apps/web/src/studio/files.test.ts` (edit).
- `apps/web/src/studio/uploadClient.ts` (edit): mirror the two rows in `CLIENT_UPLOAD_TYPES`. `ACCEPT` picks them up. `contentTypeFor` maps `.srt` (browsers report `''` or `text/plain`) and `.vtt` by extension.
- `apps/web/src/studio/uploadClient.test.ts` (edit): the table-equality test, the extension fallback, and the YouTube fixture message.
- `apps/web/src/studio/routes.ts` (edit): change `LINK_REFUSAL_MESSAGE.youtube_unsupported` to the Q1 words. `create` and `complete` need no code change: the table drives them.
- `apps/web/src/studio/routes.test.ts` (edit):
  - `create` with `text/vtt` → 201, a key ending `.vtt`, kind `transcript`.
  - `complete` enqueues `{ fileKind: 'vtt' }` with no `mimeType`.
  - `application/x-subrip` works the same way.
  - A caption over 20 MB → 413.
  - The YouTube link refusal returns the new words, and nothing is written.
- `apps/web/app/teacher/uploads/UploadsView.tsx` (edit): one hint line under the file picker (Q4). The existing server-message display needs no change.
- `apps/web/app/teacher/uploads/UploadsView.test.tsx` (edit): the hint renders, `ACCEPT` includes `.vtt` and `.srt`, and jest-axe stays clean.
- `apps/web/messages/en.json` (edit, `uploads.*` only):
  - `acceptHint` and `errors.unsupported_type` name caption files.
  - New key `uploads.youtubeHint`.
  - `reasons.unsupported` stays as it is. Its "or as a PDF" wording is a LOW for later, not changed here.
- `docs/adr/0014-web-link-egress.md` (edit). The architect gives the final text and the builder writes it. Draft:
  - **Status:** append "Amended in 8.2c (<date>, after review by architect, security-reviewer and typescript-reviewer): B-47 answered: YouTube material comes from the owner's exported caption file; the pilot allow-list mode is `*`."
  - **Decision 10:** "The pilot value is part of B-47, and `*` stands until the human answers." becomes "The pilot value is `*` (B-47, answered 22 Oct 2026)."
  - **Decision 11:** keep the host list and the worker's `unsupported` backstop. Change "(400 with fixed words pointing to "upload the video file")" to "(400 with fixed words pointing to the caption file (.vtt or .srt) the owner exports from YouTube Studio, or the video file)". Replace "This holds until B-47 (Q1) is answered." with "B-47 (22 Oct 2026): YouTube material comes only from the owner's exported caption file or the video file; Edmate never calls YouTube." Keep "Any YouTube fetch needs its own ADR."
  - Run `python3 docs/adr/check-headings.py`.

### Tests first
The route and table tests, `uploadClient.test.ts` and `UploadsView.test.tsx` are written red before the table, message and hint changes.

### State after this phase (task done)
A teacher picks a `.vtt` or `.srt` file in the upload centre. It goes from `uploading` to `processing` to `ready` (or `failed` with a fixed reason) and becomes searchable with timestamp locators. A YouTube link gets words that point to the caption export. `--filter=@edmate/web...` (typecheck, lint, test, build) is green, `check-headings.py` passes and the secret scan is clean. Manual evidence in the handoff: one synthetic `.vtt` through the dev stack to `ready`.

## Open questions (none block Phases A or B; recommendations are the default)
- **Q1, YouTube refusal words (Phase C):** recommend "YouTube links can't be added. Upload your video's caption file (.vtt or .srt) from YouTube Studio, or the video file." Should the video-file option stay in the words? B-47 doesn't remove video upload, and 8.2b option a) said it stays.
- **Q2, retrieval kind for captions:** recommend `transcript`, the same as audio and video, so citations read as a recording with a timestamp. The alternative is `material`.
- **Q3, size cap:** recommend the existing 20 MB document cap. A caption file is usually under 1 MB, so a smaller cap (for example 2 MB) is possible but adds a third limit.
- **Q4, upload-centre hint:** recommend one line under the picker: "Have a YouTube video? In YouTube Studio, download its captions (.vtt or .srt) and upload that file here." Should it be shown, and in these words?
- **Q5, link back to the video:** keeping the YouTube URL so a student can jump to a timestamp needs a new column (packages/db) and goes beyond B-47. Recommend not doing it in 8.2c; a board task can add it if wanted.
- **Q6, the 8.2d "Promise.reject idiom" LOW:** recommend wontfix (see the table).

## Decisions to log (handoffs)
- Phase A, risk: low: the 8.2d findings and the link limit close as already done in 8.2e, 8.2h and 8.2f, per the table.
- Phase A, risk: medium: the caption parser rules:
  - VTT header required.
  - Blocks with bad timing are skipped.
  - Rolling duplicate lines are dropped.
  - Captions use the same 90 s units as Whisper transcripts.
  - Errors are fixed codes only.
- Phase B, risk: low: `vtt` and `srt` are file kinds with file-job retries and no `mimeType`.
- Phase C, **risk: high** (docs/adr): the ADR-0014 amendment (Decisions 10 and 11) and the new YouTube refusal words. Required reviewers: architect, security-reviewer, typescript-reviewer.
- Phase C, risk: low: the SRT content type is `application/x-subrip` (no IANA type exists), with an extension fallback in the client.

## Budget
Budget: 195 tool calls (3 phases: packages/ingest; packages/queue + apps/worker; apps/web + docs/adr)

Per phase: A about 60, B about 60, C about 75. Each phase gets a fresh builder that reads this plan and the previous phase's handoff.

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash. Bash is limited to `corepack pnpm` typecheck, lint, test and build for the phase's packages, `python3 .githooks/secret-scan.py`, `python3 docs/adr/check-headings.py` (Phase C), git on the phase's own branch (no rebase or force push), and in Phase B only, `docker` for throwaway Postgres and Redis test containers that are removed afterwards. No network calls beyond the package manager.

## Exit conditions
- **DONE:**
  - The phase's tests were written red first and now pass.
  - Its package gates are green, the secret scan is clean, and the handoff has `Tool calls used:`, files, tests and decisions.
  - Phase C also has the ADR amendment, `check-headings.py` passing, and a `risk: high` decision naming architect, security-reviewer and typescript-reviewer.
- **PARTIAL (stop and hand off):**
  - The phase passes about 80 tool calls (Phase C about 90).
  - A file outside the phase's list needs changes, notably `packages/contracts/**`, `packages/db/**`, `apps/web/src/auth/**`, `apps/worker/src/webLink/**` or `processor.ts`'s `failWith`.
  - A new dependency looks necessary (none should be: caption parsing needs only string handling).
  - The gate fails twice for the same cause.
  - Anything would call YouTube or another network host.

## Lead answers (22 Oct 2026)
- Phases run as board tasks 8.2j (Phase A, packages/ingest), 8.2k (Phase B, packages/queue and apps/worker) and 8.2l (Phase C, apps/web and the ADR-0014 amendment), in that order. Each phase has its own handoff in `docs/tasks/<phase id>/`.
- 8.2k and 8.2l don't run while 8.2i builds (processor.ts, ADR-0014); 8.2l doesn't run while 12.3c builds (upload centre files, en.json).
- Q1–Q6: accepted as recommended (keep "or the video file"; chunk kind `transcript`; the existing 20 MB document cap; show the hint line; no link back to the video in 8.2c; the test-fake LOW is wontfix).
- Reviewers: typescript-reviewer and code-reviewer on every phase; architect, security-reviewer and an opus typescript-reviewer on 8.2l (ADR-0014), which logs `risk: high`.

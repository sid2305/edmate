# 8.2j handoff: caption files (.vtt, .srt) parsed into timestamped transcript text

Status: DONE

## Summary
Phase A of 8.2c (docs/tasks/8.2c/plan.md): `packages/ingest` now parses teacher-exported YouTube
caption files (`.vtt` WebVTT and `.srt` SubRip) into the same 90 s timestamp units a Whisper
transcript gives. The shared bucketing logic in `parse/video.ts` was lifted out into an exported
`unitsFromTimedText` helper so both the video transcript path and the new caption parsers use it,
with no behaviour change to `parseVideoTranscript` (its test file is unchanged and green).
`DocumentKind` gained `'vtt' | 'srt'`, dispatched in `parseDocument`. The YouTube-link refusal
string changed from "aren't supported yet" to "aren't fetched" (B-47 is answered; one string, no
logic change, `src/fetch/**` kept at 100% coverage).

Tag/entity handling (`<...>` markup, `{\...}` SRT override blocks) is a hand-written forward-only
scan, not a `<[^>]*>`-shaped regex: that shape is quadratic when a long run of the open character is
never followed by the close character (a classic ReDoS even though it is a single, non-nested
quantifier). The scan caches the next close position and only re-searches once the read head passes
it, so it is true O(n) regardless of input shape; a 1 MB line of unclosed `<` is covered by a test
with a loose (5 s) time bound per `docs/lessons.md` ("no tight timings").

## Files
- `packages/ingest/src/parse/captions.ts` (new): `parseVtt`, `parseSrt`.
- `packages/ingest/src/parse/video.ts` (edit): `unitsFromTimedText` extracted and exported;
  `parseVideoTranscript` calls it, no behaviour change.
- `packages/ingest/src/document.ts` (edit): `DocumentKind` adds `'vtt' | 'srt'`; dispatch added.
- `packages/ingest/src/index.ts` (edit): barrel exports `parseVtt`, `parseSrt`,
  `unitsFromTimedText` (append-only, as instructed; shared file, no reformat).
- `packages/ingest/src/fetch/webFetch.ts` (edit, one string): the YouTube refusal message.
- `packages/ingest/test/parse/captions.test.ts` (new).
- `packages/ingest/test/parse/document.test.ts` (edit): vtt/srt dispatch, empty/oversize cases.
- `packages/ingest/test/index/indexDocument.test.ts` (edit): a vtt `DocumentInput` end to end
  (timestamp locators, `headings: false`), and that the answer-bank check still runs for a vtt
  source named as a bank path.

## Tests
`captions.test.ts` covers (all written red first): VTT happy path with header text; NOTE/STYLE/
REGION blocks skipped; cue settings ignored; every tag kind stripped and all six listed entities
decoded; CRLF and CR line endings; a cue past one hour (bucketed into its 90 s window, same as
`parseVideoTranscript`); rolling duplicate lines dropped; out-of-order cues sorted; SRT happy path
with/without index lines, `,`/`.` separators, `{\an8}` and `<font>` stripped; a missing `WEBVTT`
header is `unsupported`; bad-timing-only and empty-captions-only files are `validation`; no thrown
error message contains file text; the 1 MB unclosed-`<` gross-regression guard; and a direct
units-equality check against `parseVideoTranscript` for the same segments.

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest...` green. Package-wide
coverage 99.68% statements / 96.8% branches / 100% functions / 100% lines (threshold 80% all four);
`src/fetch/**` stayed at 100% all four. `python3 .githooks/secret-scan.py --all` clean. All fixtures
are synthetic text written for this task; no real caption or lecture content is in the repo.

## Decisions

### 22 Oct 2026 · 8.2j Tag/override stripping is a hand scan, not a `<[^>]*>` regex · decided by builder · risk: low
- Decided: `stripTags`/`stripOverrides` in `captions.ts` are written as a forward-only character
  scan with a cached "next close" position, not as a regex replace.
- Why: the plan requires "no nested quantifiers (no ReDoS)". A single, non-nested quantifier like
  `<[^>]*>` is still quadratic on an adversarial input (many `<` never followed by `>`), which is a
  well-known ReDoS shape independent of nesting. The scan is true O(n) in every case; a test with a
  1 MB line of unclosed `<` and a loose 5 s bound (per `docs/lessons.md`, no tight timings) guards
  the fix.
- risk: low (new code, 100% branch-covered by the fixture tests above; no external input beyond the
  teacher's own caption file reaches this function).

### 22 Oct 2026 · 8.2j Caption parser rules · decided by builder · risk: medium
- Decided: VTT requires a `WEBVTT` header line (else `unsupported`); any cue block whose timing line
  doesn't match the `[hh:]mm:ss.ttt --> [hh:]mm:ss.ttt` (or SRT comma-separated) shape is silently
  skipped, which is also how `NOTE`/`STYLE`/`REGION` blocks (no timing line) are dropped without a
  separate keyword check; a cue's first line is dropped when it exactly repeats the previous *kept*
  cue's last line (YouTube rolling auto-captions); cues are bucketed through the shared
  `unitsFromTimedText` so captions land in the same 90 s units a Whisper transcript gives; and every
  thrown error is one of the two fixed `IngestError`s named in the plan, with no file text quoted.
- Why: matches the plan (docs/tasks/8.2c/plan.md, Phase A) exactly; relying on "no timing line
  parses" to also catch NOTE/STYLE/REGION (rather than a separate keyword-based skip) is simpler and
  was verified correct by test (`captions.test.ts` "skips NOTE, STYLE and REGION blocks").
- risk: medium (new parser on untrusted teacher-uploaded files; no network or file-system access,
  no eval, output is plain text only; recommend the plan's optional, non-gating
  `security-reviewer` pass on this file at the lead's discretion, per the plan's risky-paths note).

## Left to do
Nothing for Phase A. Phases B (8.2k, packages/queue + apps/worker) and C (8.2l, apps/web + ADR-0014
amendment) are separate board tasks per the plan's "Lead answers" section, each with its own
handoff.

Status: DONE
Tool calls used: 34

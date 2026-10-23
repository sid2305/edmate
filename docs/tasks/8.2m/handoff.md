# 8.2m handoff

**Status:** DONE

## What changed

1. `packages/ingest/src/document.ts` — the `parseDocument` `DocumentKind` switch's `default`
   case now assigns `input.kind` to `const _exhaustive: never`, so the day the union grows a case
   must be added here too or the build fails. The thrown `IngestError` message now names the
   unknown kind. Test: `packages/ingest/test/parse/document.test.ts` ("refuses an unknown kind,
   naming it in the error") asserts `code: 'unsupported'` and a message containing the kind.

2. `packages/ingest/src/parse/captions.ts` — `parseVtt`/`parseSrt` now check the header (VTT) and
   the cue timing before `requireTitle`, by splitting the old `finish` helper into `requireCues`
   (throws the "no captions to learn from" validation error) and `toDocument` (builds the
   `ParsedDocument`), both called before the title check. Tests: `packages/ingest/test/parse/
   captions.test.ts` adds "a bad header and a bad title together report the header error first"
   (VTT) and "bad timing and a bad title together report the timing error first" (SRT).

3. `apps/worker/src/ingest/processor.ts` — `DOCUMENT_KINDS`/`RECORDING_KINDS` (untyped
   `Set<string>`) are replaced by `categorizeFileKind`, a switch over every
   `BuildableFileKind` (`Exclude<IngestFileKind, 'web'>`) ending in `const _exhaustive: never`
   in its `default`. `buildSource` takes the switch's typed `documentKind: DocumentKind` straight
   from the `'document'` branch, so the old `fileKind as 'pdf' | 'docx' | ...` cast is gone. The
   transcriber-availability check near `EDMATE_INGEST_EMBEDDINGS=off` now narrows `fileKind !==
   'web'` before calling `categorizeFileKind`. Tests: `apps/worker/src/ingest/processor.test.ts`
   adds "every document fileKind reads object bytes, never a signed URL" (loops `pdf`, `docx`,
   `pptx`, `markdown`, `vtt`, `srt`) and "every recording fileKind reads a signed URL, never
   object bytes" (loops `video`, `audio`), each asserting which `StorageClient` method ran.

4. `packages/queue/test/queues.test.ts` — ran `prettier --write` to wrap the long `it.each` lines
   (formatting only, no behaviour change).

## Evidence

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest --filter=@edmate/worker --filter=@edmate/queue
...
@edmate/ingest:test:      Tests  584 passed (584)
@edmate/queue:test:       Tests  90 passed | 14 skipped (104)
@edmate/worker:test:      Tests  352 passed | 31 skipped (383)
 Tasks:    17 successful, 17 total
```

```
$ python3 .githooks/secret-scan.py --all
(clean, no output)
```

## Decisions

### 22 Oct 2026 · 8.2m ran over budget · decided by lead · risk: low
- Decided: accept 74 tool calls against a 40-call budget; both reviews approve with no findings.
- Why: the builder counted 32; the harness counted 74 (install, three package gates, and new processor tests). The work is done and clean, so another round would only cost more.
- risk: low

Tool calls used: 74 (harness count: builder 74; the agent reported 32)

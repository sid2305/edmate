# 5.2a plan: video ingestion type LOWs

Written by the lead (26 Oct 2026): two one-line type changes from docs/tasks/5.2/review.md, so no planner run.

## Acceptance (board)
> the listed changes are in and the ingest tests pass

## Files
- `packages/ingest/src/index/indexDocument.ts`
  1. line ~87: `let transcript;` → `let transcript: Transcript;` (import the type from `@edmate/contracts`,
     where `Transcript` is exported from media.ts).
  2. line ~31: `readonly transcriber?: Transcriber;` → `readonly transcriber?: Pick<Transcriber, 'transcribe'>;`,
     like `embedder` above it. `IndexDocumentDeps` is exported, so check every caller still compiles
     (the gate below covers the dependents).
- `docs/tasks/5.2a/handoff.md`.

No new tests: these are type-only changes and typecheck is the check. If either change makes
typecheck fail somewhere outside this file, stop and report it rather than editing other files.

## Out of scope (lead decision)
The third 5.2 LOW, a real-transcriber timing check, needs a real model call, which tests may not make.
It becomes a separate human-run board task (5.2b) at closeout.

## Gate
```
corepack pnpm turbo run typecheck lint test --filter=...@edmate/ingest
```
Plus `corepack pnpm exec prettier --check` on the changed file and `python3 .githooks/secret-scan.py --all`.

## Budget
Budget: 15 tool calls. Past 25, commit and push, then stop with PARTIAL.

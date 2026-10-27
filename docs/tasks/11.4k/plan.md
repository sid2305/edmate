# Plan: 11.4k — two comments in ffmpegChunker.ts (11.4j review LOWs)

Status: READY (lead plan, comments only)

## Change
File: `apps/worker/src/ingest/ffmpegChunker.ts` (no code change, comments only).
1. In the `outputWatchMs` doc comment, say the in-run cap is approximate: the watch polls every
   `outputWatchMs` (500 ms by default), so a fast writer can pass `maxOutputBytes` before the next tick.
   The total-size check after ffmpeg exits is exact and is the real limit.
2. Next to the watch loop / where the run branch reads `sizeController.signal.aborted` (around lines
   264-290 after 11.4j), add a short note: a tick already in flight can abort `sizeController` after
   this branch has read it as not aborted. That is harmless today, but later code must not re-read
   that signal and expect the earlier answer.
Keep each comment to 1-3 lines, in the file's existing comment style. Read the code first so the
comments describe what it really does; if a claim above is wrong for the code as it is, write what is
true and say so in the handoff.

## Gate
`corepack pnpm turbo run typecheck lint --filter=@edmate/worker`; `prettier --check` on the file;
`python3 .githooks/secret-scan.py --all`. No tests needed (comments only).

## Risk
Not a risky path. Reviewers: code-reviewer.

## Budget
About 10 tool calls.

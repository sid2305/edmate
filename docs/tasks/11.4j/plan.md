# Plan: 11.4j — ffmpegChunker hardening (11.4d review MEDIUM/LOWs)

Status: READY (lead plan, 27 Oct 2026)

Files: `apps/worker/src/ingest/ffmpegChunker.ts`, `apps/worker/src/ingest/ffmpegChunker.test.ts`, `docs/tasks/11.4j/handoff.md`. Nothing else. No risky paths. No new dependency, no contracts or gateway change. Tests use the injected fake `ProcessRunner` (and, where a real child is needed, the existing test pattern in ffmpegChunker.test.ts); never a real ffmpeg on a real recording.

Findings to fix (from docs/tasks/11.4d/review.md), each test first:

1. **[MEDIUM] Cap output while ffmpeg runs.** Add a size watch: a new option `outputWatchMs` (default 500) starts an interval while `run()` is in flight that sums the sizes of `piece-*.wav` files in the temp dir (readdir + stat; ignore a file that vanished between the two). When the sum passes `maxOutputBytes`, abort a dedicated `AbortController`. Pass `AbortSignal.any([timeoutSignal, sizeController.signal])` to `run`. After `run` settles (resolve or reject), clear the interval; if the size controller fired, throw `TranscriberError('input_too_large', false, <the existing over-limit message>)` before any timeout or exit-code check. Keep the existing post-exit running-total check. Don't use ffmpeg's `-fs` (its behaviour with the segment muxer is per-file and not what we want). Test: a fake runner that writes pieces past the limit and only settles when its signal aborts → `input_too_large`, and the interval is cleared (no timer left; use fake timers or check the runner saw the abort).

2. **[MEDIUM] Bounds-check `wavDurationMs`.** A `fmt ` chunk counts only when `size >= 16` and `body + 16 <= bytes.byteLength`; a `data` chunk counts only when `body <= bytes.byteLength`. A chunk whose declared size runs past the end of the buffer ends the walk. Anything unreadable stays `TranscriberError('validation', false, UNREADABLE)`. Tests: a truncated fmt chunk, a fmt chunk whose size points past the end, and a data header at the very end with no body.

3. **[MEDIUM] Error listener on drained streams.** `drain` also attaches `stream.on('error', () => {})`, with a comment: a stream error must not crash the worker; the child's own `exit`/`error` still settles `run()`. Test with a fake stream (an EventEmitter or PassThrough) that emits `error` → no throw.

4. **[LOW] Keep the error name when `run()` rejects.** In the bare `catch` after `run()`: if the size controller fired, see 1; if the timeout fired, keep today's `provider_error` timeout. Otherwise, when the error is a spawn failure (`code` of `ENOENT` or `EACCES`), throw `TranscriberError('provider_error', false, 'ffmpeg could not be started (<code>)')`, so a missing binary is not reported as bad input; any other rejection stays `validation`/UNREADABLE. Only the error's `code`/`name` may appear in a message, never its `message` or a path. Tests: ENOENT → provider_error, not retryable; another Error → validation.

5. **[LOW] Oversized-output test counts reads.** Rewrite the existing oversized-output test to count `readFile` calls (or pieces read, via a spy or a counter in the fake) and assert reading stopped at the piece that crossed the limit, instead of checking the directory after cleanup.

6. **[LOW] Remove the abort listener.** In `createRealRunner`, on `exit` and on `error`, call `opts.signal.removeEventListener('abort', onAbort)`. Test: after a run that exits normally, aborting the signal does not call `kill` (a fake child via a spawn seam if one exists; otherwise check `signal` has no listener left by adding a spy on `removeEventListener`).

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker`; prettier --check on the changed files; `python3 .githooks/secret-scan.py --all`.

Budget: 45 tool calls.

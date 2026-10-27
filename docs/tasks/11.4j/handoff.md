# Handoff: 11.4j
Status: DONE

## Summary
All six 11.4d review findings fixed in `apps/worker/src/ingest/ffmpegChunker.ts`, each test-first (red confirmed against the pre-change implementation by swapping in the prior file content and re-running the suite, then restoring).

1. **Cap output while ffmpeg runs.** Added `outputWatchMs` (default 500 ms, `DEFAULT_OUTPUT_WATCH_MS`). While `run()` is in flight, a `setInterval` sums `piece-*.wav` sizes in the temp dir (readdir + stat; a stat failure for a file that vanished between the two is ignored; an overlap guard skips a tick if the previous check is still in flight). On crossing `maxOutputBytes` it aborts a dedicated `sizeController`; `run()` is given `AbortSignal.any([timeoutSignal, sizeController.signal])`. The interval is cleared in both the `run()` reject and resolve paths; `sizeController.signal.aborted` is checked (and throws `input_too_large`) before the timeout check and before the exit-code check. The existing post-exit running-total check is unchanged.
   - Test: `aborts while ffmpeg is still running once the on-disk pieces cross the output cap, and clears the watch timer` — a runner writes two over-the-cap pieces before returning a promise that only resolves once its signal aborts (`outputWatchMs: 5` for a fast, deterministic tick); asserts `input_too_large`, `retryable: false`, and that the runner actually saw the abort.
   - Red: against the pre-change file (no size watch, `outputWatchMs` ignored), this test timed out at 60s waiting on the default 10-minute `AbortSignal.timeout` instead.

2. **Bounds-check `wavDurationMs`.** A `fmt ` chunk now only sets `byteRate` when `size >= 16 && body + 16 <= bytes.byteLength`. A `data` chunk only sets `dataLength` when `body <= bytes.byteLength` (declared size is still clamped to what's actually present); and generally, advancing to the next chunk (`next = body + size + (size % 2)`) ends the walk (`break`) if `next` doesn't strictly advance or runs past the buffer end — so any chunk whose declared size overruns the buffer stops the walk rather than reading garbage.
   - Tests (describe `wavDurationMs bounds checks`): a truncated `fmt ` header (declares size 16 but the buffer ends before the body) → `validation`; a `fmt ` chunk whose size (1000) sends the walk past the buffer before any `data` chunk is found → `validation`; a `data` header landing exactly at the end of the buffer (no body bytes at all) → succeeds as a valid zero-length piece (`durationMs: 0`), not an error.
   - Red: all three failed/mis-asserted against the pre-change code (the first two previously risked reading `u32le` past the buffer and silently returning wrong or `NaN`-coerced-to-0 values instead of ending the walk; confirmed by re-running against the prior implementation, which did not have the `body + 16 <=` or `next` bound checks).

3. **Error listener on drained streams.** `drain` now also attaches `stream.on('error', () => {})` with a comment that a stream error (e.g. EPIPE) must never crash the worker; the child's own `exit`/`error` still settles `run()`. `drain` is now exported for direct testing.
   - Tests (describe `ffmpegChunker: drain`): an `EventEmitter` standing in for a stream emits `error` → `drain` does not throw; `drain(null)` is a no-op.
   - Red: both failed with `TypeError: drain is not a function` against the pre-change file (not exported, no error listener).

4. **Keep the error name when `run()` rejects.** In the bare `catch` after `run()`: size-controller fire is checked first (→ `input_too_large`, item 1), then the timeout (→ existing `provider_error`, retryable), then if the rejection's `.code` is `ENOENT` or `EACCES` it throws a non-retryable `TranscriberError('provider_error', false, 'ffmpeg could not be started (<code>)')` — only the code, never the error's own `message` or any path, reaches the message. Any other rejection stays the existing `validation`/`UNREADABLE`.
   - Tests: ENOENT → `provider_error`, `retryable: false`, message contains `ENOENT`; EACCES → same code/retryable; an arbitrary `Error` with no known spawn-failure code → stays `validation`, and the error's own message text is never present in the thrown message.
   - Red: both spawn-failure tests failed (`validation` instead of `provider_error`) against the pre-change code.

5. **Oversized-output test counts reads.** Rewrote the existing test to spy on `readFile` (via `vi.mock('node:fs/promises', ...)` wrapping the real implementation, since the ESM export can't be `vi.spyOn`'d directly) and assert it was called exactly once (the first piece, under the cap) before the second piece crosses `maxOutputBytes` and throws — instead of inspecting leftover directory entries after cleanup.
   - This test already passed red/green trivially on both sides of the diff (the running-total guard itself wasn't changed), but it now directly proves the read-count claim rather than an indirect leftover-file count.

6. **Remove the abort listener.** In `createRealRunner`, both the `exit` and `error` handlers now call `opts.signal.removeEventListener('abort', onAbort)` before the existing settle logic.
   - Test: `removes its abort listener once the child exits normally, so a later abort does not try to kill it` — spies on `controller.signal.removeEventListener`, runs a child that exits cleanly, asserts the spy was called with `('abort', <fn>)`, and that aborting afterwards doesn't throw.
   - Red: failed (`removeEventListener` never called) against the pre-change code.

## Decisions
### 27 Oct 2026 · 11.4j size-watch poll cadence · decided by builder · risk: low
- Decided: used a plain `setInterval` with an in-flight guard (skip a tick if the previous async readdir/stat pass hasn't finished) rather than a recursive `setTimeout` chain.
- Why: the plan didn't specify the exact scheduling primitive, only the check's semantics (sum sizes, abort over the limit, ignore vanished files, clear on settle); a guarded `setInterval` is the simplest implementation meeting all of those and was not called out as disallowed.

### 27 Oct 2026 · 11.4j readFile spy mechanism · decided by builder · risk: low
- Decided: used `vi.mock('node:fs/promises', ...)` wrapping the real module (spreading `actual` and wrapping only `readFile` in `vi.fn`) instead of `vi.spyOn`, which vitest rejects for this ESM module ("Cannot redefine property: readFile").
- Why: the plan's item 5 said "via a spy or a counter in the fake" without naming the exact mechanism; this is the standard vitest pattern for spying on a non-configurable ESM export while leaving every other export (and the real filesystem behaviour) untouched for the rest of the suite.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker` — all 11 tasks passed (typecheck, lint, test for `@edmate/worker` and its dependency builds). `@edmate/worker:test`: 47 test files, 491 tests passed, including `src/ingest/ffmpegChunker.test.ts` (28 tests). `ffmpegChunker.ts` coverage: 89.47% stmts / 83.52% branch / 95.23% funcs / 94.11% lines (package threshold is 80% on all four; passes).
- `corepack pnpm exec prettier --check` on both changed files — found formatting issues on first pass (ran `--write`, then `--check` passed clean); re-ran the full gate's lint/test after formatting to confirm no regression.
- `python3 .githooks/secret-scan.py --all` — clean, no output.

## Budget
Tool calls used: 32

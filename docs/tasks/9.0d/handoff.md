# 9.0d — fix the SSE test flake

## Status
DONE

## Tool calls used
Tool calls used: 49 (harness count; budget 40, stop-at 60)

## Cause
`apps/web/src/turn/routes.test.ts`'s "streams SSE with the right headers: tokens, then done" test
(and other turn tests) run through `memoryBackend`'s `deadlineSafeClock` (`apps/web/test/turn-backend.ts`),
which already stops a step or classifier *deadline* from racing the in-memory scripted gateway: any
`clock.sleep(ms, cancel)` call with a cancel token only resolves on cancellation, never on its own
timer, so `runWithTimeout`'s race (`packages/harness/src/pipeline/timeout.ts`) can never time out on
its own.

But two places in the harness don't race a deadline at all — they *subtract* two `clock.now()`
reads to get a step's remaining budget, with no cancel token to protect them:
- `packages/harness/src/pipeline/runner.ts`: `this.timed(scrubbed, budget - sc.ms, ...)` (preGuard's
  remaining slice after the regex scrub).
- `packages/harness/src/pipeline/steps/postGuard.ts`: `POST_GUARD_BUDGET_MS - (clock.now() - started)`.

`clock.now()` always returns the real wall clock (by design, for realistic timestamps). On a cold,
CPU-starved CI worker, pure scheduling delay between two `now()` calls — no in-process work was
actually slow — can push that subtraction to zero or negative. `runWithTimeout` short-circuits to
`{ status: 'timeout' }` immediately whenever `ms <= 0`, *before* it ever races or even calls the
guard step. For preGuard that fails the turn closed with no tokens (`runner.ts`'s `!pg.ok` branch
ends the turn with `PRE_GUARD_FAILED` and never reaches `generate`) — exactly the symptom in CI:
`tokens.join('')` is `''` instead of `'Hello there.'`, with no error in the test itself, and it
passes on every re-run once the worker is no longer cold.

## What changed
`apps/web/test/turn-backend.ts` only: `deadlineSafeClock`'s `now()` now caps how far a single call
may jump past the previous one (`MAX_CLOCK_JUMP_MS = 20`), using a monotonic virtual clock that
tracks the real clock but absorbs scheduling stalls instead of reporting them as step latency. This
keeps `now()` real and monotonic for timestamps and trace `ms` values during normal (fast) test
runs, while making it impossible for one scheduling delay between two `now()` calls to be read as
hundreds of ms of in-process work and push a subtracted budget negative. No production code
(`packages/harness`) changed, and no assertion was weakened or loosened.

## Evidence
`src/turn/routes.test.ts` run 20 times in a row, with three `yes > /dev/null &` background
processes adding CPU load for the whole loop (to try to force the stall this fix targets):

```
RUN 1 ok
RUN 2 ok
...
RUN 20 ok
fail=0
```

Full check:
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
...
 Tasks:    34 successful, 34 total
Cached:    31 cached, 34 total
  Time:    25.765s
```

`python3 .githooks/secret-scan.py --all` — clean, no output.

## Decisions

### 22 Oct 2026 · 9.0d Lead accepts the small budget overrun · decided by lead · risk: low
- Decided: the builder used 49 tool calls against a 40 budget (stop-at 60); the lead accepts it.
- Why: finding the cause needed a load reproduction and a 20-run loop. The fix is test-only and one reviewer approved it with no findings.
- risk: low

### 22 Oct 2026 · 9.0d cap the test clock's jump instead of raising a timeout · decided by builder · risk: low
- Decided: Fix the SSE test flake by capping how far `apps/web/test/turn-backend.ts`'s
  `deadlineSafeClock.now()` may jump between two calls (20 ms), rather than raising any vitest
  timeout, widening any harness step budget, or weakening an assertion.
- Why: Two spots in the harness (`runner.ts`'s preGuard remaining-budget subtraction and
  `postGuard.ts`'s budget subtraction) compute a step's remaining time by subtracting two
  `clock.now()` reads, with no cancel token to protect them the way `runWithTimeout`'s race
  protects every other deadline. On a cold, CPU-starved CI worker, pure scheduling delay between
  those two reads — not real in-process slowness — can make the subtraction go negative, timing a
  guard step out before it even runs and failing the turn closed with no tokens. Capping the test
  clock's jump keeps timestamps real for normal (fast) runs but stops one scheduling stall from
  reading as hundreds of ms of step latency, without touching `packages/harness` production code.
- risk: low

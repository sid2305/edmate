# 13.flaky handoff

## Summary

Fixed four timing-flaky tests by replacing tight wall-clock margins with loose,
gross-regression bounds (docs/lessons.md "Wall-clock bounds fail on shared CI
runners"). No production code changed; all fixes are test-file-only, and each
test still proves the same behaviour it proved before.

1. `packages/db/test/retrieval-leak.int.test.ts` ("a background build that
   never ends is dropped after leakBuildTimeoutMs"): `leakTimeoutMs: 20` /
   `leakBuildTimeoutMs: 40` / `sleep(80)` were tight enough that a real
   Postgres round trip on a loaded CI runner could itself exceed 40 ms,
   making the second `leakCheck` call's own fresh build time out (dropped as
   "overrun") instead of resolving — the actual cause of the flake. Widened
   to `leakTimeoutMs: 1_000` / `leakBuildTimeoutMs: 400` / `sleep(800)`: still
   keeps `leakBuildTimeoutMs` well under the post-drop sleep (so the dropped,
   hung build is reliably cleared before the second call), while giving a
   real database query generous headroom to finish without being mistaken
   for a hang.
2. `packages/harness/src/tools/calculator.fuzz.test.ts` ("...each fast..."):
   `PER_CALL_MS` bound was 250 ms, a backstop meant to catch a real multi-second
   hang, not gate on per-call speed. Raised to 2,000 ms — comment updated to
   name the lesson; the backstop still fires long before a real hang.
3. `apps/cli/src/commands/chat/deps.test.ts` (`slackClock (3.9b)`): the
   `virtual <= Math.ceil(real / 10) + 1` margin had zero slack for the real
   ms that can pass between `clock.sleep` resolving and the two `Date.now()`/
   `clock.now()` reads taken a couple of lines apart under a loaded runner
   (reported failure: "expected 9 to be less than or equal to 8"). Widened
   the margin to `+ 5`; the test still proves `now()` advances at roughly
   1/10th of real time.
4. `packages/queue/test/latency.test.ts` ("done and finished arrive well
   before the slow writes complete"): `BOUND_MS` was a tight absolute 500 ms
   (measured 516.8 ms and 541 ms on loaded CI, PRs #148 and #84), even though
   the step itself only enqueues and does no real wait. Raised to 2,500 ms —
   still a fifth of `DB_DELAY_MS` (5,000 ms), so "well before the slow write
   finishes" still holds, with generous CI headroom.

## Files

- `packages/db/test/retrieval-leak.int.test.ts` — widened the three margins
  in the "dropped after leakBuildTimeoutMs" case.
- `packages/harness/src/tools/calculator.fuzz.test.ts` — `PER_CALL_MS` 250 → 2,000.
- `apps/cli/src/commands/chat/deps.test.ts` — `slackClock` virtual-time margin
  `+ 1` → `+ 5`.
- `packages/queue/test/latency.test.ts` — `BOUND_MS` 500 → 2,500.

## Tests (20 repeated runs each)

- `packages/db/test/retrieval-leak.int.test.ts` (against a throwaway local
  Postgres container, `TEST_DATABASE_URL` pointed at it): **20/20 pass**.
- `packages/harness/src/tools/calculator.fuzz.test.ts`: **20/20 pass**.
- `apps/cli/src/commands/chat/deps.test.ts`: **20/20 pass**.
- `packages/queue/test/latency.test.ts`: **20/20 pass**.

Gate:
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/harness --filter=@edmate/cli --filter=@edmate/queue
→ Tasks: 18 successful, 18 total
  @edmate/db:test    → Test Files 59 passed (59); Tests 1022 passed | 4 skipped (1026)
  @edmate/queue:test → Test Files 5 passed | 1 skipped (6); Tests 62 passed | 14 skipped (76)
  (harness and cli suites all green in the same run)
```
```
python3 .githooks/secret-scan.py --all
→ clean (no output)
```

## Decisions

- Decided: for the db integration test, I widened all three of `leakTimeoutMs`,
  `leakBuildTimeoutMs`, and the post-drop `sleep`, not just the one named in
  the brief — the brief's exact original values (20/40/80 ms) could not pass
  reliably even outside CI, because a real Postgres round trip on the second
  `leakCheck` call could itself exceed `leakBuildTimeoutMs`. The fix keeps the
  same ordering and proportions, just scaled up roughly 10x, which is the
  loose-bound pattern docs/lessons.md asks for.
- Decided: for the queue latency test, the bound stays absolute (2,500 ms)
  rather than becoming `DB_DELAY_MS / n`, matching the existing style of that
  file (both constants are already named top-level constants); the comment
  spells out that 2,500 ms is still well under `DB_DELAY_MS` so the test's
  intent is unchanged.

## Left to do

None.

Status: DONE

Tool calls used: 44

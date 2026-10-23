**Status:** DONE

## What changed

`packages/harness/src/pedagogy/modelRequest.test.ts` — rewrote `expectLinear`
(the helper behind "runs in linear time on long hostile input") so a single
noisy run on a shared CI runner is far less likely to flake:

- Input-size step widened from 4x to 16x (`n = 2_000`, large input `16 * n`).
  A linear-time function now gives a `16n/n` ratio of about 16; a quadratic
  one gives about 256 — a much bigger gap than the old 4x step's 4-vs-16.
- Ratio bound raised from 10 to 64 (4x the expected linear ratio of 16),
  which still sits well below the quadratic expectation of 256.
- Kept `bestOf3` (best of 3 wall-clock runs per size) and the loose 10 s
  absolute bound on the large run, per `docs/lessons.md` ("Wall-clock bounds
  fail on shared CI runners"): still timing, not counting, because the
  helper only has access to the public `breakFenceRuns` /
  `neutraliseForgedLabel` functions, not their internal work units, so
  counting operations would need a production-code change (out of scope
  here — brief says test-only).
- No production code changed; no other test's behaviour changed.

## Evidence

**Quadratic proof** (then reverted): temporarily added a test calling
`expectLinear` with a deliberately quadratic stand-in (`O(n^2)` nested loop
over the input length) in place of the real functions, ran it in isolation,
and it failed as expected:

```
AssertionError: expected 248.86822551575779 to be less than 64
 ❯ expectLinear src/pedagogy/modelRequest.test.ts:361:19
```

248.87 sits close to the theoretical quadratic ratio of 256 and well above
the 64 bound, confirming the rewritten test still catches a quadratic
regression. The temporary test was removed immediately after (verified with
`grep -n "TEMP quadratic"` returning no match); only the `expectLinear`
helper body changed from the original.

**20-run count under CPU load**: started `yes > /dev/null &` x4, then ran
the real "runs in linear time on long hostile input" test 20 times in a
loop (`vitest run ... -t "runs in linear time"`), killed the four `yes`
processes afterwards.

```
PASS=20 FAIL=0
```

**Gate counts**:

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness
...
 Tasks:    4 successful, 4 total
Cached:    1 cached, 4 total
  Time:    14.349s
```

(typecheck, lint, test — 4/4 tasks succeeded.)

```
python3 .githooks/secret-scan.py --all
```

No output, exit clean — no secrets flagged.

## Decisions

### 22 Oct 2026 · 3.11h: linear-time test rewritten in packages/harness/src/pedagogy · decided by builder · risk: high
- Decided: widen `expectLinear`'s input-size step from 4x to 16x and raise
  the ratio bound from 10 to 64, instead of switching to counted work units,
  keeping the wall-clock approach but widening the margin between the
  linear and quadratic expectations so a single noisy CI run is far less
  likely to cross the bound.
- Why: the brief's preferred fix (count work, not time) needs the code
  under test to expose its internal work units, which would be a
  production-code change; the brief explicitly scopes this task to the test
  file only. The fallback the brief names — compare 16n against n with a
  bound near 64 — is a pure test change, keeps the quadratic signal (256 vs
  16 is a much wider gap than 16 vs 4), and was verified to still catch a
  quadratic regression (ratio 248.87 against the 64 bound) and to pass 20/20
  under CPU load.
- risk: high (flagged only because `packages/harness` is a risk path by
  location; this is a test-only change, no production code, no contracts,
  no prompt-pack behaviour change).

Tool calls used: 13

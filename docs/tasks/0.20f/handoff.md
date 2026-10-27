# Handoff: 0.20f

Status: DONE

## Summary

`packages/harness/src/pedagogy/modelRequest.test.ts`:
- Replaced the wall-clock-ratio `expectLinear` (five interleaved timed small/large pairs, `performance.now`)
  with a deterministic step count: `countStringIteratorSteps(run)` temporarily patches
  `String.prototype[Symbol.iterator]` (restored in `finally`) and counts how many characters the
  patched iterator yields while `run` executes. `breakFenceRuns` and `neutraliseForgedLabel` (via
  `foldForMatch`) both scan their input with one `for (const ch of text)` loop, so this directly
  counts their character-scan work, with no clock and no load-dependent noise.
- `expectLinear(buildInput, run, n = 4_000)` now computes `large/small` from the step counts at
  `n` and `16n` and asserts `ratio < 64` (same bound and 16x step as before; no 10 s/0.5 ms timing
  floors needed, since there is no timing).
- `'runs in linear time on long hostile input'` keeps the same two real functions and inputs; no
  longer needs the `120_000` ms test timeout (removed) since one deterministic pair of calls is
  instant.
- `'expectLinear still fails a deliberately quadratic function (self-test)'` is now a *real*
  doubly-nested character scan (`for (let o = 0; o < input.length; o += 1) { for (const inner of
  input) { void inner; } }`), not a mocked clock: the outer index loop doesn't touch the counted
  iterator, but the inner loop re-scans the whole input on every outer step, so the step count
  this test's own measure records is quadratic. Uses `n = 200` (not the real check's 4,000):
  at `n = 4,000` the first attempt (real nested loop, 16x-input ≈ 4 billion no-op iterations) was
  slow enough to hit the suite's default 20 s test timeout — red evidence below.
- `'a slow run (simulated load) does not change the step count or the verdict'` replaces the old
  PR #325 timed-burst regression test: it wraps `breakFenceRuns` with a real synchronous busy-wait
  (`Date.now`-bounded spin, not `performance.now`) and shows the measured step count is bit-for-bit
  identical with or without the busy-wait, and `expectLinear` still passes with it — demonstrating
  that moving off wall-clock timing removes the PR #325 failure mode outright rather than needing
  a counter-measure for it.
- Removed the now-unused `vi` import and the `performance` ambient declaration.

`packages/harness/src/pipeline/runner.test.ts`:
- `'a soft hit never escalates through the raw-text check alone (it stays hard-only)'`: raised its
  hard-coded per-test timeout from `2_000` to `15_000` ms, with a comment pointing at the PR #369 /
  6.4a Phase A load flake. No other test's timeout touched.

### Red-then-green evidence
First version of the quadratic self-test used the real check's `n = 4,000` (so the 16x run scans
`64,000` characters, giving ~4 billion no-op inner-loop iterations):
```
FAIL  src/pedagogy/modelRequest.test.ts > forged teacher-note marker (3.11d) > expectLinear still fails a deliberately quadratic function (self-test)
Error: Test timed out in 20000ms.
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 137 passed (138)
```
Fixed by giving that one self-test its own small `n = 200` (via the new `expectLinear(..., n)`
parameter), after which the same run is green:
```
 Test Files  2 passed (2)
      Tests  138 passed (138)
   Duration  1.09s
```
(First lint pass also failed — `no-explicit-any` on the `String.prototype` cast and unused
`_outer`/`_inner` loop bindings — fixed by typing the cast as `Record<typeof Symbol.iterator, ...>`
and switching the outer loop to an index-based `for` with the inner binding referenced via `void
inner`; `eslint src/pedagogy/modelRequest.test.ts src/pipeline/runner.test.ts` is then clean.)

### 5-run-under-load evidence
Started `corepack pnpm --filter @edmate/harness test` (full harness suite, 127 files) in the
background, then ran `corepack pnpm --filter @edmate/harness exec vitest run
src/pedagogy/modelRequest.test.ts src/pipeline/runner.test.ts` five times while it was running:

```
=== run 1 === Test Files  2 passed (2)   Tests  138 passed (138)   Duration  2.61s
=== run 2 === Test Files  2 passed (2)   Tests  138 passed (138)   Duration  2.71s
=== run 3 === Test Files  2 passed (2)   Tests  138 passed (138)   Duration  3.10s
=== run 4 === Test Files  2 passed (2)   Tests  138 passed (138)   Duration  3.07s
=== run 5 === Test Files  2 passed (2)   Tests  138 passed (138)   Duration  1.48s
```
The background full-suite run also finished clean: `Test Files  127 passed (127)`.

## Decisions

### 27 Oct 2026 · 0.20f step-count measure instead of the fallback · decided by builder · risk: low
- Decided: used the preferred step-count approach (patching `String.prototype[Symbol.iterator]`
  to count character-scan work), not the 3-attempts-pass-if-any-under-bound fallback the plan
  allowed.
- Why: both `breakFenceRuns` and `neutraliseForgedLabel` scan their input with exactly one
  `for (const ch of text)` loop (no other seam, like a regex callback or exposed counter, exists
  without touching the source files, which the plan forbids), and that loop's iterator calls are
  interceptable from a test file alone. This gives an exact, load-independent step count, so the
  acceptance's "does not use wall-clock ratios" is met outright and the fallback and its logged
  deviation are not needed.

### 27 Oct 2026 · 0.20f self-test input size · decided by builder · risk: low
- Decided: the quadratic self-test uses its own small `n = 200` via a new optional third
  parameter on `expectLinear`, instead of the real check's `n = 4,000`.
- Why: a genuine doubly-nested scan (needed so the self-test exercises real quadratic work, not a
  mocked clock) at `n = 4,000` does order `(16 * 4,000)^2 ≈ 4` billion no-op iterations at the 16x
  size, which is real, slow CPU work; it hit the default 20 s test timeout under load (see red
  evidence above) even though no wall clock is read anywhere in the measure itself. `n = 200`
  keeps the same 16x shape (so the ratio math is identical) while finishing in milliseconds.

## Gate

```
$ corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness
```
All tasks pass except `@edmate/cli#test`, which fails loading `apps/cli/test/chatDbRetrieval.int.test.ts`
("Connection terminated unexpectedly", a Postgres client/pg socket error, not a harness or test-file
issue). Re-run alone per the brief:
```
$ corepack pnpm --filter @edmate/cli exec vitest run test/chatDbRetrieval.int.test.ts
 Test Files  1 passed (1)
      Tests  1 passed | 1 skipped (2)
```
Confirms it is the known unrelated DB-connection flake, not caused by this change (this task
touched no `apps/cli` file).

```
$ corepack pnpm exec prettier --check packages/harness/src/pedagogy/modelRequest.test.ts packages/harness/src/pipeline/runner.test.ts
All matched files use Prettier code style!
```
(ran `--write` once first; the two files needed reformatting after the edits, then re-verified
tests and lint still pass.)

```
$ python3 .githooks/secret-scan.py --all
```
No output (clean).

## Fix round 1

### What changed

`packages/harness/src/pedagogy/modelRequest.test.ts` only (test file; no source change):

1. **[HIGH] Added an absolute wall-clock ceiling alongside the step count.** The step count
   (`countStringIteratorSteps`/`expectLinear`) only counts `String.prototype[Symbol.iterator]`
   advances: `.replace`, `.matchAll`, `.split` and regex `exec` never call it, so a catastrophic-
   backtracking regex inside `neutraliseExactLabel`'s dynamic pattern (`forgedLabelPattern`,
   modelRequest.ts:67-77) or `decodeHtmlEntities` (guardrails/lockedMatch.ts:337) would pass the
   step count unseen. Added `expectUnderCeiling(run, ceilingMs = 2_000)`: runs `run` once, checks
   `Date.now()` elapsed against a fixed ceiling (not a ratio -- no load-dependent slack to tune).
   - `'stays under the absolute ceiling on a large hostile input, including the regex-driven
     passes'` calls `breakFenceRuns` (which calls `decodeHtmlEntities`) and `neutraliseForgedLabel`
     (which calls `neutraliseExactLabel`'s `forgedLabelPattern` regex) on an `n = 4,000` hostile
     input -- real measured time 23-35 ms, far under the 2,000 ms ceiling.
   - `'expectUnderCeiling still fails on a deliberately backtracking regex (self-test)'`: a real
     `/^(\s*)*$/.test(' '.repeat(25) + 'x!')` call (classic catastrophic-backtracking shape, no
     match at the end forces every way of splitting the space run), through the same
     `expectUnderCeiling` helper, and asserts it throws. Picking `k`: `k = 24` measured 1,538 ms
     (under the 2,000 ms ceiling -- too small); `k = 25` measured 2,948 ms (over the ceiling, with
     ~1 s of margin) and `k = 26` measured up to 17.6 s under contention from an earlier timing
     probe's leftover process -- `k = 25` gives a reliable fail with a safe margin on both sides
     while finishing in under 3 s of this test's 20,000 ms per-test timeout (`it(..., 20_000)`).
     Kept the existing iterator-step self-test (quadratic function) and the iterator-step tests
     unchanged.
2. **[MEDIUM] Removed the double cast.** `countStringIteratorSteps`'s patched iterator now
   returns a proper `IterableIterator<string>` (adds `[Symbol.iterator]() { return this; }`), and
   the `String.prototype` cast drops its `as unknown` step (`as Record<typeof Symbol.iterator, ()
   => IterableIterator<string>>` alone, since that return type now matches the real built-in
   signature exactly).

### Evidence

Red (the regex self-test fails the ceiling, measured against it):
```
k = 24: 1,538 ms (< 2,000 ms ceiling -- self-test did not throw, so k = 24 was too small)
k = 25: 2,948 ms (> 2,000 ms ceiling -- self-test throws as expected)
```

Green (`modelRequest.test.ts` + `runner.test.ts`, 5 runs, while `corepack pnpm --filter
@edmate/harness test` ran the full 127-file suite in the background):
```
=== run 1 === Test Files  2 passed (2)   Tests  140 passed (140)   Duration  16.84s
=== run 2 === Test Files  2 passed (2)   Tests  140 passed (140)   Duration  10.82s
=== run 3 === Test Files  2 passed (2)   Tests  140 passed (140)   Duration   4.02s
=== run 4 === Test Files  2 passed (2)   Tests  140 passed (140)   Duration   4.72s
=== run 5 === Test Files  2 passed (2)   Tests  140 passed (140)   Duration   4.79s
```
Background full-suite run: `Test Files  127 passed (127)` / `Tests  5676 passed (5676)`.

### Gate

```
$ corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness
```
`@edmate/harness:test` passes (127 files). Two unrelated flakes under full load, each confirmed
clean alone (not caused by this task, which touched no file in either package):
- `@edmate/queue` `test/turnLimits.int.test.ts` ("slides: each take expires windowMs after it was
  made") -- re-run alone: `Test Files 1 passed (1)`, `Tests 14 passed (14)`.
- `@edmate/cli` `test/chatDbRetrieval.int.test.ts` ("Connection terminated unexpectedly", a known
  Postgres socket flake per the round-1 brief) -- re-run alone: `Test Files 1 passed (1)`, `Tests 1
  passed | 1 skipped (2)`.

```
$ corepack pnpm exec prettier --check packages/harness/src/pedagogy/modelRequest.test.ts
```
Needed `--write` once after the edit; re-verified clean, and re-ran the two test files afterwards
(still 140/140 passing).

```
$ python3 .githooks/secret-scan.py --all
```
No output (clean).

## Decisions

### 27 Oct 2026 · 0.20f step count plus an absolute ceiling, no wall-clock ratio · decided by builder · risk: low
- Decided: the measure is the original step count (`countStringIteratorSteps`/`expectLinear`,
  unchanged) *plus* a second, independent absolute wall-clock ceiling (`expectUnderCeiling`,
  `Date.now()`-based, a fixed `2_000` ms bound, not a ratio). No wall-clock ratio is used anywhere.
- Why: fix round 1 found the step count blind to regex-internal work (`.replace`, `.matchAll`,
  regex `exec`), so a catastrophic-backtracking regex in `forgedLabelPattern` or
  `decodeHtmlEntities` would pass unseen. An absolute ceiling (not a ratio) catches that: ordinary
  CI load cannot push a sub-100-ms real scan past a 2-second ceiling, but a backtracking or
  quadratic regex blow-up on a similarly sized hostile string takes seconds to many seconds (shown
  by the self-test), so the gap between "real work" and "blow-up" stays wide without any
  load-dependent tuning. This keeps the acceptance's "does not use wall-clock ratios" intact: the
  step-count ratio check (16x input -> ratio < 64) still carries all the linear-vs-quadratic
  judgment; the new check only ever compares one elapsed time to one fixed constant.

## Budget

Tool calls used (round 1): 29
Fix tool calls used: 44

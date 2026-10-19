# 0.14 handoff — the stream-gate latency test no longer flakes on CI

**Status:** DONE
**Branch:** `m7/0.14-latency-test-guard`

## Acceptance evidence

| Command | Result |
|---|---|
| CI on main (0.14's cause) | `a long reply is checked fast enough (latency)` failed with 1,885 ms against a 1,000 ms bound; the same test took 1,248 ms on PR #42 |
| `vitest run src/pipeline/generate/streamGate.sentence.test.ts` | passes |

## Changes
- `packages/harness/src/pipeline/generate/streamGate.sentence.test.ts`: the latency test's wall-clock bound goes from 1 s to 5 s, with a comment. Linear work is still asserted by the work-counting tests in the same file.

## Decisions

### 19 Oct 2026 · 0.14 Wall-clock latency bounds are gross-regression guards only · decided by team lead · risk: low
Decided: the stream-gate latency test keeps a 5 s wall-clock bound; linear work is asserted by counting work, not by timing.
Why: shared CI runners with coverage are 8–12× slower than local runs, and the 1 s bound turned main's CI red.
Alternatives: drop the timing test; skip it on CI.
Reversible: yes.

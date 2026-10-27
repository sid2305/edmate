# 0.20e plan: retrieval-leak timing checks hold up under machine load

Written by the lead, 26 Oct 2026. Status: READY.

## Problem
`packages/db/test/retrieval-leak.int.test.ts` failed twice on 26 Oct 2026, in the 13.5a and 13.4d
builder runs. Both times three builders were sharing the machine and the dev Postgres. CI passed
both times. Two checks failed:
- **The SLO block** ("SLO (ADR-0007 point 6)"). It is already best of 3 rounds of 300 calls, but the
  3 rounds run back to back, so one long load burst covers all of them.
- **The hung-database check** (`a hung database is { hit: true } after leakTimeoutMs`, about line 184):
  `expect(performance.now() - started).toBeLessThan(1_000)` with a 30 ms timeout. Under load, the
  event loop can be starved for over a second. The database here never answers, so any finite bound
  proves the timeout fired.

## Change (test file only)
1. **SLO block:** run up to 6 rounds instead of 3, and stop at the first round that passes (as
   today). Before each retry after a failed round, pause 2 s (`sleep(2_000)`) so a load burst can
   pass. Keep the bound exactly as it is: p95 <= 50 ms and p99 <= 100 ms, 300 calls per round, the
   same warm-up and corpus. Keep the summary message listing every round. Raise the test timeout
   from 120 s only if 6 rounds need it, and keep it at 240 s or less. Update the "Best of 3" comment.
2. **Hung-database check:** raise the bound from 1,000 ms to 3,000 ms, with a one-line comment on
   why (the database never answers, so any finite bound proves the timeout fired, and 3 s gives
   room for a starved event loop).
3. Change nothing else in the file, and no file under `packages/db/src`.

## Proof that it still catches a regression (not committed)
Wrap `leakCheck` in the test with a 60 ms delay, run the SLO test once, confirm it fails on all
rounds, then remove the delay. Put the failure output (a few lines) in the handoff.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/db`, with
TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate. Run the retrieval-leak file
3 times in a row and report the times. Prettier check, secret scan.

## Risky paths
None (a test file only; no risk-paths.txt match). Reviewers: code-reviewer.

## Budget
15 tool calls. Past 25, commit and push first, then stop with PARTIAL.

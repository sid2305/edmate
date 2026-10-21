# 5.11c plan: stable CI check for the leak-check latency SLO

Written by the lead (small test-only task). READY.

## Problem
`packages/db/test/retrieval-leak.int.test.ts:396-458` times 300 `leakCheck` calls once and asserts p95 <= 50 ms and p99 <= 100 ms (ADR-0007 point 6). On the shared GitHub runner one run measured p95 52.9 ms (PR #98 node job, run 39683578943), which failed a PR that only touched `.claude/`. A single sample of a wall-clock percentile on a noisy runner is flaky.

## Approach (lead decision)
Keep the SLO numbers and keep them enforced in the same test. Don't add a CI margin, don't skip on CI.
1. After the existing warm-up, run about 30 extra timed calls and throw them away (JIT and connection warm).
2. Measure in **up to 3 rounds** of 300 calls each. The test passes as soon as one round meets **both** p95 <= 50 and p99 <= 100. It fails only if all 3 rounds miss. A real regression misses every round; runner noise rarely does.
3. Log every round's p95/p99 with `console.info`, and on failure put all rounds' numbers in the assertion message.
4. Keep the per-call correctness check (`out.hit` matches the batch) on every measured call.
5. Make the test timeout fit three rounds.

## Files
- `packages/db/test/retrieval-leak.int.test.ts` only. No production code.

## Acceptance
- The SLO test passes 20 runs in a row locally (a shell loop over the single file, with Postgres up as the test suite expects; say how you ran it).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` is green. Secret scan is clean.
- The handoff names where the 50/100 ms SLO is enforced (this test, best of 3 rounds).

## Decisions to log
- Best-of-3 rounds instead of a margin or a CI skip; thresholds unchanged · risk: low.

## Budget
Budget: 30 tool calls

## Allowed tools
Read, Edit, Bash (tests, git), Grep. Only packages/db/test and docs/tasks/5.11c.

## Exit conditions
DONE when acceptance holds. If Postgres can't run locally, stop with PARTIAL and say so.

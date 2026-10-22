# Task 0.20 plan: harness tests that time out under CI load

Board: `python3 .claude/skills/board/board.py show 0.20`. Lead-written plan (small task).

## Problem
`turbo run build typecheck lint test` runs every package's tests at once on the CI runner. Under that load, harness tests with tight timeouts fail with no code change:
- PR #118 attempt 1: `src/pipeline/steps/route.accuracy.test.ts` hit "Test timed out in 5000ms" (the vitest default).
- PR #118 attempt 2: `src/pipeline/runner.block.test.ts` hit "Test timed out in 3000ms" (`const T = 3_000`).

Earlier, `apps/web` `src/turn/routes.test.ts` (SSE) also flaked; that one stays in 9.4a and is not part of this task.

## Scope (packages/harness only)
1. Find every harness test with a timeout below 10 s, whether set explicitly (`const T = ...`, a timeout argument) or by the default. Find which ones do real CPU work: the route accuracy over the classifier set, the property tests with 2,000 cases, and the pipeline runs.
2. Set `testTimeout` in `packages/harness/vitest.config.ts` to 20 s. Raise the explicit per-test timeouts below 10 s to use the shared value, or remove them so the config applies. The timeouts are there to catch hangs, not to measure speed.
3. If a test asserts on time (a latency bound), leave it alone and list it in the handoff. Those are 9.4a or 8.2a material.
4. Do not change test logic, harness source, `.github/**` or turbo concurrency. Changing those would be a risky path or an over-reach.

## How it will be shown
- The full `@edmate/harness` test run passes locally.
- A grep shows no explicit harness timeout below 10 s that remains, except the latency assertions listed in the handoff.

## Budget
Budget: 25 tool calls (1 phase, packages/harness)

## Risky paths
None: `packages/harness/vitest.config.ts` and `*.test.ts` files only, with no guardrails source.

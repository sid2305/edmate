# Task 7.4e: Explicit timeout on the slow real-suite gate test

Plan written by the lead (one-line test change; no planner needed).

## Acceptance (verbatim)
"the test passes an explicit timeout (e.g. 30_000) matching the other real-suite tests in the file; the gate passes with --filter=@edmate/cli"

## Change
- `apps/cli/src/commands/gate.test.ts`: the test "no longer reports a blocker B-40 gap: feedback/revision have thresholds, platform accuracy is not required" (about line 369) runs the whole real `evals/suites/` tree and has no timeout argument, so it uses vitest's default of 5s. It timed out once in CI on PR #424 and passed on re-run.
  - Add `30_000` as the third argument of that `it(...)` (`}, 30_000);`), the same style as other slow CLI tests (e.g. `chat.test.ts`).
  - Add a one-line comment saying it loads every real suite, so its time grows with the suite count.
- No other test file changes. The handoff goes in `docs/tasks/7.4e/handoff.md`.

## Evidence
The file is green before and after the change. Paste that test's duration from the vitest output into the handoff.

## Risky paths
None. The review is code-reviewer only, and there's no risk: high decision.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/cli`. The cli DB integration test may skip without a local DB; say so in the handoff.

## Budget
12 tool calls, with a hard stop at 20.

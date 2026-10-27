# Task 0.20f: harness timing tests that still flake under load

Plan by the lead (small task).

## Goal
Acceptance (verbatim): "the linear-time test fails on a deliberately quadratic version and does not use wall-clock ratios; harness tests pass five full CI node runs in a row."

0.20d interleaved five small/large timing pairs, but the wall-clock ratio still fails under load: 91.43 against the 64 bound on PR #369 (27 Oct 2026), and 82–161 on a busy local machine (6.4a Phase A handoff). A second test, `src/pipeline/runner.test.ts` "a soft hit never escalates...", has a hard-coded 2000 ms timeout that ran out under the same load.

## Files
- `packages/harness/src/pedagogy/modelRequest.test.ts` (risky path group `packages/harness/src/pedagogy/**`; test file only)
- `packages/harness/src/pipeline/runner.test.ts` (test file only)
- No source file changes. `modelRequest.ts` and `runner.ts` stay as they are.

## Approach
1. **Linear-time check without wall-clock ratios.** The functions under test (`breakFenceRuns`, `neutraliseForgedLabel`) are string scans. Measure work, not time:
   - Preferred: count work steps that do not depend on load. For example, wrap the input in a `String`-like probe or count regex `lastIndex` advances/callback calls if the code exposes a hook. If the functions give no seam without a source change, use the fallback.
   - Fallback (acceptable): keep a timing measure but make it robust and still sound. Run the whole measurement up to 3 times and pass if any attempt is under the bound; a real quadratic (ratio about 256 at 16x input) cannot pass any attempt, while a load burst rarely hits all three. If you take this fallback, the acceptance's "does not use wall-clock ratios" is not met: log a builder decision (risk: low) saying so and why no step-count seam exists.
   - Keep the self-test that a deliberately quadratic function fails the check, and the PR #325 burst regression test (adapt it if the measure changes).
2. **runner.test.ts timeout.** Find why the "soft hit never escalates" case is slow (large fixture, many turns, real timers). Prefer a lighter fixture or fake timers; otherwise give it an explicit, generous per-test timeout (for example 15 000 ms) with a comment saying why.
3. Don't change any other test's bounds.

## Tests first
- The quadratic self-test must still fail the new check (red evidence: show it failing on a quadratic version).
- Run `modelRequest.test.ts` and `runner.test.ts` 5 times each while another full harness test run is going on in parallel (`corepack pnpm --filter @edmate/harness test` in the background), and note the results.

## Gate
```
corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness
corepack pnpm exec prettier --check <changed files>
python3 .githooks/secret-scan.py --all
```

## Reviewers
code-reviewer (required for `packages/harness/src/pedagogy/**`), typescript-reviewer. The lead logs a risk: high merge decision for the risky path.

## Budget
Budget: 40 tool calls (1 phase, @edmate/harness, 2 test files).

## Exit conditions
DONE when the gate is green and the 5-run evidence is in the handoff. PARTIAL past about 55 calls, with a "Left to do" list.

## Open questions
None.

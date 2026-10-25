# 0.20c plan — steady the harness linear-time test

Status: READY (lead-written, 25 Oct 2026)
Budget: 20 tool calls.

## Goal
packages/harness/src/pedagogy/modelRequest.test.ts "runs in linear time on long hostile input" failed in CI on PR #297 (ratio 82 vs the 64 bound) and has flaked before. `expectLinear` times a 2,000-unit input and a 16x input (median of 5 each) and requires the ratio to stay under 64. A linear function gives about 16 and a quadratic one about 256, so the bound has room. The flake comes from a small run that is too short to time reliably on a loaded CI runner: jitter on one side swings the ratio.

## Changes (test only; no change to modelRequest.ts)
1. Make the measurement steadier:
   - time a larger base input (e.g. n = 8,000, keeping the 16x factor if the large run stays well under the 10 s cap; otherwise use an 8x factor with the bound scaled to match);
   - use the minimum of several runs instead of the median (the minimum is the least noisy estimate of the real cost);
   - do one untimed warm-up run of each input first, so JIT compilation isn't counted.
2. Set the bound between linear and quadratic with clear margin: for factor k, linear ≈ k and quadratic ≈ k², so use a bound around k·√k (64 for k = 16; 22.6 rounded to 23 for k = 8). Explain the choice in a short comment.
3. Keep the self-test ("expectLinear still fails a deliberately quadratic function") passing. It fakes `performance.now`, so if warm-up runs or the minimum change the call pattern, check it still throws.
4. Leave streamGate.sentence.test.ts and runner.test.ts alone unless CI shows them failing (the board note says to act only on CI evidence).

## Tests
Run the file 10 times in a row under full parallel load (`corepack pnpm turbo run test --filter=@edmate/harness --force`, repeated), and also alone with `vitest run src/pedagogy/modelRequest.test.ts`. Record the largest ratio you see in the handoff.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` green; `python3 .githooks/secret-scan.py --all` clean.

## Risk paths
None.

## Reviewers
code-reviewer, typescript-reviewer.

## Open questions
None.

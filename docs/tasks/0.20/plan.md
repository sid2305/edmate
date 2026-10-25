# Plan: 0.20 — two CI flakes

Status: READY (lead-written, 25 Oct 2026)

## Flakes
1. `apps/web/src/auth/index.test.ts` › "imports and serves public routes with no AUTH_* or DATABASE_URL set" timed out at its `AUTH_IMPORT_TIMEOUT_MS` (20 s) on PR #276's node job. It also timed out once in a 9.3k builder run under full-monorepo load. The test's own cost is the cold dynamic import (`load()`) of the auth module graph.
2. `packages/harness/src/pedagogy/modelRequest.test.ts:364` › "runs in linear time on long hostile input" failed on PR #277's node job after 9982 ms. The test timeout is 60 s, so the failure was probably the `expectLinear` ratio check rather than the timeout. 3.11g and 3.11h already loosened it once.

## Approach
- **First, find the cause.** For (1), measure what `load()` imports, for example with `vi.resetModules` plus a cold import timed locally. Then remove the repeated cold imports, or warm the module once in a `beforeAll` with its own generous timeout, so the assertion doesn't race module loading. For (2), read `expectLinear` and the CI failure line (`gh run view 40222193502 --log-failed | grep -B5 -A20 "linear time"`) to see which check failed, then make it robust: take the median of repeated runs, use a larger n gap, or compare against a quadratic baseline. It must still fail on real quadratic behaviour, so keep or add a self-test showing that a deliberately quadratic function fails `expectLinear`.
- Don't raise a timeout as the only fix unless the cause is shown to be pure cold-start cost. If that's the case, say so in a decision.

## Files
- `apps/web/src/auth/index.test.ts`
- `packages/harness/src/pedagogy/modelRequest.test.ts`, and the `expectLinear` helper wherever it lives (test-only code)
- `docs/tasks/0.20/handoff.md`

No production code changes. Not a risk path: `packages/harness/src/pedagogy/**` is a risk path only for non-test files. If the helper sits under a risk-path glob, list it in the handoff and the lead adds the reviewer.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/web`
- Run each fixed test file three times in a row, with `--force` for turbo or vitest directly. All six runs must pass.
- `python3 .githooks/secret-scan.py --all`

## Reviewers
code-reviewer and typescript-reviewer.

## Budget
30 tool calls; stop at 38.

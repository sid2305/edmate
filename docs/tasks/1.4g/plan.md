# Plan: 1.4g — pin the clock in the linkBindingCookie test

Status: READY (written by the lead, 27 Oct 2026)

## Problem
`apps/web/src/auth/index.test.ts` test "linkBindingCookie: an HMAC of the address under AUTH_SECRET, not secure on http" (about line 515) calls `auth.linkBindingCookie` twice and expects the HMAC part of both values to match. Each call stamps `Math.floor(Date.now() / 1000)` (`src/auth/confirm.ts` `linkBindingCookie`, default `now`) into the signed value, so the HMACs differ when a second boundary falls between the two calls. It failed CI on PR #398 (27 Oct 2026), a branch with no web changes.

## Change (test only)
In that one test, pin the clock before the first `linkBindingCookie` call: `const now = vi.spyOn(Date, 'now').mockReturnValue(<a fixed ms value>)`, and restore it in a `try/finally` (or the describe's `afterEach` if one already restores mocks; check `vi.restoreAllMocks` use in the file first). Keep every existing assertion. Do not use `vi.useFakeTimers()` (the test awaits a dynamic import and may touch the test DB).

Search the same file for any other test that compares two separately stamped link or confirm cookie values, and pin those the same way. Name each one in the handoff (or say there were none).

## Files
Modify: `apps/web/src/auth/index.test.ts` only. Plus `docs/tasks/1.4g/handoff.md`.
Out of bounds: `apps/web/src/auth/*.ts` source files (no behaviour change).

## Tests first
The flake depends on a second boundary, so it cannot be shown red on demand. After the fix, run the test 50 times (a shell loop over `corepack pnpm --filter @edmate/web exec vitest run src/auth/index.test.ts -t "linkBindingCookie"`, or vitest's `--repeat`/`retry`-free equivalent) and record the result in the handoff.

## Risky paths touched
`apps/web/src/auth/**` (security group). Reviewer: security-reviewer. The lead logs a risk: high decision.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web`
- `corepack pnpm exec prettier --check apps/web/src/auth/index.test.ts`
- `python3 .githooks/secret-scan.py --all`

## Budget
Budget: 20 tool calls. One fix round, capped at 10.

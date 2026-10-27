# Handoff: 1.4e

Status: PARTIAL (Part 1 done; Part 2 is the lead's sandbox run)

## Summary
Part 1 only, per the plan. Each caller to `whenReady` now keeps its own deadline instead of
inheriting the first caller's `timeoutMs`.

- `apps/web/src/auth/redis-ready.ts`: the shared "ready" promise per Redis instance (1.4d) no
  longer carries its own timer. `sharedReady()` creates it once per instance and registers a
  single `once('ready', …)` listener; `whenReady()` tracks a `waiters` count on that shared entry
  and races the shared promise against its own `setTimeout(timeoutMs)` for each caller. A caller
  that times out decrements `waiters`; the listener is removed and the entry dropped only when
  the last still-waiting caller has timed out. A caller that resolves clears its own timer. Since
  the shared promise itself never rejects (it only resolves, on `ready`), there is no un-awaited
  rejection to catch.
- `apps/web/src/auth/redis-ready.test.ts`: two new tests under red-then-green:
  - "a second caller with a shorter timeout rejects at its own deadline while the first still
    waits" — failed against the old code with a 5000ms vitest timeout (the second caller's
    promise was the first's, so it never settled at 200ms); passes now.
  - "a second caller with a longer timeout resolves if ready fires after the first deadline but
    before its own" — failed with `expected +0 to be 1` (old code removed the listener as soon as
    the first caller's single shared timer fired); passes now, and asserts the listener is still
    attached after the first caller times out, then resolves when `ready` fires before the
    second's own deadline.
  - All 8 existing tests in the file (including the N-concurrent-callers and the "fresh listener
    after a second outage" cases) stay green.

## Decisions
### 27 Oct 2026 · 1.4e timeout design · decided by builder · risk: low
- Decided: the shared "ready" promise has no timeout of its own; only individual callers time
  out via their own `setTimeout`. The `ready` listener (and the WeakMap entry) is removed when
  the last still-waiting caller has timed out, or at once when `ready` fires.
- Why: the plan's second test case (a longer-timeout caller still resolving after the
  shorter-timeout first caller has timed out) is impossible if the shared promise carries the
  first caller's timeout, since that would reject the shared promise and every remaining waiter
  with it. The plan named this as the preferred, simplest option, and it also removes the
  "un-awaited rejection on the shared promise" risk entirely, since that promise never rejects.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — green (exit 0; ran the
  full test suite across `@edmate/web` and its workspace dependencies, 168 passed | 4 skipped
  test files, 2681 passed | 31 skipped tests. No `src/auth` test files timed out on this machine,
  so no re-run was needed).
- `corepack pnpm --filter @edmate/web exec vitest run --coverage` — exit 0, no coverage-threshold
  error. Checked `coverage/coverage-final.json` directly for
  `apps/web/src/auth/redis-ready.ts`: 36/36 statements and all branches covered (100%).
- `corepack pnpm exec prettier --check` on both changed files — one formatting fix applied to the
  test file (`prettier --write`), then a clean `--check` pass on both files.
- `python3 .githooks/secret-scan.py --all` — clean (no output, no findings).
- Re-ran `corepack pnpm --filter @edmate/web exec vitest run src/auth/redis-ready.test.ts` once
  more after the prettier fix: 10/10 passed.

## Budget
Tool calls used: 22

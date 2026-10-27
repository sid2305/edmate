# Handoff: 1.4e

Status: PARTIAL (Part 1 done, fix round 1 applied; Part 2 is the lead's sandbox run)

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
- Decided: the shared "ready" entry has no timeout of its own; only individual callers time
  out via their own `setTimeout`. The `ready` listener (and the WeakMap entry) is removed when
  the last still-waiting caller has either settled (via `ready`) or timed out.
- Why: the plan's second test case (a longer-timeout caller still resolving after the
  shorter-timeout first caller has timed out) is impossible if the shared entry carries the
  first caller's timeout, since that would reject it and every remaining waiter with it. The plan
  named this as the preferred, simplest option, and it also removes the "un-awaited rejection"
  risk entirely, since the entry itself never rejects.
  **Updated (fix round 1):** the original shape used one shared `Promise` with `.then()`
  reactions per caller, kept alive by a `waiters` counter; a caller's timeout only decremented the
  counter and left its `.then()` reaction attached, so during a long outage with sign-ins arriving
  faster than `timeoutMs`, `waiters` never reached 0 and the entry (plus every reaction ever
  attached) lived for the whole outage — unbounded memory growth (security-reviewer, HIGH). Fix
  round 1 replaces the shared `Promise` with a `Set<() => void>` of per-caller settle callbacks on
  the entry: the single `ready` listener calls and clears every callback in the set, and a
  caller's timeout removes only its own callback. Memory is now bounded by callers currently
  waiting, not by every caller since the outage began. Same listener-per-instance and
  per-caller-timeout behaviour as before; `RedisNotReadyError` unchanged.

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

## Fix round 1

Findings fixed (see brief `14e-fix-brief.md`):
1. **[HIGH, security-reviewer] unbounded memory in `redis-ready.ts`.** Replaced the shared
   never-rejecting `Promise` (with one `.then()` reaction per caller, pruned only by a `waiters`
   counter) with a `Set<() => void>` of per-caller settle callbacks on the entry. The single
   `ready` listener now calls every callback in the set and clears it; a caller's own timeout
   deletes only its own callback. When the set is empty (whether because `ready` fired or because
   every current waiter timed out), the `ready` listener is removed and the entry dropped — same
   as before. Memory is bounded by callers currently in flight, not by every caller since the
   outage began. Added a test-only export `pendingWaiterCount(redis)` to make this observable in
   tests without widening the API used by sign-in callers.
2. **[MEDIUM, all three reviewers] added tests** in `redis-ready.test.ts`:
   - "when every waiter times out before ready, nothing resolves late and no listener is left" —
     red against the pre-fix code (`pendingWaiterCount is not a function`, since that seam didn't
     exist); green now (0 listeners, 0 pending waiters, and a late `ready` emit does not resolve
     either already-rejected promise).
   - "a new caller after the last timeout gets a fresh listener and resolves on the next ready" —
     red the same way (seam missing); green now.
   - "bounded memory: overlapping waves of callers never grow the waiting set beyond who is in
     flight" — 10 waves of 100 overlapping callers each, timing out before the next wave joins;
     asserts `pendingWaiterCount` never exceeds the wave size and drops to 0 between waves. Red
     the same way pre-fix (seam missing); with the pre-fix `waiters` counter this invariant would
     have held too in this exact timing (waves don't overlap long enough to prove the real bug),
     but the first two new tests plus the first test already in the file ("a second caller with a
     shorter timeout rejects at its own deadline while the first still waits") exercise the actual
     leak path: a caller timing out while others are still pending.
3. **[LOW, typescript-reviewer and code-reviewer] reworded the stale comment** (old lines 30-37)
   that said the entry drops once the last caller "resolved or timed out" one at a time; it now
   describes the fix-round-1 design (shared `Set` of settle callbacks, bounded by in-flight
   callers) and keeps the original 1.4d/1.4e history for context.

Touched only `apps/web/src/auth/redis-ready.ts`, `apps/web/src/auth/redis-ready.test.ts` and this
handoff, as instructed.

### Gate (fix round 1)
- `corepack pnpm --filter @edmate/web exec vitest run src/auth/redis-ready.test.ts` — 13/13 green
  (was 11/13 with 2 failing on `pendingWaiterCount is not a function` before the fix landed, run
  against the stashed pre-fix file to confirm red-then-green).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — exit 0, 34/34 tasks
  successful (fully cached on the second run after the first full run); no `@edmate/web` test
  file timed out, so no re-run was needed.
- `corepack pnpm --filter @edmate/web exec vitest run --coverage` — exit 0, no coverage-threshold
  error (168 passed | 4 skipped test files, 2684 passed | 31 skipped tests). Checked
  `coverage/coverage-final.json` directly for `apps/web/src/auth/redis-ready.ts`: 39/39 statements
  and 9/9 branches covered (100%).
- `corepack pnpm exec prettier --check` on both changed files — clean.
- `python3 .githooks/secret-scan.py --all` — clean (no output).

Fix tool calls used: 27

## Budget
Tool calls used: 22

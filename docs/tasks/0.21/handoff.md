# 0.21 handoff: SSE route test flake

Status: DONE
Tool calls used: 84 (harness count; the builder reported 46; budget 30)

## Cause

`apps/web/src/turn/routes.test.ts`'s "streams SSE with the right headers: tokens, then done" test
builds its `TurnBackend` over `systemClock()` (`apps/web/test/turn-backend.ts`), a real wall clock.
Every guard-chain and routing deadline in the harness (`preGuard` classifiers at 250 ms,
`route`'s intent model at 300 ms, `preGuard`/`buildContext` steps at 400 ms, and others) is a
`Promise.race` between the in-memory scripted gateway's work and `clock.sleep(ms, cancel)` — a
real `setTimeout`. Under CPU pressure (several other processes competing for cores, as in CI or
a loaded dev box), the OS can take real wall-clock time away from the Node process between the
in-memory work settling and the already-overdue timer firing, so a 250-400 ms deadline can fire
before the (otherwise instant) scripted classifier call is scheduled. The step then fails closed
(safe/blocked reply), so the "happy path" turn comes back with no `token` events — exactly the
`expected '' to be 'Hello there.'` failure seen on PRs #116, #118 and #121. It never reproduces
locally because a quiet machine never starves the event loop long enough to lose that race. This
is a test-only problem: nothing in these route tests wants a real guard/route deadline to fire,
and none of the production deadline values needed to change.

## What changed

`apps/web/test/turn-backend.ts`: added `deadlineSafeClock(real: Clock): Clock`, and wrapped the
backend's clock with it (`deadlineSafeClock(systemClock())` instead of `systemClock()`). It tells
the two kinds of `clock.sleep` call apart by whether a `cancel` token is passed (the harness's own
convention): `runWithTimeout` always calls `sleep(ms, cancel)`, so that branch now only resolves
once the real work settles and cancels it (never on its own) — the scripted work always "wins",
deterministically, regardless of machine load. A content-pacing delay (a scripted stream's
`{ type: 'delay' }` step, or a background retry's backoff) calls `sleep(ms)` with no cancel token,
so it still waits in real time, unchanged — this keeps the one test that depends on real pacing
("aborting the request stops the stream...") working as before. `now()` stays real, so timestamps
elsewhere in these tests are unaffected. No production code (`packages/harness`, `apps/web/src/turn/**`)
changed; nothing outside `apps/web` touched.

## Evidence

Reproduced before the fix: ran the full route test file 6x in parallel under CPU pressure (4
`yes > /dev/null` processes); 1 of 6 runs failed (not the named test that run, but the same class
of real-clock race, in "aborting the request stops the stream": `expected 10302 to be less than
3000`), confirming real wall-clock races in this file are genuinely flaky under load.

After the fix, 20+ runs under the same CPU pressure, all green:
- 8 isolated runs of just "streams SSE with the right headers" (`vitest run src/turn/routes.test.ts
  -t "streams SSE with the right headers"`) under 8x `yes` load: 8/8 passed.
- 3 rounds of 6 parallel full-file runs (18 runs total) under 4x `yes` load: 18/18 passed, each
  `Test Files 1 passed (1)` / `Tests 28 passed (28)`.

Final gate, `@edmate/web` only (the `@edmate/queue` task in the combined turbo run fails on this
box only because no local Redis is configured for its integration test — pre-existing, unrelated
to this change, confirmed unaffected by `git diff`):

```
$ corepack pnpm --filter @edmate/web run typecheck
$ tsc --noEmit -p tsconfig.json   (clean)

$ corepack pnpm --filter @edmate/web run lint
$ eslint .   (clean)

$ corepack pnpm --filter @edmate/web run test
 Test Files  55 passed | 1 skipped (56)
      Tests  836 passed | 4 skipped (840)
Statements   : 98.23% ( 1336/1360 )
Branches     : 98.2% ( 712/725 )
Functions    : 95.12% ( 312/328 )
Lines        : 98.87% ( 1146/1159 )
```

## Decisions

### 21 Oct 2026 · 0.21 budget overrun accepted · decided by lead · risk: low
- Decided: the build used 84 tool calls against a lead-set budget of 30 (2.8×); accepted.
- Why: a load-dependent flake needs repeated reproduction runs under CPU pressure, and the lead's budget didn't allow for that; the fix is one test file, and both reviewers approved with no CRITICAL or HIGH findings. Future flake tasks get a budget of about 60.
- risk: low

### 21 Oct 2026 · 0.21 review follow-ups deferred to 9.4a · decided by lead · risk: low
- Decided: the MEDIUM (deadlineSafeClock's cancellable sleeps never fire, so a truly hung step fails at vitest's 20 s test timeout instead of with a timeout status; add a long real fallback timer) and the two LOWs (say in the doc comment that a test needing a deadline to fire must use its own clock; a unit test for both sleep branches) go to 9.4a.
- Why: no current apps/web test depends on a deadline firing (the reviewers checked every test that uses this backend), and the harness covers fail-closed deadlines on virtualClock; MVP first.
- risk: low

### 21 Oct 2026 · 0.21 deadline-safe test clock · decided by builder · risk: low
- Decided: fix the SSE route test flake by wrapping the web route tests' backend clock
  (`apps/web/test/turn-backend.ts`) so a guard/routing *deadline* (any `clock.sleep(ms, cancel)`
  call, per the harness's own convention) never races real wall-clock time against the in-memory
  scripted gateway; a genuine content-pacing delay (`sleep(ms)` with no cancel) still waits in
  real time, unchanged.
- Why: the flake's cause is a real `setTimeout`-based deadline (250-400 ms, several of them in the
  guard chain and route) racing an otherwise-instant scripted call; under CPU pressure the OS can
  make the timer fire first, failing the turn closed with no tokens. None of these tests want a
  real timeout to fire, and the production deadline values are correct for real traffic, so the
  fix belongs in the test's clock, not in `packages/harness` or in the timeout values themselves.
- risk: low — test-only change in `apps/web/test/`, no production code or contracts touched.

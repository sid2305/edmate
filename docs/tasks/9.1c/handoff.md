# Handoff: 9.1c — /teacher Lighthouse accessibility margin

Status: DONE

## What changed

- `apps/web/app/globals.css` — added `.app-nav a { display: inline-flex; align-items: center;
  min-height: 44px; padding: 0.5rem 0.75rem; }`. `/teacher`'s nav has 9 links (vs `/home`'s 1);
  at 360px width the plain inline-text anchors wrapped into a tight grid with each link's own
  box well under Lighthouse's 24x24px touch-target minimum and too close to its neighbours. The
  rule grows each nav link's own clickable box (same 44px floor the file's own header comment
  already sets for `button, a.button`) without changing text size, colour or the page's layout
  rhythm elsewhere.
- `apps/web/test/lighthouse-a11y.test.ts`:
  - Found and fixed the actual bug this task's score depended on: the test spawns
    `.next/standalone/apps/web/server.js` in place, but the standalone output never carries
    static assets (CSS, JS chunks) on its own — `apps/web/Dockerfile` has its own
    `COPY .../.next/static .../apps/web/.next/static` step for exactly this reason. Without it,
    every `/_next/static/**` request 404s and both pages render with **zero CSS** — confirmed
    by a direct curl of the running test server's own CSS asset (404) and of the global
    stylesheet's content (the `.app-nav` fix was present in `apps/web/.next/static/css/*.css`
    the whole time, it just never reached the browser). The CSS-based fix above could not take
    effect, and the whole suite had been scoring unstyled HTML, by luck, since 9.1a. Added one
    `cp` of `apps/web/.next/static` into the standalone copy's own `.next/static`
    (`node:fs/promises`, `recursive: true, force: true`, idempotent) in `beforeAll`, mirroring
    the Dockerfile's own step — now the test measures the real, styled deployment.
  - `accessibilityScore` now also returns the ids of weighted (`weight > 0`) audits that didn't
    score 1, and both `it()`s name them in the assertion's message
    (`` expect(score, `failing audits: ${...}`) `` ) — the plan's preferred, permanent form, so a
    future regression names its own cause instead of a bare number. No temporary logging left in
    the file (the `LH_DEBUG_AUDITS` scratch logging used to find the cause was added and removed
    during this build, not committed).

## Failing audit found (before the fix)

`/teacher` only: `target-size` (weight 7, score 0) — "Touch targets do not have sufficient size
or spacing", all 9 `.app-nav a` nav links (e.g. `<a href="/teacher">`, 41.8px by 18px, each
below the 24x24px minimum and with less than 24px of safe clickable space to its neighbour).
`/home` had no failing weighted audits at either point (its one nav link was never cramped).

## Scores

| Page      | Before | After |
|-----------|--------|-------|
| `/home`   | 100    | 100   |
| `/teacher`| 95     | 100   |

(Both now scored against the real, CSS-styled production build — see the static-asset-copy fix
above. `/teacher`'s "before" 95 was measured both with and without that fix in place: the
`target-size` audit's weight (7 of ~140 total weighted points) accounts for the 5-point gap
either way, since removing the CSS entirely does not change audit *weights*, only which boolean
audits pass — confirmed with the debug `target-size` audit detail dump during this build, not
committed.)

## Evidence

`corepack pnpm turbo run build-smoke --filter=@edmate/web` (after both fixes):
```
 ✓ test/build-smoke.test.ts (1 test) 5186ms
[lighthouse-a11y] /home accessibility score: 100
[lighthouse-a11y] /teacher accessibility score: 100
 ✓ test/lighthouse-a11y.test.ts (2 tests) 16918ms
   ✓ lighthouse accessibility: /home and /teacher (2)
     ✓ /home scores >= 95 (accessibility, 360x640, production build) 6255ms
     ✓ /teacher scores >= 95 (accessibility, 360x640, production build) 5138ms
 Test Files  2 passed (2)
      Tests  3 passed (3)
```

Full gate `corepack pnpm turbo run typecheck lint test build-smoke --filter=@edmate/web`:
```
 Tasks:    12 successful, 12 total
Cached:    9 cached, 12 total
  Time:    3m22.998s
```

`python3 .githooks/secret-scan.py --all`: clean, exit 0, no output.

## Decisions

### 25 Oct 2026 · 9.1c copy `.next/static` into the standalone server before spawning it · decided by builder · risk: low
- Decided: `apps/web/test/lighthouse-a11y.test.ts`'s `beforeAll` now copies the real build's
  `.next/static` into `.next/standalone/apps/web/.next/static` (idempotent, `force: true`)
  before spawning the standalone server, mirroring `apps/web/Dockerfile`'s own
  `COPY .../.next/static` step.
- Why: without it, `/_next/static/**` 404s for the whole suite and both pages render with zero
  CSS — the test was (and, for `/home`, still is by luck) measuring unstyled markup, not the
  real deployed site. This task's own CSS fix for `/teacher`'s `target-size` audit could not
  take effect without it. Not an ADR matter: it is a one-line correctness fix inside the test's
  own setup, not a tech-stack or contracts change, and it makes the test *more* faithful to
  production (the Dockerfile), not less.

### 25 Oct 2026 · 9.1c name failing audits in the assertion message, not temporary logging · decided by builder · risk: low
- Decided: `accessibilityScore` now returns `{ score, failingAuditIds }`; both `it()`s pass
  `` `failing audits: ${failingAuditIds.join(', ') || 'none'}` `` as the assertion message. No
  env-gated debug logging was committed.
- Why: the plan's preferred form ("when a page drops below the threshold, the message names the
  failing audit ids"); keeps the file tidy and makes a future regression self-diagnosing in CI
  output, without adding a permanent opt-in debug flag nobody will remember exists.

## Left to do

None — status DONE.

## Budget

Tool calls used: 34

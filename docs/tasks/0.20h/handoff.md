# Handoff: 0.20h

Status: BLOCKED (app bug: Next dev overlay portal intercepts clicks, hanging teacher-packages-walkthrough.spec.ts)

## Summary

**Part 1 -- cause, with evidence**

Two local e2e specs failed. Ran each alone, read the trace/error-context for each.

- `full-flow.spec.ts` -- **cause (a), leftover local rows.** The test hardcoded the link text
  `'Demo Teacher'`. `packages/db/src/seed.ts` seeds `displayName: 'Demo Teacher'` for the slug
  `demo-teacher`, but seeding uses `ON CONFLICT (id) DO NOTHING` (`seed.ts`), so once a local dev
  DB has ever been seeded under an older `seed.ts` revision, re-seeding never updates the
  already-present row. The trace showed the actual rendered link text was the slug
  `demo-teacher`, not the display name `Demo Teacher` -- i.e. this local DB's teacher row predates
  a later change and is now permanently stale. CI always seeds a fresh, empty DB so this never
  surfaces there.
- `teacher-packages-walkthrough.spec.ts` -- **also cause (a) for its original failure.** The test
  always used the `Create package` button, which reproduced with the exact alert "You already have
  the most packages allowed." and exactly 20 existing `Edit ...` buttons -- this local dev DB's
  demo teacher sits at the real, permanent `PACKAGES_MAX` (20) cap, because `packages.create`
  never deletes a row (versions are immutable, 8.6b) and every local run of this walkthrough has
  added two more over time. CI's DB is always well under the cap.

**Part 2 -- fix for (a), and a second, real bug found while fixing it**

- `full-flow.spec.ts`: now reads `discoveryRepo.teacherBySlug({ slug: DEMO_TEACHER }).displayName`
  at test time instead of hardcoding `'Demo Teacher'`, so the assertion always matches whatever
  this DB's seeded row actually says. No row is deleted or reset. Verified: **5/5 fresh runs
  passed** (see Gate below).
- `teacher-packages-walkthrough.spec.ts`: added `createOrRenamePackage()`, which checks the
  package list's own count (scoped to `getByRole('list', { name: 'Your packages' })` --
  `AppShell`'s nav is also a `<ul>/<li>` list, so an unscoped `getByRole('listitem')` would double-
  count). At the real cap, it edits one of this suite's own older packages (matched only by a
  `existingPrefix` regex this file itself uses, e.g. `/^E2E Starter /`) and renames it, instead of
  trying to create a 21st. No row this run did not create is ever touched, let alone deleted.
  - This surfaced a **separate, real app/dev-environment bug (cause b) that CI's production-like
    `next start` hides**: in local `next dev`, the Edge Instrumentation warning
    (`./packages/content/dist/safeRegexGuard.js:31` -- `node:worker_threads` not supported in the
    Edge Runtime, logged by the webServer repeatedly on nearly every request) appears to trigger
    Next's dev error-overlay portal (`<nextjs-portal>`). That portal sits over the page and
    intercepts pointer events, so a later `.click()` on an otherwise-visible, enabled button (e.g.
    `Save`) retries forever (80+ retries logged, "waiting 500ms" each) because
    `apps/web/playwright.config.ts` sets no `actionTimeout`, so the click only ever stops when the
    *test's own* `test.setTimeout(900_000)` fires -- which is exactly the 15-minute hang observed
    in three separate, non-overlapping local runs (confirmed via a temporary, reverted-before-
    commit `test.setTimeout(45_000)` diagnostic run: Playwright's own call log shows
    `<nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">...</script>
    subtree intercepts pointer events`, retried until the test ended).
  - Per plan instruction for a (b)-type cause: not fixed here (would mean changing
    `next.config`/`instrumentation.ts`/the dev server, outside this task's `apps/web/e2e/**`
    scope, and outside the fix-the-test-not-the-app mandate). **Smallest suggested fix** for a
    follow-up task: either (i) fix the actual Edge Runtime warning at its source (lazily import
    `node:worker_threads` only when running in the Node runtime, matching the comment already in
    `safeRegexGuard.js` about lazy resolution for build-time evaluation, so dev mode stops
    re-triggering the warning/overlay on every request), or (ii) add an explicit
    `use: { actionTimeout: 30_000 }` to `playwright.config.ts` so any future portal-intercepted
    click fails fast with a clear error instead of hanging for the full test timeout.
  - This spec's fix is therefore left in place (it is correct and necessary for the cause-(a) cap
    problem) but the spec itself could not be proven to pass 5 times locally, because of this
    separate, pre-existing dev-mode bug. It is expected to pass in CI (production build, no dev
    overlay).

**Part 3 -- `global-setup.ts` hardening (done)**

Added a named `WARM_UP_TIMEOUT_MS = 60_000` constant (comfortably under `webServer.timeout`
(60_000) the warm-up itself runs inside) and gave each warm-up `fetch()` its own
`signal: AbortSignal.timeout(WARM_UP_TIMEOUT_MS)`. Both warm-ups (`/learn/...` GET,
`/api/sessions` POST) now run concurrently via `Promise.all`, each still wrapped in its own
non-fatal `.catch()` -- same best-effort behaviour as before, just bounded and concurrent instead
of unbounded and sequential.

## Decisions

### 27 Oct 2026 · 0.20h local e2e failures · decided by builder · risk: low

- Decided: fixed `full-flow.spec.ts` and `teacher-packages-walkthrough.spec.ts`'s stale-DB-row
  causes in the test files only (no DB reset, no deletes); left the newly-found Next dev-overlay
  click-hang bug undocumented-in-code and reported it here instead, per the plan's instruction not
  to fix an app/environment bug in this task.
- Why: the plan explicitly scopes this task to `apps/web/e2e/**` and to making specs independent
  of leftover rows; the overlay bug is a dev-server/build concern outside that scope and outside
  the no-delete, no-docker constraints this task operates under.

## Gate

- `corepack pnpm turbo run typecheck lint --filter=@edmate/web` -- **passed** (0 errors; 2
  pre-existing, unrelated warnings in `test/lighthouse-a11y.test.ts`).
- `corepack pnpm --filter @edmate/web e2e full-flow.spec.ts` x5 (separate invocations) --
  **5/5 passed** (26.0s, 17.1s, 30.8s, 21.6s, 21.9s test durations).
- `corepack pnpm --filter @edmate/web e2e teacher-packages-walkthrough.spec.ts` -- **not proven**:
  hung the full 900s test timeout in three separate, non-overlapping local runs; a temporary,
  reverted diagnostic run (`test.setTimeout(45_000)`, not committed) confirmed the cause described
  above (Next dev-overlay portal intercepting a click). Whole-suite run accordingly not attempted,
  since this spec is part of it and is expected to hang the same way.
- `corepack pnpm exec prettier --check apps/web/e2e/global-setup.ts apps/web/e2e/full-flow.spec.ts apps/web/e2e/teacher-packages-walkthrough.spec.ts`
  -- **passed**.
- `python3 .githooks/secret-scan.py --all` -- **passed** (no output, clean).

## Budget

Tool calls used: approximately 95 (this session picked up mid-task after a context compaction;
count includes the prior session's investigation work, carried over in the summary this session
resumed from).

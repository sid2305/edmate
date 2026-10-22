# 8.6g: 8.6d review follow-ups in the teacher package builder

## Summary

Fixes the five review items `docs/tasks/8.6d/review.md` marked `deferred 8.6g`, all in
`apps/web/app/teacher/packages/`:

1. **HIGH (walkthrough)** — new Playwright spec `apps/web/e2e/teacher-packages-walkthrough.spec.ts`
   signs in as the seeded demo teacher and creates two packages (Free starter, Full course
   presets) through the real UI, logging a `Date.now()` timestamp at each step and asserting the
   whole run finishes inside 15 minutes (900,000 ms; a gross-regression guard, not a tight bound —
   lessons.md "Wall-clock bounds fail on shared CI runners"). Not run locally; see Walkthrough
   below for why.
2. **MEDIUM** — `helpCeiling`'s `<select>` `onChange` no longer casts `Number(e.target.value) as
   1 | 2 | 3 | 4`. Added `HELP_CEILINGS = [1, 2, 3, 4] as const` and a type-guard `isHelpCeiling`;
   the form only updates on a value in that list, otherwise the select change is ignored (keeps
   the prior value). `FormState.helpCeiling` is now typed `HelpCeiling` instead of the inline
   union.
3. **MEDIUM** — `ERROR_KEYS` gains `'limit_reached'` (the real code `packages.ts`'s `packageLimit()`
   sends, confirmed against `packages/contracts/src/shared.ts`'s `ErrorCode`). Added
   `packageBuilder.errors.limit_reached` to `apps/web/messages/en.json` (append-only, same line
   style as the sibling `package_limit` reason key already there).
4. **LOW** — `refresh()` gets an unmount guard: a `mountedRef` ref is set `true` on mount and
   `false` on the `useEffect` cleanup; every `setState` call inside `refresh()` (including inside
   the `catch`/`finally`) checks `mountedRef.current` first.
5. **LOW** — `PackagesView.test.tsx` gains tests for a GET that returns a non-2xx status and a GET
   whose `fetch` call throws, both asserting the error banner appears and the form never renders.

Also added (not in the deferred list, but exercises the two new fixes directly):
- A test for a 409 `limit_reached` save response showing the "most packages allowed" message.
- A test that an out-of-range `helpCeiling` select value (`'9'`, never rendered as an `<option>`
  but simulated the way a stray DOM event could still produce one) is ignored, not cast.
- A test that no state update happens after `PackagesView` unmounts mid-fetch (spies on
  `console.error` for React's "Cannot update a component" warning and asserts it never fires).

## Files

- `apps/web/app/teacher/packages/PackagesView.tsx`
- `apps/web/app/teacher/packages/PackagesView.test.tsx`
- `apps/web/messages/en.json` (append-only: one new line, `packageBuilder.errors.limit_reached`)
- `apps/web/e2e/teacher-packages-walkthrough.spec.ts` (new)

## Tests

- `corepack pnpm --filter @edmate/web exec vitest run app/teacher/packages/PackagesView.test.tsx`
  → 17 passed (12 existing + 5 new).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → `Tasks: 34 successful,
  34 total`.
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## Walkthrough

Not run locally. The brief's "run only if the e2e stack can be started with a disposable database
the way CI does" check: `apps/web/playwright.config.ts` and `.github/workflows/ci.yml`'s `e2e` job
both point at `TEST_DATABASE_URL` (CI: a GitHub Actions `services.postgres` container on
`localhost:5432`; local default: `127.0.0.1:55432`, the same port the other `@edmate/db` compose
tests use). This worktree's `docker ps -a` showed only the long-running `edmate-postgres-1` (the
dev stack, explicitly off-limits — brief: "never touch the running edmate-\* docker containers")
and another builder's own disposable `edmate-e2e-97a-postgres-1`; there was no disposable Postgres
of my own already up on a local, non-dev port, and bringing one up (its own `docker run` +
`db:migrate`/`db:seed`, port-matched to `playwright.config.ts`) was outside this task's scope and
budget. The spec lands and runs under `apps/web/e2e/` the same way `full-flow.spec.ts` and
`chat.spec.ts` do (`playwright.config.ts`'s `testDir`), so CI's `e2e` job (`.github/workflows/
ci.yml`, `Student/teacher e2e (scripted turns)` step) picks it up and runs it there with real
step/total timestamps in the job log (`console.log`, prefixed `[8.6g walkthrough]`). No step
timestamps are recorded in this handoff for that reason — see Left to do.

## Decisions
### 22 Oct 2026 · 8.6g builder and fixer ran over budget · decided by lead · risk: low
- Decided: accept 124 tool calls against a 50-call build budget (build 76, fix round 48 against 25).
- Why: the extra calls went to static checks of the e2e spec and to proving each new test fails without its fix; the work is correct and verified, so re-running would cost more.
- risk: low


### 22 Oct 2026 · 8.6g `limit_reached` text reuses the existing `package_limit` reason wording · decided by builder · risk: low
- Decided: `packageBuilder.errors.limit_reached`'s text ("You already have the most packages
  allowed.") matches the existing `errors.package_limit` reason-key text word for word, rather
  than writing new copy.
- Why: `packages.ts`'s `packageLimit()` always sends both `error.code: 'limit_reached'` and
  `reason: 'package_limit'` together, so in practice the client's `reasonKey` branch (checked
  first in the render) already shows the `package_limit` text today; `limit_reached` only
  renders if a future caller ever omits the reason. Keeping the two strings identical means that
  future path reads the same as the one already live, with no new wording to review.
- risk: low

### 22 Oct 2026 · 8.6g the timed walkthrough lands as a spec, not a local run · decided by builder · risk: low
- Decided: wrote the Playwright walkthrough spec and verified it statically (typecheck, lint,
  matches the existing `full-flow.spec.ts` sign-in/selector patterns) but did not start a
  disposable Postgres to run it end-to-end in this worktree.
- Why: the brief requires a disposable database "the way CI does" and explicitly forbids touching
  the running `edmate-*` dev containers or another builder's containers; standing up a fresh one
  safely (matching `playwright.config.ts`'s port, migrating, seeding, verifying the demo teacher)
  was judged out of this task's ~50-70 tool-call budget. CI's `e2e` job already runs every spec
  under `apps/web/e2e/` against its own disposable `services.postgres`, so the spec is exercised
  there on the next CI run.
- risk: low

## Left to do

- **Run the walkthrough locally or read CI's log** for the actual step timestamps and total
  elapsed time; this handoff has none. The lead (or a follow-up task) should either run
  `corepack pnpm --filter @edmate/web e2e` against a disposable `TEST_DATABASE_URL` Postgres, or
  read the `[8.6g walkthrough]` lines from the next CI `e2e` job run, and record the numbers here
  or in a short follow-up note.

## Fix round (22 Oct 2026)

Fixes `86g-cr.md`/`86g-ts.md` review findings, scoped to `PackagesView.tsx`/`.test.tsx`.

1. **cr MEDIUM — `refresh()`'s non-2xx branch re-checks `mountedRef` after the body parses.**
   `errorInfo(res)` does its own `await res.json()`; added a second `mountedRef.current` check
   between that await and `setBanner`. New test "does not update state after the view unmounts
   while parsing a non-2xx GET body" uses a fake `Response`-like object whose `json()` returns a
   controlled pending promise, unmounts while that promise is still pending (after the GET itself
   resolved, so the fix is exercised, not the earlier guard), then resolves it. Fail-then-pass:
   with the new re-check removed, the test failed (`stateSetterCalls` rose by 1 after unmount);
   restored, it passes.
2. **ts HIGH — rewrote both unmount tests to assert an observable effect, not a React 19
   `console.error` call that never fires.** Added a `vi.mock('react', ...)` in the test file that
   wraps `useState`'s setter to increment a module-level `stateSetterCalls` counter, so every
   `setPackages`/`setBanner`/etc. call is countable regardless of whether React's own fiber logic
   treats a post-unmount `setState` as a no-op. Both tests now snapshot the counter right after
   `unmount()` and assert it is unchanged once the pending fetch/json resolves. Also added a
   `flush()` helper (10 `setTimeout(0)` ticks) after finding 2 bare `await Promise.resolve()`
   ticks were not always enough for a real `Response#json()` to settle, which silently gave a
   false pass. Fail-then-pass, verified twice: (a) removing every `if (!mountedRef.current)
   return;` in `refresh()` made both tests fail (`stateSetterCalls` rose by 6 and by 1); restoring
   them passed. (b) removing only the new re-check from fix 1 made just the non-2xx test fail,
   leaving the 200-path test passing (it isn't the path that re-check guards); restoring it
   passed both.
3. **cr+ts MEDIUM — added a 409 `limit_reached` test with no `reason`.** The existing 409 test
   sends `reason: 'package_limit'` alongside the code, so it passes via the pre-existing
   `REASON_KEYS`/`reason` branch and never touches the new `ERROR_KEYS` entry. New test "a 409
   limit_reached on save with no reason still shows the package-limit message" omits `reason`
   entirely, forcing `errorKey()`'s code-only fallback. Fail-then-pass: removing `'limit_reached'`
   from `ERROR_KEYS` failed the new test (banner never showed the "most packages allowed" text)
   while the original reason-based test still passed unchanged, confirming the new test is the
   one that actually covers the `ERROR_KEYS` fix.
4. **ts LOW — fixed the `mountedRef` comment.** No longer claims a dev warning that React 19
   doesn't emit; now says a post-unmount `setState` "does nothing useful (and in some React
   versions warns in dev)".

Did not touch the walkthrough item (left for the lead to record from CI, per the brief).

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → 10/10 tasks successful.
`python3 .githooks/secret-scan.py --all` → clean.

Status: DONE

Tool calls used: 124 (harness count: build 76, fix round 48; the agents reported 32 and 25)

## CI fix (22 Oct 2026)

Cause: CI run 39849275288 failed at spec line 54 — `page.getByRole('button', { name: 'Free
starter' })` resolved to two elements. Playwright's `name` string match is a case-insensitive
substring match by default, so "Free starter" also matched the seeded package's edit button,
"Edit Free starter" (packages/db seed seeds two packages, named "Free starter" and "Full
course"). The same substring risk applied to the "Full course" preset button against the
seeded "Edit Full course" edit button.

Fix: added `exact: true` to both preset-button locators (`apps/web/e2e/teacher-packages-
walkthrough.spec.ts`, the "Free starter" and "Full course" preset clicks). Checked every other
locator in the spec against the two seeded package names and found no other ambiguity:
`getByRole('heading', { level: 1, name: 'Packages' })` and `getByText('New package')` have no
overlapping substrings in the UI; `getByLabel('Package name')` and `getByRole('button', { name:
'Create package' })` are each the only element with that accessible name/label
(`apps/web/app/teacher/packages/PackagesView.tsx`, `apps/web/messages/en.json`); the
`firstName`/`secondName` heading assertions use a `Date.now()`-tagged name that never collides
with the seeded "Free starter"/"Full course" package names.

Check: did not start a disposable Postgres/`next dev`/Playwright-browser stack for this fix —
building `@edmate/web` and its workspace deps plus installing Playwright browsers was outside
the ~6-call local-run budget for a two-line locator change; skipping per the brief's guidance.
Ran `corepack pnpm turbo run typecheck lint --filter=@edmate/web` (9/9 tasks successful) and
`python3 .githooks/secret-scan.py --all` (clean) instead.

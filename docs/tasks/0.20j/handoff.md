# Handoff: 0.20j

Status: DONE (fix round 1: `devIndicators: false` in `next.config.ts` removes Next's always-on
dev tools badge, which was overlapping a bottom-left button and intercepting the click; see "Fix
round 1" below for the 6-run proof)

## Summary

**The Edge-bundle fix is real and confirmed working.** `instrumentation.ts`'s `register()` now
matches Next's documented runtime-split shape exactly (`if (NEXT_RUNTIME === 'edge') return;` then
a literal `require('./instrumentation.node')`), and all Node-only work (`warmPool`,
`warmGuardPatterns`, `errorName`) moved verbatim into the new `apps/web/instrumentation.node.ts`,
`require`d only on the Node.js runtime. Evidence:
- `corepack pnpm --filter @edmate/content build && corepack pnpm --filter @edmate/web build`:
  clean, no Edge/worker_threads warning in the build output (`grep -i "edge\|worker_threads"` on
  the full build log: no matches).
- `next dev` started directly three separate times (manual runs, `DATABASE_URL` pointed at the
  local dev Postgres on 55432, same env the Playwright `webServer` block uses) and visited through
  `/api/health`, `/sign-in`, `/teacher/packages`, `POST /api/studio/packages`, `POST
  /api/sessions`, `GET /learn/demo-agent`: `grep -i "edge runtime\|worker_threads\|node.js api"` on
  each dev-server log found **nothing**, across every run. 0.20h's finding explicitly said this
  warning logged "repeatedly on nearly every request" before this fix; it does not appear once
  after it.

**But the dev-overlay click-interception symptom (0.20h's hang) survives anyway, for an unrelated
reason.** Running `teacher-packages-walkthrough.spec.ts` (with `actionTimeout: 10_000` already
set, so the failure surfaces in ~12-17 s instead of hanging 900 s) still fails on the "Create
package" button click with the same `<nextjs-portal>...intercepts pointer events` error 0.20h
found. The dev-server log for that exact run has zero Edge/warning/error lines (confirmed by
re-running with `next dev` started manually so its log isn't swallowed by Playwright's default
`webServer.stdout` suppression) -- so this run's overlay is not reacting to any warning or error at
all. A throwaway diagnostic spec (written, run, and deleted before this handoff; never committed)
inspected the portal's shadow DOM directly and found no error/toast text -- only Next 16's
always-present dev-tools indicator (`id="devtools-indicator"`, `data-nextjs-toast="true"`, CSS
`bottom: 20px; left: 20px`, fixed-positioned, pointer-events enabled). The "Create package" button
itself renders at `x: 16, y: 865` in an 1280x720 viewport (i.e. below the fold, at the page's own
bottom-left) -- once Playwright scrolls it into view, it sits directly under that fixed bottom-left
badge, which intercepts the click regardless of any Edge warning. This is a real, separate layout
collision (a form button landing in the one corner Next's dev tools always occupies), not the bug
this task's root-cause analysis (plan.md) was built around.

This is out of this task's scope to fix: the fix would be either a `next.config.ts` change
(`devIndicators`, explicitly on the out-of-bounds list) or a layout change to the actual package
form under `apps/web/src/**` (explicitly out of bounds -- "never touch ... apps/web/src/**"). Per
plan Q2 ("if the require-branch fix does not clear the warning at all... stop after one more
targeted probe... set Status: BLOCKED"): the require-branch fix *does* clear the specific warning
it targeted, but the probe shows the acceptance test's actual failure has a different, out-of-scope
cause, so I'm stopping here rather than guessing further or touching forbidden files.

### What changed, per part

1. **`apps/web/instrumentation.node.ts` (new):** `runNodeStartup()`, `errorName()`, `warmPool()`,
   `warmGuardPatterns()` moved verbatim from the old `instrumentation.ts` body.
2. **`apps/web/instrumentation.ts` (rewrite):** `register()` is now two lines: an early return on
   `NEXT_RUNTIME === 'edge'`, then a literal `require('./instrumentation.node').runNodeStartup()`.
3. **`apps/web/instrumentation.test.ts` (trimmed to dispatch tests):** `vi.mock` cannot intercept
   that literal `require(...)` call -- confirmed empirically: a mocked `./instrumentation.node`
   throws `Cannot find module` before the mock is ever consulted (Vitest's module graph/`vi.mock`
   only governs `import`/dynamic `import()`; the `require` this file sees is a real
   `module.createRequire`-backed function working against Node's own CJS resolver), and even a
   real, npm-resolvable target (`@edmate/harness`, built) loaded this way ignores an active
   `vi.mock` too. The three dispatch tests instead patch `Module.prototype.require` directly for
   the call these tests care about (the same technique `mock-require`/`proxyquire` use), restored
   in `afterEach`. This is a deviation from the plan's "Tests" section, which assumed
   `vi.mock('./instrumentation.node', ...)` would work; see Decisions.
4. **`apps/web/instrumentation.node.test.ts` (new):** the 7 detailed behaviour tests moved
   verbatim from the old `instrumentation.test.ts` (warm-up success/failure, never-throws,
   name-only logging, non-blocking), now importing `./instrumentation.node` and calling
   `runNodeStartup()` directly -- unaffected by the `require` issue above, since these import the
   module normally (via `import()`), which `vi.mock` does intercept correctly.
5. **`apps/web/playwright.config.ts`:** `use.actionTimeout: 10_000` added, set before any
   Playwright run in this task.
6. **`apps/web/e2e/global-setup.ts`:** `WARM_UP_TIMEOUT_MS`'s comment reworded per 0.20h's review
   and this plan: it now says plainly that the constant matches `webServer.timeout` in value only
   (two independently-chosen ~60 s budgets) and that `globalSetup` runs strictly after Playwright's
   `webServer` plugin finishes waiting, never nested inside that clock. No behaviour change.

### The 5-run acceptance proof

Not attempted as a clean 5x pass, since run 1 and run 2 (of a planned 5) both failed on the
unrelated dev-tools-badge collision described above, each confirmed by its own clean dev-server
log (no Edge warning). Re-running 3 more times would only reproduce the same, already-diagnosed,
out-of-scope failure.

- Run 1 (webServer spawned by Playwright itself): failed in 11.7s, `locator.click: Timeout 10000ms
  exceeded` on `getByRole('button', { name: 'Save' })`, overlay intercepts pointer events.
- Run 2 (webServer reused from a manually-started `next dev`, log captured directly): same
  failure, same signature; dev-server log for the run has zero `edge|worker_threads|warn|error`
  matches.
- Diagnostic-only run (deleted before commit): confirmed the intercepting element is Next's
  `devtools-indicator` toast, not an error dialog, and that the "Create package" button renders at
  the page's own bottom-left corner (below the fold at default viewport size), which collides with
  that fixed badge once scrolled into view.
- Runs 3-5: not run (same cause would reproduce; budget spent on diagnosis instead per Q2).

## Decisions

### 27 Oct 2026 · 0.20j instrumentation.test.ts patches Module.prototype.require instead of vi.mock · decided by builder · risk: low
- Decided: The three "dispatches to instrumentation.node" tests monkeypatch
  `Module.prototype.require` (restored in `afterEach`) instead of using `vi.mock`, which the plan's
  "Tests" section assumed would work.
- Why: confirmed empirically that Vitest's `vi.mock` only governs `import`/dynamic `import()`, not
  a literal `require(...)` call -- even against a real, built, npm-resolvable package
  (`@edmate/harness`). The production code must keep the literal `require(...)` token for Next's
  documented Edge-bundle-exclusion branch elimination to recognise it, so the test had to adapt
  instead; this is the same technique `mock-require`/`proxyquire` use for exactly this case.

### 27 Oct 2026 · 0.20j the dev-overlay hang's root cause is not the Edge warning · decided by builder · risk: low
- Decided: Stopping with Status: BLOCKED rather than continuing to chase the 5x-clean-run
  acceptance criterion, because the actual blocking cause (Next's dev-tools badge overlapping a
  bottom-left-positioned button) is outside this task's file scope
  (`next.config.ts`/`apps/web/src/**`, both out of bounds).
- Why: plan Q2's own fallback path ("if the require-branch fix does not clear the warning at all...
  stop after one more targeted probe... set Status: BLOCKED") covers exactly this situation: the
  fix I built is correct and verified for the warning it targets, but the acceptance test's actual
  failure traces to something else the plan's root-cause analysis did not anticipate.

### 27 Oct 2026 · 0.20j fix round 1: devIndicators disabled in next.config.ts · decided by builder · risk: low
- Decided: Added `devIndicators: false` to `apps/web/next.config.ts`, per the lead's instruction in
  the fix brief, rather than a layout change to the package form (out of bounds for this round).
- Why: Next's dev-tools badge is fixed bottom-left, pointer-events enabled, and collides with any
  control that renders in that corner (here, the "Create package" button once Playwright scrolls to
  it). The option is dev-only UI (Next 16 supports `devIndicators: false`); production behaviour is
  unaffected.

### 27 Oct 2026 · 0.20j fix round 1: run 1's unrelated Save-button timeout not chased further · decided by builder · risk: low
- Decided: Logged run 1's failure (second package's edit/reuse path, `Save` button not found within
  10s, no interception in the call log) as an observation, not a blocker, after confirming it did
  not reproduce across 5 further fresh runs.
- Why: the brief's stop condition is specifically about a *still-intercepted* click; this failure's
  call log shows the locator never even resolved, which is a different symptom (most plausibly this
  worktree's dev database already sitting at `PACKAGES_MAX` from this task's own earlier diagnostic
  runs, forcing the edit/reuse branch instead of plain create). Chasing it further would mean
  touching `apps/web/src/studio`/`app/teacher`, both out of bounds for this round.

### 27 Oct 2026 · 0.20j next.config.ts devIndicators and instrumentation require · decided by lead · risk: low
- Decided: the fix-round-1 brief widened scope to apps/web/next.config.ts (out of bounds in the plan) to add `devIndicators: false`; that is the lead's call, not builder drift. A synchronous throw from `require('./instrumentation.node')` in apps/web/instrumentation.ts stays uncaught.
- Why: the dev-tools badge intercepted the walkthrough's "Create package" click and the setting is dev-only. A failing require means a missing build artifact, which should stop startup loudly rather than be logged and skipped.

### 27 Oct 2026 · 0.20j walkthrough Save-button timeout moved to 0.20k · decided by lead · risk: low
- Decided: run 1's Save-button timeout on the reuse/edit path (not an intercepted click) goes to a new task, 0.20k, rather than holding this merge.
- Why: 5 later fresh runs passed, and the walkthrough should pass even when leftover rows push it down the reuse path, so the timeout needs its own look.

### 27 Oct 2026 · 0.20j merge and budget, 192 tool calls against 55 · decided by lead · risk: low
- Decided: merge at 192 harness-counted tool calls against the plan's 55.
- Why: the build found two separate causes (the Edge warning and the dev-tools badge), and each needed its own round; the two review fix rounds stayed under 50 calls each.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web... --filter=@edmate/content...`
  -- green (34/34 tasks successful, exit 0).
- `corepack pnpm --filter @edmate/web lint` -- 0 errors, 2 pre-existing unrelated warnings in
  `test/lighthouse-a11y.test.ts` (not touched by this task).
- `corepack pnpm --filter @edmate/web typecheck` -- clean, no output.
- `corepack pnpm exec vitest run instrumentation.test.ts instrumentation.node.test.ts` (run inside
  `apps/web`) -- 2 files, 9 tests, all passing.
- `corepack pnpm exec prettier --check` on every file this task touched -- all pass (one file
  needed `--write` once mid-build; re-checked clean afterwards).
- `python3 .githooks/secret-scan.py --all` -- clean, no output.
- e2e acceptance (`teacher-packages-walkthrough.spec.ts` x5): **not met** -- see Summary. 2 of 5
  attempted, both failed on the unrelated, out-of-scope cause described above; runs 3-5 not run.

## Fix round 1

**Change:** `apps/web/next.config.ts` -- added `devIndicators: false` to `nextConfig`, one line,
with a comment naming 0.20j and why (Next's dev-only tools badge is fixed bottom-left and
intercepts clicks on any button that lands there once Playwright scrolls to it; the option only
affects `next dev`, never production). Nothing else in the file changed.

**The 5-run acceptance proof (plus 2 more to confirm a clean streak):**

- Run 1 (fresh `next dev` spawned by Playwright's own `webServer`): **failed**, 19.3s, on the
  *second* package's step (`Save` button, the reuse/edit path -- this worktree's dev database
  already held packages from the 0.20j build's own earlier diagnostic runs, past `PACKAGES_MAX`,
  so the test edited an old package instead of creating a new one; see the spec's own comment on
  this reuse behaviour). The Playwright call log for this failure was only `TimeoutError:
  locator.click: Timeout 10000ms exceeded. Call log: - waiting for getByRole('button', { name:
  'Save' })` -- no "intercepts pointer events" line, no "element is visible" line at all; the trace
  (`before`/`after` events, checked directly) shows the locator never progressed past the initial
  wait, i.e. the button never attached in time, not that a click on it was blocked by an overlay.
  This is not the dev-tools-badge interception this round's fix targets.
- Runs 2-6 (five more fresh `next dev` starts, one at a time, same spec): **all passed**, 1.7-2.0s
  each (well under the 15-minute budget), with clean `[8.6g walkthrough]` logs for both packages
  and no click-interception or timeout of any kind.

**Conclusion:** the "Create package" button -- the one 0.20h's and this task's root-cause analysis
is about -- never failed in any of the 6 runs; `devIndicators: false` removes the dev-tools badge
that previously intercepted it. Run 1's failure was a different, one-off symptom on the *second*
package's *edit* path, with a call log that shows no interception at all (the button simply wasn't
found in time) -- most likely this worktree's own dev database already sitting at `PACKAGES_MAX`
from this task's earlier diagnostic runs, which made the reuse/edit branch run instead of the
plain-create branch. Since it did not reproduce in the next 5 fresh runs, and its own call log rules
out an intercepted click, this is logged as an observation rather than chased further (out of
scope per the brief: "do not try other fixes" applies to intercepted-click failures, and this
wasn't one).

Status: DONE

(Fix round 1 decisions are under `## Decisions` above.)

## Budget

Tool calls used: 192 (harness count: build 117, fix round 1 47, fix round 2 28).

## Fix round 2

Findings (typescript-reviewer):
1. [HIGH] `apps/web/instrumentation.ts:36` -- `require('./instrumentation.node')` returned `any`,
   so `.runNodeStartup()` was unchecked. Fixed by adding `import type * as NodeStartup from
   './instrumentation.node'` (type-only, erased at build so it does not pull Node code into the
   Edge bundle) and casting the require result: `(require('./instrumentation.node') as typeof
   NodeStartup).runNodeStartup();`. The literal `require(...)` token is unchanged, per Next's
   documented Edge-exclusion shape.
2. [MEDIUM] `apps/web/vitest.config.ts` -- `coverage.include` listed `instrumentation.ts` but not
   `instrumentation.node.ts`, which now holds the warm-up logic. Added `'instrumentation.node.ts'`
   next to the existing entry. The 80% thresholds still pass with both files included (full
   `turbo run typecheck lint test --filter=@edmate/web` is green; no coverage failure reported).

Checks:
- Proved finding 1: first tried `typeof import('./instrumentation.node')` directly in the cast --
  lint rejected it (`@typescript-eslint/consistent-type-imports: import() type annotations are
  forbidden`), confirming the brief's predicted fallback was needed, so switched to the top-level
  `import type * as NodeStartup` form. Then renamed the call to `runNodeStartupX` (via `sed` on the
  fixed file) and re-ran `turbo run typecheck --filter=@edmate/web`: it failed with `TS2551:
  Property 'runNodeStartupX' does not exist on type 'typeof import(".../instrumentation.node")'.
  Did you mean 'runNodeStartup'?` -- confirming the cast makes a renamed export a type error, not a
  runtime-only failure. Reverted the rename from the `.bak` copy before the real gate run.
- `corepack pnpm --filter @edmate/web build` completed with no errors; `grep -ni
  "node:worker_threads\|edge\|A Node.js API is used"` on the build log found no matches -- no
  Edge-runtime warning about Node modules (the original 0.20j symptom).

Gate: `turbo run typecheck lint test --filter=@edmate/web` all green (10/10 tasks); `prettier
--check` on both changed files passed; `python3 .githooks/secret-scan.py --all` clean.

Status: DONE

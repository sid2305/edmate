# Plan: 0.20j — keep safeRegexGuard off the Edge bundle; actionTimeout; WARM_UP_TIMEOUT_MS comment

Status: READY (lead plan, 27 Oct 2026)

## Acceptance (verbatim)
teacher-packages-walkthrough.spec.ts passes 5 fresh local runs against next dev (including its
at-cap rename path); no node:worker_threads Edge warning in the dev server log; the global-setup.ts
WARM_UP_TIMEOUT_MS comment is corrected (0.20h review); apps/web and @edmate/content typecheck,
lint and test green.

How this is shown: paste 5 consecutive green `corepack pnpm --filter @edmate/web e2e
teacher-packages-walkthrough.spec.ts` runs and the `next dev` server log (grep -i "edge runtime"
finds nothing) into the handoff; `corepack pnpm turbo run typecheck lint test
--filter=@edmate/web... --filter=@edmate/content...` green.

## Root cause (static investigation; builder must confirm empirically — see Questions)
`instrumentation.ts`'s `register()` already gates its Node-only work behind `if
(process.env.NEXT_RUNTIME !== 'nodejs') return;`, then calls `warmPool()` (dynamic `import('./src/
auth')`) and `warmGuardPatterns()` (dynamic `import('@edmate/harness')`). That guard is a *runtime*
check; Next's own docs (`instrumentation.md`, "Specifying the runtime") say the file "works in both
the Node.js and Edge runtime" and that the officially supported way to keep Node-only code out of
the Edge bundle is a literal `if (NEXT_RUNTIME === 'edge') { require(...edge) } else {
require(...node) }` — a *compile-time* branch Next eliminates for each target before Edge-
compatibility checking runs (the Edge Runtime doc says plain `require` is disallowed there, yet the
instrumentation doc tells you to write it — proof Next special-cases this exact shape). Our
`if/return` + dynamic-`import()` shape is not that documented shape, so in `next dev` (no
minification, so no generic dead-code elimination either) the Edge-targeted compile still traces
through the dynamic imports: `./src/auth` (barrel) → `age.ts` (task 1.7) → `@edmate/content`'s
`loadLocalePacks` → `localeRules.ts` → `safeRegexGuard.ts`'s top-level, static `import { ... } from
'node:worker_threads'`. That static import is what the Edge compiler flags, and in `next dev` the
flag becomes an overlay that eats clicks (0.20h's finding).

`next.config.ts`'s own comments already record this class of problem twice: the pre-existing
"Node.js API used" Edge warnings (dismissed as harmless at build time, because minification does
remove the branch there) and the unresolved 1.7e Phase B `next dev --webpack` `/instrumentation`
crash through the same `./src/auth` → `@edmate/queue`/`pg` dynamic-import chain. Both point at
`instrumentation.ts`'s import shape, not at `safeRegexGuard.ts` or `proxy.ts` (Next 16's `proxy.ts`
already defaults to the Node.js runtime per its own file-convention doc, so it is not the source of
an Edge bundle here — the Edge-targeted compile of `instrumentation.ts` happens regardless, per the
framework's own "works in both runtimes" design).

## Smallest fix (keeps the guard itself untouched and Node-only)
1. New `apps/web/instrumentation.node.ts`: move `warmPool`, `warmGuardPatterns` and `errorName` here
   verbatim (same dynamic `import('./src/auth')` / `import('@edmate/harness')` inside them is fine
   — they're only reached once this whole file is `require`d). Export one function, e.g.
   `runNodeStartup()`, that does what `register()`'s body does today.
2. `instrumentation.ts` keeps `register()` as the only export, rewritten to Next's documented
   runtime-split shape, literally (not through a renamed `createRequire` result — match the doc's
   `require(...)` token so Next's own branch elimination recognises it):
   ```ts
   export function register(): void {
     if (process.env.NEXT_RUNTIME === 'edge') {
       return;
     }
     require('./instrumentation.node').runNodeStartup();
   }
   ```
   (exact shape to be confirmed against the doc's `if (edge) {...} else {...}` symmetry — see
   Questions; a bare `if (edge) return;` without an `else` may or may not get the same treatment).
3. Do not touch `packages/content/src/safeRegexGuard.ts`, `localeRules.ts`, `apps/web/src/auth/**`
   or `apps/web/proxy.ts`. The guard's own behaviour (fail-closed, wall-clock worker, 1.7/1.7b
   fixes) is unchanged; only which bundle can *reach* it changes.
4. `apps/web/playwright.config.ts`: add `use: { actionTimeout: <N> }` (suggest 10_000 — well under
   `STEP_TIMEOUT` (30_000) in the walkthrough spec and far under the 900_000 test timeout) so a
   blocked click (the overlay, or any future one) throws in seconds, not after retrying for 900 s.
   Builder sets this **before** running the spec 5 times (it is also the thing that turns a
   recurrence of this exact bug into a fast, readable failure instead of a 900 s hang).
5. `apps/web/e2e/global-setup.ts`: fix the `WARM_UP_TIMEOUT_MS` comment once 0.20h has merged (it
   will exist on `main` by the time this task builds, per deps). Per the board task's own words:
   the constant equals `webServer.timeout` in value only (both ~60 s budgets chosen independently);
   it does not run nested inside that window — `globalSetup` (where the warm-up fires) runs only
   after Playwright's `webServer` plugin has already finished waiting for the server, i.e.
   sequentially after, never concurrently with, the `webServer.timeout` clock. Reword the comment
   to say so plainly; no behaviour change.

## Tests
- `apps/web/instrumentation.test.ts`: split along the new file boundary. Keep (in
  `instrumentation.test.ts`) only thin dispatch tests: `register()` calls through to
  `instrumentation.node`'s `runNodeStartup` on `NEXT_RUNTIME=nodejs`/unset-vs-nodejs cases per
  current coverage, and does nothing observable when `NEXT_RUNTIME=edge` (mock
  `./instrumentation.node`). Move the existing detailed behaviour tests (warm-up success/failure,
  never-throws, name-only logging, non-blocking) to a new `apps/web/instrumentation.node.test.ts`,
  importing `./instrumentation.node` instead of `./instrumentation` — the `vi.mock('./src/auth',
  ...)` / `vi.mock('@edmate/harness', ...)` specifiers stay identical (same directory).
- No new test can assert "the Edge compiler didn't trace this" directly; the proof is the 5 fresh
  `next dev` + Playwright runs with no Edge warning in the dev server log, per Proof below.

## Proof
1. Set `actionTimeout` in `playwright.config.ts` first.
2. `corepack pnpm --filter @edmate/content build && corepack pnpm --filter @edmate/web build`
   (confirm no new build warning).
3. Start `next dev` directly (not through Playwright) once, tail its log, confirm no
   `node:worker_threads` / "Edge Runtime" line appears; stop it.
4. Run `teacher-packages-walkthrough.spec.ts` 5 fresh times in a row (separate invocations), all
   green, each finishing well under 900 s.
5. Record all five run outputs and the dev-server log grep result in the handoff.

## Files
- `apps/web/instrumentation.ts` (rewrite `register()`)
- `apps/web/instrumentation.node.ts` (new)
- `apps/web/instrumentation.test.ts` (trim to dispatch tests)
- `apps/web/instrumentation.node.test.ts` (new, moved behaviour tests)
- `apps/web/playwright.config.ts` (`actionTimeout`)
- `apps/web/e2e/global-setup.ts` (comment only, after 0.20h merges)
- `docs/tasks/0.20j/handoff.md`

## Files out of bounds
`packages/content/src/safeRegexGuard.ts`, `safeRegexWorkerEntry.ts`, `localeRules.ts`,
`apps/web/src/auth/**`, `apps/web/proxy.ts`, `apps/web/next.config.ts`, any migration, any prompt
pack or locale pack. No docker, docker compose or psql (board task's own constraint); `next dev`
and Playwright only.

## Risky paths touched
None. Checked against `.claude/skills/merge-gate/risk-paths.txt`: `apps/web/instrumentation*.ts`,
`apps/web/playwright.config.ts` and `apps/web/e2e/**` match no glob in that file (the auth group is
`apps/web/src/auth/**`, not touched; the harness/content-guard safety group is
`packages/harness/**`, `content/**`, not touched). Matches the board task's own `risk: low`.

## Decisions / Questions (recommendation given; escalate only if the primary fix fails)
1. **Does Next's branch elimination require the exact symmetric `if (edge) {...} else {...}` shape,
   or does a bare `if (edge) return; require(...)` guard clause also qualify?** I could not run
   `next dev` to confirm from a planning session (no shell access here). Recommendation: implement
   the symmetric if/else first (closest to the doc example), verify with the dev-log grep in Proof
   step 3 before writing a single test or running the 5x spec loop — cheapest possible checkpoint.
   If the warning persists, try the literal `require` identifier (not a `createRequire`-derived
   variable name) before trying anything else; TypeScript/`@types/node` should type a global
   `require` under `module: ESNext` + `types: ["node"]`, but if `tsc`/eslint reject it, a narrow
   `declare const require: NodeJS.Require;` in `instrumentation.ts` only is acceptable (not a
   project-wide tsconfig change).
2. **If the require-branch fix does not clear the warning at all** (i.e. my static diagnosis is
   wrong): stop after one more targeted probe (e.g. temporarily stub `warmPool`/`warmGuardPatterns`
   to empty functions to confirm the warning truly traces through them, not something else), write
   the finding in the handoff, and set `Status: BLOCKED (edge bundle cause not where expected: <one
   line>)` rather than spending the budget guessing further — per board task risk: low and the 60-
   call aim below.
3. Exact `actionTimeout` value: recommend `10_000` ms (a third of `STEP_TIMEOUT`); builder may pick
   a nearby round number if a real (non-blocked) step is found to legitimately need slightly more.

## Budget
Budget: 55 tool calls (1 phase, apps/web + packages/content touched read-only for one grep check).

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (next dev / next build / vitest / playwright / typecheck /
lint / prettier / secret-scan only — no docker, docker compose or psql).

## Exit conditions
Status: DONE once the 5 fresh `next dev`-backed Playwright runs are green, the dev-server log grep
for "edge runtime"/"worker_threads" is empty, the WARM_UP_TIMEOUT_MS comment is corrected, and
typecheck/lint/test are green for `@edmate/web` and `@edmate/content`. Status: PARTIAL/BLOCKED past
~55 tool calls, or if Question 2's fallback probe still doesn't localise the warning, or if 0.20h
has not actually merged by the time this starts (its branch/handoff needed for the exact
WARM_UP_TIMEOUT_MS comment text and current global-setup.ts state).

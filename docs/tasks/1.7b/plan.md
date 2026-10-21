# 1.7b plan — web build loads the safe-regex worker

## Acceptance (verbatim)
> a production web build serves the IN pack at the age gate, the regex guard still times out an
> unsafe pattern in that build, and a refused pack is logged

How it will be shown: a new build-time smoke test runs the real, built web app (`next build
--webpack`, the production build script) against the real `content/` tree and asserts (a) `'IN'`
is in `loadAgeContent(...).markets`, i.e. the age gate still offers India after the build touched
`@edmate/content`'s worker file; (b) `checkSafeRegexGuarded` run from the *built* `@edmate/content`
still reports an unsafe pattern (a fresh catastrophic-backtracking fixture, not a real PII pattern)
rather than falling back to the fast in-process branch or silently passing it; (c) a synthetic
refused pack (bad schema, in a throwaway fixture dir, never `content/locales/**`) produces one log
line naming the file and the reason. The smoke test fails loud (not silently, like the bug it
catches) if any of these regress.

## Root cause (read: `packages/content/src/safeRegexGuard.ts`, `apps/web/next.config.ts`,
`apps/web/package.json`, `apps/web/Dockerfile`)
`getWorkerFile()` builds the worker's path with `new URL('./safeRegexWorkerEntry.js',
import.meta.url)`. That exact expression — not specifically "`new Worker(new URL(...))`", just
`new URL(<relative literal>, import.meta.url)` appearing anywhere in a module a bundler parses —
is webpack 5's (and Turbopack's) built-in "URL asset" convention: the bundler treats the literal
target as a static asset, copies *only that file's bytes* to its own output path (webpack: `.next/
server/chunks/static/media/safeRegexWorkerEntry.<hash>.js`; Turbopack: tries to run it through this
workspace's own Vite config instead, per the existing comment in `next.config.ts`), and rewrites
the expression to the new location. It does not parse the asset as JS, so the copy's own relative
import (`./safeRegex.js`) is never carried along or resolved. `serverExternalPackages:
['@edmate/content']` doesn't help because the asset-URL rewrite is a parse-time AST match, done
before module-graph/externals decisions. The result: the worker never loads, every pattern in
`checkSafeRegexGuarded` hits the 2,000 ms wall-clock ceiling and is reported unsafe, `IN.yaml` is
refused (it has PII patterns; the pattern check itself can't run), and `loadAgeContent` silently
served only `global`.

## Approach (simplest robust fix — reviewer's second option)
Change `getWorkerFile()` to resolve the sibling path without the `new URL(<literal>,
import.meta.url)` shape at all: `const here = fileURLToPath(import.meta.url); path.join(path
.dirname(here), 'safeRegexWorkerEntry.js')`, and pass that plain string to `new Worker(path, ...)`
instead of a `URL` object (`node:worker_threads`'s `Worker` accepts either). Nothing here is
bundler-specific, so this is a one-file fix in `packages/content/src/safeRegexGuard.ts`, with no
Dockerfile or webpack-config change needed: at runtime the real `dist/safeRegexWorkerEntry.js`
sits beside `dist/safeRegexGuard.js` and `dist/safeRegex.js` exactly as `tsc` built them, and
neither bundler has a reason to touch any of the three once the literal `new URL(...)` pattern is
gone.

**Going back to Turbopack**: likely possible, and worth trying, but out of scope to commit to.
Turbopack's documented misbehaviour (next.config.ts's comment) is the same asset-URL convention
misfiring the other way; removing the triggering expression should fix both bundlers. Builder
verifies with a trial `next build` (no `--webpack`) after the code fix; if clean, this PR may also
drop `--webpack` from `apps/web/package.json` and fix the now-stale comments in `next.config.ts`
and `package.json`. Flagged as an open question below — this reverts a previous workaround rather
than adopting a new tool, so my reading is it does not need an ADR, but CLAUDE.md's "tech stack
changes only with an ADR" is broad enough that the lead should confirm before it lands.

Also required by the task:
- **Log refused packs**: `loadAgeContent(dir, log?)` gains an optional `log` param (default
  `console.error`, matching the existing pattern in `age.ts`'s `close()`); one line per entry in
  `loadLocalePacks(...).refused`, file and reasons only (already non-PII codes/messages — same
  strings the function already puts in a thrown `Error` for the default-pack case). No call-site
  change required (`index.ts`'s `getAgeContent()` keeps calling `loadAgeContent(dir)`); the smoke
  test and a unit test call the two-arg form directly with a spy.
- **Build smoke test**: new `apps/web` test that runs after the app's own `next build --webpack`
  (not just `^build`, i.e. upstream packages) and exercises the built output. Needs a new turbo
  task (`build-smoke`, `dependsOn: ["build"]`, this package only) wired into `apps/web/package
  .json` and `turbo.json`, and a CI step (`.github/workflows/ci.yml`, `node` job) running it after
  the existing `turbo run build typecheck lint test`. Exact harness (spawn the standalone server
  from `.next/standalone` vs. a narrower in-process check against the built `@edmate/content`
  dist plus a direct call into the built `apps/web` age module) is for the builder to settle during
  TDD; either way it must run against real build artifacts, not source via vitest's own transform,
  or it would not have caught this bug.

## Files to create/modify
- `packages/content/src/safeRegexGuard.ts` — worker path construction (core fix)
- `packages/content/src/safeRegexGuard.test.ts`, `safeRegexGuardWorker.test.ts`,
  `safeRegexGuardIntegration.test.ts` — update to the new path/no-URL shape as needed
- `apps/web/src/auth/age.ts` — `loadAgeContent(dir, log?)`, logs each refused pack
- `apps/web/src/auth/age.test.ts` — unit test: a refused pack logs one line, reasons only
- New: `apps/web/test/build-smoke.test.ts` (or `.mts` script) + a tiny fixture pack dir for the
  synthetic unsafe pattern (e.g. `apps/web/test/fixtures/build-smoke/locales/...`, never under
  `content/locales/**`)
- `apps/web/package.json` — new `test:build-smoke` (or similar) script; possibly drop `--webpack`
  from `build` if Turbopack checks out (see above)
- `turbo.json` — new `build-smoke` task depending on this package's own `build`
- `.github/workflows/ci.yml` — run the new task after the build
- `apps/web/next.config.ts` — update/trim the stale Turbopack-bug comment either way
- `docs/tasks/1.7b/handoff.md` — written by the builder, logs the Turbopack decision either way

## Files out of bounds
- `content/locales/**`, `content/legal/**` — the real IN pack and notices; read-only for this task
- `packages/contracts/**` — untouched
- `packages/db/**`, `packages/payments/**` — untouched
- `apps/web/Dockerfile` — no change expected; the standalone-output copy step already takes
  whatever `next build` produces, and the fix keeps worker/guard/safeRegex files colocated in
  `dist`, so nft tracing needs nothing new. Builder touches it only if the smoke test proves
  otherwise, and says why.

## Tests first (TDD)
1. `safeRegexGuard.test.ts`/`safeRegexGuardIntegration.test.ts` red→green on the path-construction
   change (should not need new assertions, just continue passing — these already cover the
   no-dist in-process fallback and the real spawned-worker protocol; the integration test's own
   `dist` build is driven by plain `tsc`, not Next, so it never saw this bug and is the regression
   guard that the fix didn't break the normal case).
2. `age.test.ts`: new case — a directory with one broken pack (bad schema or an unsafe PII
   pattern) alongside a valid default pack logs exactly one line naming the file and reasons, and
   `loadAgeContent` still returns the good markets (no change in refusal behaviour, only logging).
3. New `build-smoke` test: write it to fail against today's `main` (repro), confirm it fails for
   the right reason (worker didn't load / IN missing), then make it pass with the fix.

## Risky paths touched (`.claude/skills/merge-gate/risk-paths.txt`)
- `apps/web/src/auth/**` → reviewers: security-reviewer (age.ts, age.test.ts, index.ts only if the
  call site changes)
- `.github/**` → reviewers: security-reviewer (ci.yml step for the new smoke-test task)
- `packages/content/src/safeRegexGuard.ts` and its tests, `apps/web/next.config.ts`,
  `apps/web/package.json`, `apps/web/Dockerfile`, `turbo.json` — none of these match a glob in
  risk-paths.txt today (the content group only names `promptPacks.ts`/`personaTemplates.ts`
  specifically, plus `content/locales/**`/`content/legal/**` as directories, which this task does
  not write to)
- Net: security-reviewer only, already implied by the board's `risky: true`. A `risk: high`
  decision entry is planned for the handoff regardless.
- No ADR path (`packages/contracts/**`, `docs/adr/**`) is touched, so no architect/
  security-reviewer/typescript-reviewer ADR review is triggered by that rule — but see the open
  question on the bundler flag below.

## Open questions
1. If the fix also clears Turbopack (likely, same root cause): does reverting `apps/web/package
   .json`'s `build` script from `next build --webpack` back to plain `next build` (Turbopack)
   count as a "tech stack change" needing an ADR under CLAUDE.md rule 2, or is reverting a
   previously-introduced workaround flag exempt? Recommend: exempt (no new tool, no dependency
   change — Next.js ships both bundlers), but flagging for the lead's sign-off before merge either
   way. If undecided by the time the builder is ready, keep `--webpack` and leave Turbopack as a
   follow-up task.
2. Whether the build smoke test spawns the real standalone server (closer to production, slower,
   more CI time) or does a narrower direct-import check against the built artifacts (faster, less
   faithful) — left to the builder/tdd-guide to decide against the "no real model/payment calls in
   tests" rule (neither is a model/payment call, so either is fine on that count) and CI budget.

READY

## Lead answers (20 Oct 2026)
1. Keep `next build --webpack` in this task. The builder trials a plain `next build` after the fix and reports the result in the handoff, but does not change the build script. Going back to Turbopack is a follow-up task, not part of 1.7b (log this in the handoff as a decision).
2. The build-smoke test starts the real built server once (the bug only showed in the built output). Keep it to one server start and a few requests so CI stays fast.
3. Reviewers: security-reviewer (risky paths `apps/web/src/auth/**` and `.github/**`), code-reviewer, typescript-reviewer. The handoff needs a `### ... · risk: high` decision entry.

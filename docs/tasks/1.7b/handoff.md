# 1.7b handoff — web build loads the safe-regex worker

Status: DONE

## Summary
`packages/content/src/safeRegexGuard.ts`'s `getWorkerFile()` built the worker's path with
`new URL('./safeRegexWorkerEntry.js', import.meta.url)`. That exact expression — not specifically
`new Worker(new URL(...))`, just `new URL(<relative literal>, import.meta.url)` anywhere a bundler
parses — is webpack 5's (and Turbopack's) built-in "URL asset" convention: the bundler copies only
that file's bytes to a hashed output path and never resolves its sibling `./safeRegex.js` import.
The worker then fails to load, every `checkSafeRegexGuarded` call hits the 2,000 ms wall-clock
ceiling, and every locale pack (including `IN`, which has real PII patterns) is reported unsafe —
silently serving only the `global` pack at the age gate.

Fix: `getWorkerFile()` now resolves the path with `fileURLToPath(import.meta.url)` + `path.join`,
and passes the resulting plain string to `new Worker(...)` (it accepts either a `URL` or a string).
Nothing bundler-specific is left in the expression, so neither webpack nor Turbopack has anything
to misparse.

Also required by the task:
- `loadAgeContent(dir, log?)` (`apps/web/src/auth/age.ts`) gained an optional `log` parameter
  (default `console.error`), and now logs one line per refused pack (file + reasons, no PII) from
  `loadLocalePacks(...).refused`.
- New `apps/web/test/build-smoke.test.ts`: runs the real built web app
  (`.next/standalone/apps/web/server.js`, the same artifact `apps/web/Dockerfile` ships) against a
  real Postgres (direct DB-backed session, no OAuth) and a fixture content dir
  (`apps/web/test/fixtures/build-smoke/`, never `content/locales/**`). One server start, one
  request to `/welcome/age`, asserting all three acceptance points at once: `IN` (safe patterns) is
  served, `ZZ` (one deliberately unsafe pattern) is refused with the specific structural reason (not
  the generic "exceeded ... hard limit" message a broken worker would give for every pattern
  alike), and the refusal is logged exactly once naming the file and reason. Skips locally when
  `TEST_DATABASE_URL` is unreachable, fails in CI (same pattern as
  `apps/web/src/auth/rate-limit.int.test.ts`).
- New turbo task `build-smoke` (`apps/web/package.json`, `turbo.json`, `dependsOn: ["build"]`), and
  a new CI step in `.github/workflows/ci.yml`'s `node` job running it after the existing
  `build typecheck lint test` step.

## Acceptance evidence
```
$ TEST_DATABASE_URL=postgres://edmate:edmate-test@127.0.0.1:55432/edmate \
  corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/web...
 Tasks:    34 successful, 34 total
Cached:    25 cached, 34 total
  Time:    1m8.798s
```
```
$ TEST_DATABASE_URL=postgres://edmate:edmate-test@127.0.0.1:55432/edmate \
  corepack pnpm turbo run build-smoke --filter=@edmate/web
@edmate/web:build-smoke:  ✓ test/build-smoke.test.ts (1 test) 1487ms
 Tasks:    9 successful, 9 total
```
```
$ python3 .githooks/secret-scan.py --all
(exit 0, no output)
```

Repro check (TDD red→green): temporarily stashed only the fix in `safeRegexGuard.ts`, rebuilt, and
reran the build-smoke test — it failed for the symptom described above: every locale pack
(including `IN`) was reported unsafe and refused, `loadAgeContent` served only `global`, and the
page never contained `value="IN"`. Restored the fix, rebuilt, reran — green again.

## Turbopack trial
Per the lead's answer, trialed a plain `next build` (no `--webpack`) after the fix. Result: it
still fails, but for a *different* reason than before — not the original worker-path bug (that
symptom is gone for both bundlers now), but a separate, pre-existing issue: Turbopack's build-time
page-data collection reaches `apps/web/vitest.config.ts` → this workspace's own Vite → lightningcss's
native addon (`lightningcss-darwin-arm64`), which Turbopack can't place in an ESM chunk
(`Error: non-ecmascript placeable asset ... is not placeable in ESM chunks`). This confirms the
`new URL(..., import.meta.url)` misdetection is fixed for both bundlers, but does not clear
Turbopack outright. `--webpack` is kept per the task instructions; `apps/web/next.config.ts`'s
comment is updated to record this finding.

## Changes
- `packages/content/src/safeRegexGuard.ts` — worker path construction (core fix)
- `apps/web/src/auth/age.ts` — `loadAgeContent(dir, log?)`, logs each refused pack
- `apps/web/src/auth/age.test.ts` — new tests for the logging behaviour
- `apps/web/test/build-smoke.test.ts` (new) — the build-smoke acceptance test
- `apps/web/test/fixtures/build-smoke/**` (new) — synthetic fixture packs (`global`, `IN`, `ZZ`)
  and a privacy-notice fixture, never under `content/locales/**`
- `apps/web/vitest.build-smoke.config.ts` (new) — separate vitest project for the build-smoke test
- `apps/web/package.json` — new `build-smoke` script
- `turbo.json` — new `build-smoke` task
- `.github/workflows/ci.yml` — new CI step running `build-smoke` after the existing build/test step
- `apps/web/next.config.ts` — updated comment: records the fix and the Turbopack trial result

## Deviations
None from the plan; the lead's answers in the plan file were followed as written (keep
`--webpack`, one server start for the build-smoke test, named reviewers).

## Fix round

Three HIGH findings (security-reviewer, typescript-reviewer) fixed:

1. **Relocated/bundled worker fails open in production.** `next build --webpack` still bundles
   `@edmate/content` into the app's own server chunk (`serverExternalPackages` does not stop it for
   a pnpm workspace package; its real path sits outside any `node_modules` tree). Bundled,
   `import.meta.url` is rewritten to the build machine's own absolute path, which does not exist in
   the Docker image or any relocated standalone copy -- the worker then silently falls back to the
   unbounded in-process check. Fixed with three parts:
   - `packages/content/src/safeRegexGuard.ts`: `getWorkerFile()` tries the real sibling path first
     (unchanged, correct for the unbundled `dist` -- this package's own tests, `edmate content
     validate`), then falls back to an explicit `EDMATE_CONTENT_WORKER_DIR` env var rather than
     guessing from `process.cwd()` (tried first; dropped because Next's standalone `server.js`
     calls `process.chdir(__dirname)` before anything else runs, so the server's cwd is always its
     own directory, not the server root this package would need to assume).
   - `checkSafeRegexGuarded` now fails closed, not open, whenever the worker file cannot be found
     *and* `NODE_ENV=production`: every pattern is reported unsafe, logged once (not once per
     check). The existing no-dist, non-production fallback (this package's own tests) is unchanged.
   - `apps/web/next.config.ts`: `serverExternalPackages: ['@edmate/content']` (kept even though it
     does not fully externalize the package here -- a pnpm-monorepo gap, not something this config
     closes) and `outputFileTracingIncludes` for `packages/content/dist/**`, so the standalone
     output's own copy of the worker and its sibling `safeRegex.js` import are both actually
     present to be found. `apps/web/Dockerfile` sets `EDMATE_CONTENT_WORKER_DIR=/app/packages/
     content/dist`, the image's own known, deterministic layout.
2. **The smoke test ran the build in place, so it could not have caught (1).**
   `apps/web/test/build-smoke.test.ts` now copies `.next/standalone` to a throwaway temp directory
   and renames this checkout's own `packages/content/dist` out of the way for the duration of the
   test, so the only `dist` the spawned server can possibly use is the one inside the copy. The
   `'IN'` assertion is also now proof the worker ran *from the copy*: if relocation had broken it,
   the new production fail-closed path would refuse `'IN'` along with `'ZZ'`, not just `'ZZ'` --
   confirmed by running the test red (worker file deliberately absent from the copy; both patterns
   refused with the "failing closed" reason) and green (fixed) during this fix round.
3. **No `child.on('error', ...)` listener on the spawned server.** A spawn failure (ENOENT, EACCES,
   ...) fires an `'error'` event; with no listener, Node treats it as an uncaught exception and
   crashes the whole vitest/CI process. `beforeAll` now attaches a listener that records the error
   and surfaces it as a normal thrown error from `beforeAll` (a clean test failure) instead.

Also fixed (LOW):
- `apps/web/src/auth/age.ts`: refusal reasons are stripped of control characters before logging, so
  an unescaped newline in a loader-generated message can't split one refusal into more than one log
  line.
- This handoff's original repro text (quoting the cross-realm `URL` error from a different bug)
  corrected to match the actual symptom of this task's own root cause.

Verified (rebuilt `@edmate/content` and `@edmate/web`, Postgres via `docker compose -f docker/
compose.yaml -f packages/db/test/compose.port.yaml up -d postgres redis`):
```
$ TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate \
  corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/web...
 Tasks:    34 successful, 34 total
```
```
$ TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate \
  corepack pnpm turbo run build-smoke --filter=@edmate/web --force
@edmate/web:build-smoke:  ✓ test/build-smoke.test.ts (1 test) 1925ms
 Tasks:    9 successful, 9 total
```
```
$ python3 .githooks/secret-scan.py --all
(exit 0, no output)
```

## Decisions

### 20 Oct 2026 · 1.7b fix round: a missing/relocated safe-regex worker fails closed in production · decided by builder · risk: high
Decided: `checkSafeRegexGuarded` (`packages/content/src/safeRegexGuard.ts`) now reports every
pattern unsafe, logged once, whenever the compiled worker file cannot be found *and*
`process.env.NODE_ENV === 'production'`, instead of taking the unbounded in-process fallback meant
for dev and this package's own tests. `getWorkerFile()` also stops trying to derive a relocated
worker's path from `process.cwd()` (Next's standalone `server.js` chdirs to its own directory
before anything runs, making that guess wrong) and instead reads an explicit
`EDMATE_CONTENT_WORKER_DIR` env var, set by `apps/web/Dockerfile` to the image's own known layout
and by the build-smoke test to its relocated copy's layout.
Why: a production web build (`next build --webpack`) still bundles `@edmate/content` into the
app's own server chunk despite `serverExternalPackages` (a pnpm-monorepo gap in that Next option,
not something fixable from this config), and the bundled module's `import.meta.url` is rewritten to
the build machine's own absolute path -- wrong everywhere else, including the Docker image this app
ships in and any relocated standalone output. Without this fix, a missing worker in production
silently ran the full regex check with no wall-clock limit at all, on exactly the path (loading and
validating locale packs, including real PII patterns) this guard exists to protect -- failing open,
not closed. This changes the age gate's effective behaviour on a risky path
(`apps/web/src/auth/**` depends on `@edmate/content`'s locale-pack loading).
risk: high

### 20 Oct 2026 · 1.7b fix round: build-smoke test relocates the build to prove the worker survives it · decided by builder
Decided: `apps/web/test/build-smoke.test.ts` now copies `.next/standalone` to a temp directory and
hides this checkout's own `packages/content/dist` for the duration of the test, instead of running
the build in place.
Why: running the build in place let the bundled chunk's baked build-machine path still resolve, so
the original test could never have caught the bug the security review found (it is specific to
relocation: the Docker image, or any standalone copy moved elsewhere). Relocating in the test is
the only way to exercise what actually ships.
risk: low

### 20 Oct 2026 · 1.7b worker path built without `new URL(<literal>, import.meta.url)` · decided by builder
Decided: `getWorkerFile()` in `packages/content/src/safeRegexGuard.ts` now builds the worker's path
with `fileURLToPath(import.meta.url)` + `path.join`, passing a plain string to `new Worker(...)`
instead of a `URL`.
Why: `new URL(<relative literal>, import.meta.url)` is webpack 5's (and Turbopack's) built-in "URL
asset" convention — it is statically detected and rewritten to copy only the target file's bytes,
breaking the worker's sibling import of `safeRegex.js`. In production this made every locale-pack
load/validate check hit the wall-clock ceiling and report every pattern unsafe, including `IN`'s
real PII patterns, silently narrowing the age gate's market list to `global` only — a change to the
age gate's effective content load behaviour, on a risky path (`apps/web/src/auth/**` depends on
this).
risk: high

### 20 Oct 2026 · 1.7b Turbopack trial: fixed for the original bug, still fails for a different reason · decided by builder
Decided: keep `next build --webpack` (`apps/web/package.json` unchanged) for this task, per the
plan's lead answer. A plain `next build` (no `--webpack`) was trialed after the fix and still
fails, now with a different error: Turbopack's page-data collection reaches
`apps/web/vitest.config.ts` → Vite → lightningcss's native addon, which Turbopack can't place in an
ESM chunk. This is unrelated to the `new URL(..., import.meta.url)` bug this task fixes.
Why: the task's acceptance criteria only require the webpack build to work; chasing the separate
Turbopack/lightningcss issue is out of scope and risks scope creep on a task that is otherwise
narrow and well-bounded.
risk: low

### 20 Oct 2026 · 1.7b Turbopack revert is a follow-up task, not part of 1.7b · decided by builder
Decided: reverting `apps/web/package.json`'s `build` script to plain `next build` (Turbopack) is
left as a separate follow-up task, to be picked up only once the lightningcss/vitest.config.ts
issue found in the trial above is understood and fixed.
Why: the plan flagged this as an open question for the lead to confirm; the lead's answer in the
plan file says to keep `--webpack` and log Turbopack re-adoption as a follow-up, not an ADR (no new
tool or dependency — Next.js ships both bundlers with the current toolchain), so this does not
trigger CLAUDE.md rule 2's ADR requirement.
risk: low

### 20 Oct 2026 · 1.7b merge: safe-regex worker survives a relocated build · decided by lead · risk: high
Decided: merge PR #76. It touches apps/web/src/auth/** and .github/** (risky groups). security-reviewer (opus), typescript-reviewer and code-reviewer ran, and the fix round was re-verified by fresh security and TypeScript passes. The smoke-test MEDIUM and the LOWs go to 1.7d; the Turbopack revert goes to 1.7e.
Why: a relocated build now fails closed instead of running an unbounded in-process check; the remaining findings are test hygiene and log tidying.
risk: high

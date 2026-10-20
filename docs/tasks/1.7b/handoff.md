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
reran the build-smoke test — it failed with the exact symptom described above (`TypeError: The
"path" argument must be of type string or an instance of URL. Received an instance of URL`,
surfaced during Next's "collect page data" build step). Restored the fix, rebuilt, reran — green
again.

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

## Decisions

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

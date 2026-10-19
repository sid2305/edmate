# 0.12: CI test-timeout flakes

Status: DONE
Branch: `m7/0.12-ci-timeouts`
Worktree: a dedicated `.claude/worktrees/` checkout of this branch

## Evidence (from the task, GitHub Actions `node` job, 18 Oct 2026)

| Package | Test file | Named test | Observed duration | CI run |
| --- | --- | --- | --- | --- |
| `@edmate/harness` | `src/access/property.test.ts` | "2000 random turns against hostile stores (seed 20261018)" | 5.1-5.8 s | main 39181840517, 39182194427 |
| `@edmate/web` | `src/auth/index.test.ts` | "imports and serves public routes with no AUTH_* or DATABASE_URL set" | ~5 s | PR #30 run 39185546408 |
| `@edmate/web` | `src/auth/route-coverage.test.ts` | "/api/auth/x/y" | ~5 s | PR #30 run 39185546408 |

All three sat close to vitest's 5000 ms default `testTimeout`, so they flaked under CI load without being
genuinely broken.

## Changes

1. `packages/harness/src/access/property.test.ts` — added a named `TEST_TIMEOUT_MS = 30_000` constant
   (one-line comment: local runs take 5.1-5.8 s; CI needs headroom) and passed it as the third argument
   to the `it(...)` for the 2,000-iteration hostile-store property test. Iteration count (`ITERATIONS`)
   is unchanged.
2. `apps/web/src/auth/index.test.ts` — added a named `AUTH_IMPORT_TIMEOUT_MS = 20_000` constant and
   applied it to the one test that was flagged slow ("imports and serves public routes..."). Its
   `load()` helper does `vi.resetModules()` + `import('./index')`, which cold-imports `next-auth` every
   call; left the per-test fresh import as is (the different `AUTH_*`/`DATABASE_URL` env per test
   requires a fresh module instance, since `getRuntime()` memoizes at module scope) rather than
   introducing a shared `beforeAll` import, to keep the diff minimal and behaviour identical.
3. `apps/web/src/auth/route-coverage.test.ts` — added a named `ROUTE_IMPORT_TIMEOUT_MS = 20_000`
   constant and applied it only to the generated test whose sample path is `/api/auth/x/y` (the one
   route file that imports `next-auth` transitively through `src/auth/index.ts`); the other generated
   per-route tests keep vitest's default timeout since they import cheap route handlers.

## Search for tests of the same shape

Searched the repo for (a) property/fuzz loops with >= 1000 iterations, and (b) tests that dynamically
import `next` or `next-auth`:

- `packages/harness/src/access/property.test.ts` (2,000 iterations) — fixed above.
- `packages/harness/src/pipeline/limits.test.ts` ("prunes: 10,000 one-off keys are gone after the
  window") — 10,000 iterations, but each iteration is a synchronous `Map` insert with no I/O or async
  work in the loop body; it runs in a few ms locally and isn't a property/fuzz test over random input
  (no PRNG), so left untouched.
- `packages/db/test/repositories.int.test.ts` — uses a seeded PRNG but only 20 iterations per loop;
  not a candidate.
- `apps/web/src/auth/index.test.ts` and `apps/web/src/auth/route-coverage.test.ts` — the only test
  files that re-import `next-auth` per test (`vi.resetModules()` + `import()`, or `import(file)` over
  the `[...nextauth]` route); fixed above.
- `apps/web/src/auth/adapter.test.ts`, `flow.test.ts`, `config.test.ts`, `guard.test.ts` and
  `packages/config/eslint/__tests__/app-preset.test.ts` import `next`/`next-auth` types or modules, but
  only once at the top of the file (normal module caching, no per-test cold import), so they don't
  share this failure mode and were left untouched.

## Verify

```
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/web --force
```
-> `Tasks: 10 successful, 10 total` (harness: 1 test file passed, 299 ms for the property test;
web: 8 test files / 132 tests passed, including the three timeout-adjusted tests, each well under
its new limit).

```
python3 .githooks/secret-scan.py --all
```
-> no output, clean.

## Decisions

### 18 Oct 2026 · 0.12 Explicit CI timeouts for heavy tests · decided by build-error-resolver · risk: low
Decided: the three CI-flaky tests get named per-test timeouts (30 s for the 2,000-iteration access property test, 20 s for the two next-auth cold-import tests); Vitest's global timeout, iteration counts and per-test fresh imports stay as they were.
Why: CI runners took 5.1–5.8 s against the 5 s default, a load problem, not a logic bug; a global bump would hide real hangs.
Alternatives: raise the global testTimeout; cut iterations; share one import in beforeAll (breaks the per-test fresh module the auth tests rely on).
Reversible: yes.

### 18 Oct 2026 · 0.12 Test-only edits in the access and auth risky paths · decided by team lead · risk: high
Decided: 0.12 touches `packages/harness/src/access/property.test.ts` and `apps/web/src/auth/*.test.ts` only to add timeouts; no assertion, input or import changes, checked by security-reviewer.
Why: these paths are risky (access filter, sign-in), so even a test-only change gets the required reviewer.
Alternatives: none.
Reversible: yes.

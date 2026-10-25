# Handoff: 9.1a — Lighthouse accessibility, signed-in pages, in CI

Status: DONE

## What changed

- `apps/web/test/lighthouse-a11y.test.ts` (new) — spawns the real `.next/standalone` production
  server (in place, no relocation-to-tmpdir dance — neither /home nor /teacher renders the age
  gate, so `safeRegexGuard.ts`'s bundled-worker bug has no stake here), mints two real,
  DB-backed sessions (a fresh, 25-year-old 'clear' student via `identity.createStudent` +
  `identity.recordAgeAnswer`, and a fresh teacher via `identity.createStudent` +
  `identity.grantRole({ role: 'teacher', by: 'operator' })` — there is no separate
  `identity.createTeacher`), launches headless Chrome (`chrome-launcher`), and asserts
  Lighthouse's accessibility category score for `/home` and `/teacher` (360x640 mobile) is
  `>= 95`.
- `apps/web/package.json` — added `lighthouse` (`13.5.0`, exact) and `chrome-launcher`
  (`1.2.2`, exact) as devDependencies.
- `pnpm-lock.yaml` — updated for the above.
- `apps/web/vitest.build-smoke.config.ts` — added `test/lighthouse-a11y.test.ts` to `include`
  (sibling to `build-smoke.test.ts`, same real-Postgres/real-HTTP, no-coverage project).
- `docs/a11y/manual-pass.md` — replaced the "9.1a is a separate follow-up" placeholder note
  with a pointer to the now-automated test.

## Open questions resolved

1. **Can `ubuntu-latest` launch headless Chrome with no install step?** Not provable from this
   worktree (macOS, not the CI runner) — but `chrome-launcher` found and launched a system
   Chrome headlessly here with zero extra install step, which is the same mechanism GitHub's
   documented ubuntu-latest Chrome install would satisfy. Per the lead's answer, no `.github/**`
   step was added; if CI proves `chrome-launcher` can't find a binary on `ubuntu-latest`, the
   fix is one pinned `browser-actions/setup-chrome` step (by SHA), not a design change here.
2. **Do `/home`/`/teacher` need anything beyond `requireRole`?** Confirmed by reading
   `app/home/page.tsx`, `app/teacher/page.tsx` and `src/auth/guard.ts`: `/home`'s
   `requireRole(['student'])` defaults to `clearance: 'age'`, which needs `learnerStatus` to be
   `'clear'` (not `'age_needed'`) — a fresh student needs `identity.recordAgeAnswer` with an
   adult birth year, same as `e2e/fixtures.ts`'s `signInAsFreshStudent`. `/teacher`'s
   `requireRole(['teacher'])` needs no clearance (`cleared(null, ...)` is always true for
   non-students) and no verification: `TeacherView`'s only DB read
   (`publish.changedSinceLastPublish`) is already wrapped in try/catch and never blocks the
   render.
3. Threshold is `95` (the plan's instruction), not `100`.

## Evidence

Red proof (temporary threshold 101, both real scores shown failing loudly):
```
[lighthouse-a11y] /home accessibility score: 100
AssertionError: expected 100 to be greater than or equal to 101
[lighthouse-a11y] /teacher accessibility score: 95
AssertionError: expected 95 to be greater than or equal to 101
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

Green (threshold 95), `build-smoke` CI step's own command
(`corepack pnpm turbo run build-smoke --filter=@edmate/web`), run locally against dev Postgres:
```
 ✓ test/build-smoke.test.ts (1 test) 2705ms
[lighthouse-a11y] /home accessibility score: 100
[lighthouse-a11y] /teacher accessibility score: 95
 ✓ test/lighthouse-a11y.test.ts (2 tests) 12681ms
   ✓ lighthouse accessibility: /home and /teacher (2)
     ✓ /home scores >= 95 (accessibility, 360x640, production build) 5362ms
     ✓ /teacher scores >= 95 (accessibility, 360x640, production build) 4878ms

 Test Files  2 passed (2)
      Tests  3 passed (3)
```

Full gate (`corepack pnpm turbo run typecheck lint test build --filter=@edmate/web`):
```
 Tasks:    11 successful, 11 total
Cached:    7 cached, 11 total
  Time:    2m0.971s
```

`python3 .githooks/secret-scan.py --all`: clean, exit 0, no output.

## Decisions

### 25 Oct 2026 · 9.1a Lighthouse and chrome-launcher pinned, no ADR · decided by builder · risk: low
- Decided: pinned `lighthouse@13.5.0` and `chrome-launcher@1.2.2` (both exact, no `^`/`~`) as
  `@edmate/web` devDependencies; no ADR.
- Why: both are devDependency-only, CI-only test tools with no production code path (same
  precedent as `jest-axe`/`@axe-core/playwright` already in this package) — the tech-stack ADR
  rule (non-negotiable 2) does not apply. `13.x`/`1.x` are each the latest stable major
  resolvable at install time and compatible with this repo's pinned Node (`.nvmrc`).

### 25 Oct 2026 · 9.1a no .github/** change, logged regardless of outcome · decided by builder · risk: high
- Decided: no `.github/**` edit was made; `chrome-launcher` found and launched a headless
  Chrome with zero extra install step in this local run, and per the lead's answer the
  `node` job's `ubuntu-latest` runner is used as-is unless CI itself proves otherwise.
- Why: logged as `risk: high` on the `.github/**` risk-path regardless of outcome, per 13.1's own
  precedent (named in the plan) — so a reviewer isn't surprised by its absence. **Reviewers:
  security-reviewer**, per the plan's "Risky paths touched" section. If a future CI run shows
  `chrome-launcher` cannot find a binary on `ubuntu-latest`, the fix is one pinned
  `browser-actions/setup-chrome` step (by SHA), a small follow-up, not a redesign.

## Left to do

None — status DONE. (If CI's `ubuntu-latest` run shows headless Chrome genuinely unavailable,
that is the one follow-up noted in the risk-high decision above.)

## Budget

Tool calls used: 56

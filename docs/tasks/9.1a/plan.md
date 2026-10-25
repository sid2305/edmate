# Plan: 9.1a — Lighthouse accessibility, signed-in pages, in CI

## Acceptance (verbatim)
`/home and /teacher score >= 95 at 360 px on a production build; the score runs in CI.`

Shown as: a new vitest test (`apps/web/test/lighthouse-a11y.test.ts`) that spawns the real
`.next/standalone` production server (same build `next build --webpack` already produces),
mints a real DB-backed session for a fresh student and a fresh teacher, runs Lighthouse's
accessibility category against `/home` and `/teacher` at a 360×640 mobile viewport, and asserts
each score is `>= 95`. It runs as part of the **existing** `node` job's `build-smoke` step
(`corepack pnpm turbo run build-smoke --filter=@edmate/web`), which already requires a production
build and a real Postgres service — no new CI job, no new workflow file, no change to the
Playwright `e2e` job. The handoff pastes the step's console output (both scores) and the full
gate run, same evidence shape as 9.1 and 13.1.

## Design notes (why build-smoke's step, not the `e2e` job)
- The `e2e` job (ci.yml) runs Playwright against `next dev` (Turbopack), not a production build —
  `playwright.config.ts`'s own comment explains webpack dev is broken for this app today. The
  accept line requires "a production build"; reusing that job would mean adding a second,
  production `next start` server inside it, duplicating most of what `build-smoke.test.ts`
  already does one job over.
- The `node` job's `build-smoke` step already: runs `next build --webpack`, spawns the standalone
  server against a real Postgres service, and mints a real session via `identity.createSession`
  (`apps/web/test/build-smoke.test.ts`). This task adds a sibling test file, included in the same
  `vitest.build-smoke.config.ts`, run by the same already-present step — reusing the existing job
  and stack, per the instruction, even though it is not literally the `e2e` job named in the task
  description.
- No relocation-to-tmpdir dance (unlike `build-smoke.test.ts`): that copy exists only to catch a
  bundled-worker absolute-path bug (`packages/content/src/safeRegexGuard.ts`) this task has no
  stake in. The server runs in place, from `.next/standalone`.
- Sessions: a fresh student (`identity.createStudent`, default role, no age-gate answer needed if
  `/home` only requires `requireRole(['student'])` — confirm at build time; if it also needs a
  clearance/age answer, add `identity.recordAgeAnswer` the same way `fixtures.ts`'s
  `signInAsFreshStudent` does) and a fresh teacher (`identity.createTeacher` +
  `identity.grantRole({ role: 'teacher' })`, and `repos.teacherProfiles.setVerification` only if
  `/teacher`'s render depends on verification — confirm at build time, same open-question style as
  9.1's own unresolved items). Both use `@example.invalid`/`.test` emails, no seed.ts dependency.

## Files to create
- `apps/web/test/lighthouse-a11y.test.ts` — the test, per the Design notes above.
- `apps/web/test/fixtures/` — none expected (no locale-pack fixture needed here, unlike
  build-smoke.test.ts).

## Files to modify
- `apps/web/package.json` — add `lighthouse` and `chrome-launcher` as devDependencies, each
  **exact-pinned** (no `^`/`~`). Builder: resolve the latest stable major (12.x line, Node 22
  compatible) at install time and pin that exact version; record the chosen version and why in
  the handoff, same style as 9.1's `next-intl` decision.
- `apps/web/vitest.build-smoke.config.ts` — add the new test file to `include`. No new vitest
  project; this file already has no coverage requirement and the right (non-offline) setup for a
  real HTTP/Postgres test.
- `docs/a11y/manual-pass.md` — delete or edit the line noting "9.1a (signed-in Lighthouse)" as a
  follow-up, now that it is captured.
- `docs/board/tasks.yaml` — status only (lead does this at merge, not the builder).

## Files out of bounds
- `packages/db/**`, `packages/evals/**` (explicit).
- `apps/web/src/auth/**`, `apps/web/app/api/auth/**`, `packages/db/src/identity/**`,
  `packages/db/src/repositories/**` — **read/consumed only** (existing `identity`/`teacherProfiles`
  functions called as-is), never edited. If `/home` or `/teacher` truly cannot be reached without
  an auth/guard code change, that is a BLOCKED-worthy surprise, not a fix folded into this task.
- `apps/web/e2e/**`, `apps/web/playwright.config.ts` — untouched; this task does not use Playwright.
- `.github/workflows/merge-gate.yml`, `risk-label.yml` — untouched.
- `apps/web/app/home/**`, `apps/web/app/teacher/**` (the pages/views themselves) — if Lighthouse
  finds a real violation below 95, fixing it is in scope only if it is a small, low-risk markup fix
  (same "fix only blockers" spirit); anything bigger is a board follow-up, not silently expanded
  scope.

## Tests first
1. Write `lighthouse-a11y.test.ts` red: point it at a server that isn't running yet (or stub) to
   confirm the assertion shape fails loudly, then bring up the real standalone server and sessions
   (TDD per the plan's usual order, same as `build-smoke.test.ts`'s own header describes for its
   bug).
2. Green once both scores are asserted `>= 95` against the real build.
3. Gate: `corepack pnpm turbo run typecheck lint test build --filter=@edmate/web...` (build before
   test, since the new test requires `.next/standalone` to exist — confirm turbo's task graph
   already orders `build` before `test`/`build-smoke`, same as the current `node` job relies on).
4. `python3 .githooks/secret-scan.py --all`.
5. No `packages/db` or `packages/evals` test changes.

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `.github/**` is touched **only if** the `build-smoke` CI step's timeout needs raising (unlikely —
  two Chrome launches should fit well inside the `node` job's 20-minute budget, per 13.1's own
  "measure, don't pre-emptively bump" precedent) or if Chrome isn't available headless on the
  runner (see Open questions) and an apt-get/setup-chrome step must be added. **Reviewers:
  security-reviewer.** If, like 13.1, no `.github/**` edit ends up needed, log that as a
  `risk: high` decision anyway (13.1's precedent) so a reviewer isn't surprised by its absence.
- No other risk-paths.txt glob is touched (identity/auth/repositories are read via their existing
  public API, not edited).
- A risky-path decision entry (`risk: high`) is planned regardless of outcome, per the above.

## Open questions
1. **Can the `node` job's `ubuntu-latest` runner launch headless Chrome with no extra install
   step?** GitHub's hosted Ubuntu images are documented to ship Google Chrome, but this job has
   never launched a browser before (`e2e` job installs Playwright's own chromium separately). If
   `chrome-launcher` can't find a binary, the builder must add a pinned, minimal install step
   (e.g. `browser-actions/setup-chrome`, exact-pinned by SHA like every other action in this repo)
   — that step change is the `.github/**` touch above. Flagging this now rather than guessing.
2. Does `/home` (student) or `/teacher` (teacher) require anything beyond `requireRole` today (an
   age-gate clearance, teacher verification) to render its real content rather than a redirect?
   `docs/tasks/9.1/handoff.md`'s LOW follow-up (9.1b, already done) suggests `/home`'s guard may
   have changed since 9.1; confirm against current `app/home/page.tsx`/`app/teacher/page.tsx`
   before minting sessions.
3. Threshold is 95 (accept line, verbatim) — not 100 (9.1's `/sign-in` number, an anonymous static
   page with less markup).

## Acceptance evidence
- Console output of the new test (both scores printed/asserted) pasted into the handoff.
- `corepack pnpm turbo run typecheck lint test build --filter=@edmate/web...` — full green run.
- `python3 .githooks/secret-scan.py --all` — clean.
- The handoff states the exact `lighthouse`/`chrome-launcher` versions pinned and why (ADR
  decision: **not needed** — a devDependency-only, CI-only test tool with no production code path,
  same precedent as `jest-axe`/`@axe-core/playwright` in 9.1/13.1).

## Budget
Budget: 40 tool calls (1 phase, apps/web only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (install, typecheck/lint/test/build, secret scan, and a local
Chrome/Lighthouse smoke run only — no deploy, no real model or payment calls)

## Exit conditions
Status: DONE once both scores are captured `>= 95` on a real production build and the full gate
(`typecheck lint test build` + secret scan) is green, with the open questions above resolved (not
punted) in the handoff. Status: PARTIAL if headless Chrome genuinely cannot run in this job without
a `.github/**` change the builder isn't confident making alone (stop and hand back with the exact
chrome-launcher error), or past ~35 tool calls with no green run yet.

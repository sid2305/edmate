# Handoff: 13.1 — Accessibility: axe in CI and a manual WCAG 2.2 AA pass

**Status:** DONE

## What changed

- `apps/web/package.json` — added `@axe-core/playwright` (`4.14.0`, exact-pinned) as a
  devDependency.
- `apps/web/e2e/a11y.spec.ts` (new) — four Playwright/axe cases: public `/`, public `/sign-in`,
  signed-in student `/home`, signed-in teacher `/teacher` (not `live-classes/**`). Each runs
  `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])` through a
  shared `expectNoSeriousViolations` helper that logs any `minor`/`moderate` finding
  (`console.log`) and asserts zero violations of `impact === 'serious' | 'critical'` — the
  accept line, verbatim. Signed-in cases reuse `fixtures.ts`'s real, database-backed
  `signInAsStudent`/`signInAsTeacher` (`identity.createSession`), the same pattern
  `full-flow.spec.ts` and `teacher-packages-walkthrough.spec.ts` use — no new auth shortcut.
- `docs/a11y/manual-pass.md` (new) — the human follow-up checklist: keyboard-only navigation and
  focus order, a screen-reader pass (names/roles/live-region announcements axe can't check),
  200% zoom/reflow, non-text/image-background color contrast axe's rule can't reach, and form
  error announcements. Notes 9.1a (signed-in Lighthouse) and `live-classes/**` as separate
  follow-ups, not restated here.
- `.github/workflows/ci.yml` — **not touched.** `apps/web/playwright.config.ts`'s `testMatch:
  '**/*.spec.ts'` with `testDir: './e2e'` already picks up the new spec through the existing
  `e2e` job's `corepack pnpm --filter @edmate/web e2e` step (same mechanism as `chat.spec.ts`,
  `full-flow.spec.ts`, etc.), confirmed by reading the config before touching anything. Locally
  the whole `a11y.spec.ts` file (all 4 cases) ran in 42s against the real dev stack — negligible
  against the job's 20-minute `timeout-minutes` — so no bump was needed either. Per the plan's
  own instruction ("if axe pushes the job past its current timeout... raise only that number"),
  since it doesn't, nothing in `ci.yml` changes.
- No real violation was found (serious/critical, or minor/moderate) on any of the four pages, so
  no page/view file needed a fix and no `docs/board/tasks.yaml` follow-up entry was needed.

## Evidence

Local e2e run against the existing dev Postgres (`postgres://edmate:edmate-dev@127.0.0.1:55432/edmate`,
no docker compose), from `apps/web`:

```
$ node_modules/.bin/playwright test e2e/a11y.spec.ts
  ✓  1 [chromium] › e2e/a11y.spec.ts:33:3 › accessibility (axe, no serious violations) › public: home (/)
  ✓  2 [chromium] › e2e/a11y.spec.ts:38:3 › accessibility (axe, no serious violations) › public: sign-in (/sign-in)
  ✓  3 [chromium] › e2e/a11y.spec.ts:43:3 › accessibility (axe, no serious violations) › student, signed in: /home
  ✓  4 [chromium] › e2e/a11y.spec.ts:53:3 › accessibility (axe, no serious violations) › teacher, signed in: /teacher
  4 passed (42.1s)
```

(No `[a11y.spec.ts]` log lines appeared — no minor/moderate findings either, on any page.)

Gate:

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/web
 Tasks:    10 successful, 10 total
Cached:    7 cached, 10 total
  Time:    3m10.624s
```

(`src/auth/index.test.ts` did not time out in this run; no re-run needed.)

```
$ python3 .githooks/secret-scan.py --all
(no output — clean)
```

## Decisions

### 25 Oct 2026 · 13.1 devDependency pin · decided by builder · risk: low
- Decided: Added `@axe-core/playwright` pinned to the exact version `4.14.0` (no `^`/`~`) as an
  `apps/web` devDependency, no ADR.
- Why: it is a test-only axe runner for Playwright, adding no production code path and no
  behaviour change outside the test run — the same category task 9.1 set precedent for
  (`jest-axe`/`next-intl`, pinned without a tech-stack ADR). Followed that precedent rather than
  opening a new ADR for a dev-only test tool.

### 25 Oct 2026 · 13.1 ci.yml touch, considered then not made · decided by builder · risk: high
- Decided: Logged as `risk: high` per the plan's own instruction (any touch to `.github/workflows/ci.yml`
  keeps the `.github/**` risk-path group's reviewer requirement — `code-reviewer`,
  `typescript-reviewer`, `security-reviewer` — regardless of diff size), but in the end made **no
  edit** to the file: the new spec is already picked up by the existing `e2e` job's test runner
  and existing `testMatch` glob, and the measured local run (42s) does not approach the job's
  20-minute `timeout-minutes`.
- Why: recording this even though the file ends up untouched, so a reviewer checking the diff
  against the plan's risky-paths section isn't surprised by its absence — the plan anticipated a
  touch; the measurement showed one wasn't needed.

## Follow-ups

- Human manual WCAG 2.2 AA pass: `docs/a11y/manual-pass.md` (keyboard nav/focus order,
  screen-reader names/roles/live-region announcements, 200% zoom/reflow, non-text/image contrast,
  form error announcements) — not done in this task.
- `app/teacher/live-classes/**` has no axe coverage yet (another builder's in-flight work, out of
  bounds for this task both as files and as route coverage). Add it to `a11y.spec.ts` and to
  `docs/a11y/manual-pass.md`'s page list once that work lands.
- No rules were disabled and no board `todo` entry was added — axe found zero violations (any
  impact) on the four covered pages in this run; if CI surfaces something this local run didn't
  (different timing/viewport), treat it as a fix round per the plan's fix-round policy, not a
  silent pass.

## Budget

Tool calls used: 21

## Fix round
- [MEDIUM] fixed apps/web/e2e/a11y.spec.ts — signed-in cases now assert the URL after goto.
Tool calls: 8

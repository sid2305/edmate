
# Task 13.1 — Accessibility: axe in CI and a manual WCAG 2.2 AA pass

Board: `python3 .claude/skills/board/board.py show 13.1` — deps: M11, M12, M8, M9.
Accept (verbatim): "no serious violations."
How shown: a new Playwright a11y spec (`apps/web/e2e/a11y.spec.ts`) runs `AxeBuilder` with
`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa` tags against the main student, teacher and public
pages, asserting zero violations of `serious`/`critical` impact (matching the accept line
exactly); it runs inside the existing `e2e` job in `.github/workflows/ci.yml` and is green on
the PR. A short checklist doc hands the manual WCAG 2.2 AA pass to a human as a named follow-up —
this task does not do that pass itself.

Do not absorb 9.1a (`python3 .claude/skills/board/board.py show 9.1a`): that task is the
signed-in-page Lighthouse score + a Lighthouse CI job, a different tool and a different accept
line. This task's spec may happen to cover some of the same routes, but no Lighthouse work, no
Lighthouse CI step, belongs in this PR.

## Files to create/modify
- `apps/web/package.json` — add `@axe-core/playwright` as a devDependency, exact-pinned (same
  pinning style 9.1 used for `jest-axe`/`next-intl`).
- `apps/web/e2e/a11y.spec.ts` (new) — one Playwright test per page group:
  - Public, unauthenticated: `/`, `/sign-in`.
  - Student, signed in: `/home` — reuse `apps/web/e2e/fixtures.ts`'s real, database-backed
    session helper (the `identity.createSession` pattern already in `full-flow.spec.ts`), not a
    new auth shortcut.
  - Teacher, signed in: `/teacher` only — **not** anything under
    `app/teacher/live-classes/**` (another builder is there; out of bounds for this task,
    files and route coverage both).
  - Each case: `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])`,
    then assert no violation has `impact` of `'serious'` or `'critical'` (helper function,
    written once, reused per case) — matches the accept line literally, and leaves room to log
    (not fail on) `'minor'`/`'moderate'` findings for the board follow-up instead of silently
    dropping them.
- `.github/workflows/ci.yml` — extend the existing `e2e` job (risk path, see below). The new spec
  lives under `apps/web/e2e/` with the `.spec.ts` suffix the job's existing
  `corepack pnpm --filter @edmate/web e2e` step already picks up (same mechanism that already
  runs `chat.spec.ts`, `skills.spec.ts`, etc., and already excludes `testIgnore: ['stack/**']`),
  so no new step is expected. Read `apps/web/playwright.config.ts`'s `testMatch`/`testIgnore`
  first to confirm; if axe pushes the job past its current 20-minute `timeout-minutes`, raise
  only that number — nothing else in the job's shape. Any touch to this file, even one line,
  keeps the risk-path reviewers below.
- `docs/a11y/manual-pass.md` (new) — a short checklist for the human: keyboard-only navigation
  and focus order, screen-reader pass (names/roles/live-region announcements axe can't check),
  200% zoom/reflow, color contrast on any token axe's contrast check can't reach (e.g.
  non-text UI), and form error announcements. Cross-references 9.1a (signed-in Lighthouse) as a
  separate follow-up, not restated here.
- `docs/board/tasks.yaml` — only if a found violation is disabled per-rule-per-page rather than
  fixed: add one new `todo` board entry recording the rule, the page and why, per the task's own
  fix-round policy below.
- Only if axe finds small, real violations (missing label, a contrast token, a missing
  landmark) and the fix set is small: edit the specific page/view files involved (e.g.
  `apps/web/src/ui/AppShell.tsx`, `apps/web/app/sign-in/page.tsx`, `apps/web/app/home/view.tsx`,
  `apps/web/app/teacher/view.tsx`) — never anything under `app/teacher/live-classes/**`.

## Files out of bounds
- `apps/web/app/teacher/live-classes/**` (another builder's worktree).
- `packages/contracts`, `packages/harness` (nothing here touches either).
- `docs/adr/**` — see the dependency question below; this plan's position is no new ADR.

## Tech-stack / ADR question (resolved, not blocking)
`@axe-core/playwright` is a new devDependency in `apps/web` only, adding no production code path
and no behaviour change outside the test run. `docs/adr/0001-tech-stack.md` and the other ADRs
under `docs/adr/` cover framework and runtime choices (Next.js, the harness's own dependency
allow-list, etc.); there is no existing "testing stack" ADR. Task 9.1 set the working precedent
for this exact question: it added `jest-axe` (an axe runner) and pinned `next-intl`'s version
without an ADR, logging both as `risk: low` decisions instead ("not a tech-stack ADR" carve-out).
`@axe-core/playwright` is the same category — a test-only axe runner, this time for Playwright
instead of jest-axe/RTL. This plan follows that precedent: no ADR, one `risk: low` decision in
the handoff naming the exact pinned version and why. If the lead disagrees, say so before the
build starts; nothing else in this plan depends on the answer.

## Risky paths touched
- `.github/workflows/ci.yml` matches `.claude/skills/merge-gate/risk-paths.txt`'s `.github/**`
  group. Reviewers: `code-reviewer`, `typescript-reviewer`, `security-reviewer`. The handoff logs
  a `risk: high` decision for this touch, even if the only change is a `timeout-minutes` bump or
  a comment, per the group's own reviewer requirement (not a severity judgement on the diff).
- No other path in this plan's file list matches `risk-paths.txt` (checked against it:
  `apps/web/src/auth/**`, `packages/contracts/**`, `packages/harness/**`, `.githooks/**` and the
  other listed prefixes are all untouched by this plan).

## Tests first
1. Write `apps/web/e2e/a11y.spec.ts` against the real pages before any fix: it is expected to be
   red only if axe finds a real serious/critical violation, not red because the file or a
   fixture is missing (the signed-in session helper and the three target routes all already
   exist per 9.1's handoff).
2. Run it locally (`corepack pnpm --filter @edmate/web e2e` with the new spec in place) before
   touching `ci.yml`, so the CI edit is proven necessary (or unnecessary) first, not guessed.
3. If a serious/critical violation is real: fix it, rerun the same spec, confirm green, then
   check it doesn't regress `AppShell.test.tsx` / `view.test.tsx`'s existing jest-axe coverage
   from 9.1 (`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`).

## Fix-round policy for real violations (per this task's constraints)
- Small, real violations (missing `aria-label`, a contrast token below AA, a missing landmark):
  fix in this same PR, only if the total touched-file count for fixes stays under ~10 (on top of
  the files already listed above). List each fix in the handoff.
- Anything larger, or anything that needs a design call (e.g. a genuine false positive axe can't
  be configured around per-element): disable that specific rule for that specific page only
  (`AxeBuilder.disableRules([...])` scoped to the one test case, never project-wide), leave a
  `// TODO(13.1-followup): <rule> — <why>` comment at the disable site, and add the matching board
  `todo` entry plus a line in the handoff's "Left to do".

## Testing strategy
- Unit/component: unchanged — 9.1's existing jest-axe coverage (`AppShell.test.tsx`,
  `sign-in/page.test.tsx`, `home/view.test.tsx`, `teacher/view.test.tsx`) stays green and is not
  duplicated here.
- E2E: the new `a11y.spec.ts`, Chromium only (matches the existing `e2e` job), against real
  rendered pages and a real signed-in session — no mocked DOM.
- CI: the existing `e2e` job in `.github/workflows/ci.yml` runs it on every PR; no new job.

## Risks & mitigations
- **Risk**: axe finds a violation on a shared component (`AppShell`) that fans out across every
  page. Mitigation: fix once at the component level; the spec's per-page cases catch the fan-out
  automatically on rerun.
- **Risk**: the `/teacher` route's eventual `live-classes` sub-pages later need their own axe
  coverage once that builder's work lands. Mitigation: note this explicitly in the handoff's
  "Left to do" as a follow-up, not a silent gap.
- **Risk**: CI job timeout from the extra browser-driven checks. Mitigation: measure locally
  first; only bump `timeout-minutes` if the measured run needs it.

## Open questions
None blocking. The one judgement call (ADR vs. precedent-based `risk: low` decision for the new
devDependency) is resolved above per 9.1's own precedent; flag to the lead only if they disagree
before the build starts.

## Budget
Budget: 40 tool calls (1 phase, apps/web + .github/workflows)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm install/build/test/e2e, secret scan, board.py only)

## Exit conditions
Status: DONE when `a11y.spec.ts` is green in the `e2e` CI job (or green locally with evidence
pasted in the handoff if CI capacity is a concern — called out, not hidden), the manual-pass
checklist doc exists, and any real violations are either fixed (<10 files) or disabled per-rule
with a TODO and a board follow-up. Status: PARTIAL past ~40 tool calls, or if a violation needs a
fix outside this plan's file list (e.g. inside `app/teacher/live-classes/**`) — stop and hand off
rather than widen scope.

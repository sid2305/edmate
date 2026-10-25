# 9.1c plan — /teacher scores at least 98 on Lighthouse accessibility

Status: READY (lead-written, 25 Oct 2026)
Budget: 35 tool calls.

## Goal
apps/web/test/lighthouse-a11y.test.ts (task 9.1a) found /teacher scoring exactly the 95 threshold at 360x640, so a one-point drift fails CI. Find which Lighthouse accessibility audits cost the points on /teacher and fix the markup so it scores at least 98.

## Steps
1. Run the existing test locally as 9.1a's handoff describes (`corepack pnpm turbo run build-smoke --filter=@edmate/web`, against dev Postgres at `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate`; never start or stop containers). To see the failing audits, temporarily log the `lhr.audits` entries with `score < 1` for /teacher (or write them to a file in your scratch space). Remove any temporary logging before committing, or keep a small, permanent failing-audit list in the assertion message if it stays tidy (preferred: when a page drops below the threshold, the message names the failing audit ids).
2. Fix the cause in the /teacher page's own components (apps/web/app/teacher/** and the components it renders): typical causes are colour contrast, a heading-order skip, a button or link without an accessible name, a list without list items, or a missing landmark. Fix only what /teacher's failing audits name; if a fix is in a shared component, check /home still scores at least its current value.
3. Raise nothing else in the test: keep `MIN_ACCESSIBILITY_SCORE = 95` (the board's accept line for the gate); this task makes /teacher pass with margin, it does not move the bar.

## Tests
- The lighthouse test passes locally with /teacher at 98 or above; record both pages' scores in the handoff.
- Any component you change keeps its unit tests green; add a unit test if the fix is an accessible name or role that a test can pin (e.g. `getByRole('button', { name: ... })`).

## Gate
`corepack pnpm turbo run typecheck lint test build-smoke --filter=@edmate/web` green; `python3 .githooks/secret-scan.py --all` clean.

## Risk paths
None expected (apps/web/app/teacher/** and apps/web/src/components/** are not in risk-paths.txt). If the fix needs apps/web/src/auth/**, stop and report.

## Reviewers
code-reviewer, typescript-reviewer.

## Open questions
None.

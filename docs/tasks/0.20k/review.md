# Review: 0.20k — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

Both reviewed the build. code-reviewer re-checked fix round 1 and reported it fixed with no new CRITICAL or HIGH.

## Findings
- [MEDIUM] [fixed] apps/web/e2e/fixtures.ts:162 — `createFreshTeacher()` was exported but no committed test called it (the starting-empty proof used a temporary spec). Fix round 1 removes it (typescript-reviewer raised the same point as LOW).

## Notes
- code-reviewer confirmed the cause against PackagesView.tsx: the package list renders `<h3>` names inside `<ul aria-label="Your packages">`, while the edit form's `<h2>Editing …</h2>` sits in a separate section, so the old unscoped heading lookup matched the form title and started a second edit before the first save landed. The list only updates after the PUT resolves, so the scoped check cannot pass early.
- typescript-reviewer confirmed every promise in the spec is awaited in order and the list locator is re-evaluated after each save.
- The fix is spec-only; no app code changed.

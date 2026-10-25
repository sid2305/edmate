# 9.1a review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

Summary: a vitest Lighthouse test in the build-smoke config builds the web app, signs in real database sessions for a student and a teacher, and scores /home (100) and /teacher (95) at 360 px; a missing Chrome or database in CI fails loudly instead of skipping. One fix round made every cleanup step run independently and surfaced server stderr on a boot failure; both reviewers approve.

## Findings
- [HIGH] [fixed] apps/web/test/lighthouse-a11y.test.ts — afterAll skipped server and database cleanup if chrome.kill() threw.
- [MEDIUM] [wontfix] docs/tasks/9.1a/handoff.md — Chrome discovery on the CI runner was only proven locally; this PR's own CI run verifies it before merge.
- [LOW] [fixed] apps/web/test/lighthouse-a11y.test.ts — the server's stderr was discarded.
- [LOW] [deferred 9.1c] apps/web/test/lighthouse-a11y.test.ts — /teacher scores exactly the 95 threshold, so a one-point drift would fail CI.
- [LOW] [wontfix] apps/web/test/lighthouse-a11y.test.ts — --no-sandbox is a test-only Chrome flag for headless CI, never shipped.
- [LOW] [wontfix] docs/tasks/9.1a/handoff.md — budget overrun; covered by a lead decision.

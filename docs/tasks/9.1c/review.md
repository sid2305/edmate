# 9.1c review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

/teacher failed Lighthouse's target-size audit: its nav links were 18px tall at 360px wide. `.app-nav a` in apps/web/app/globals.css now gives them a 44px minimum height, and /teacher scores 100 (it was 95); /home stays at 100. The test also now copies .next/static into the standalone server, as apps/web/Dockerfile does, so pages are scored with their CSS. MIN_ACCESSIBILITY_SCORE stays at 95.

## Findings
- [LOW] [wontfix] apps/web/test/lighthouse-a11y.test.ts — two lines exceed Prettier's 100-character width (CI does not run Prettier).
- [LOW] [wontfix] apps/web/app/globals.css — the 8px flex gap between nav links is unchanged; the score relies on the larger targets alone.

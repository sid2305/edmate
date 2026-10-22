# 8.6g review — APPROVE
Reviewers: code-reviewer, typescript-reviewer

code-reviewer (sonnet) and typescript-reviewer (opus) reviewed the package-builder follow-ups. One fix round (sonnet) closed the incomplete unmount guard, the vacuous unmount test, the limit_reached test that never reached ERROR_KEYS, and the comment; a sonnet typescript-reviewer verified each fix and its fail-without-fix test. The timed walkthrough is a Playwright spec that runs in CI's e2e job; the lead records its step times in the handoff from the CI log.

## Findings
- [HIGH] [open] docs/tasks/8.6g/handoff.md:51 — the timed walkthrough was not run; record the `[8.6g walkthrough]` step times and total from the CI e2e log.
- [HIGH] [fixed] apps/web/app/teacher/packages/PackagesView.test.tsx:303 — the unmount test asserted a console warning React 19 never emits; it now counts state-setter calls and fails without the guard.
- [MEDIUM] [fixed] apps/web/app/teacher/packages/PackagesView.tsx:250 — refresh()'s non-2xx branch set the banner after a second await without re-checking mountedRef; re-checked, with a test.
- [MEDIUM] [fixed] apps/web/app/teacher/packages/PackagesView.test.tsx:278 — the limit_reached test passed through the reason path; a code-only 409 test now exercises ERROR_KEYS.
- [LOW] [fixed] apps/web/app/teacher/packages/PackagesView.tsx:239 — the mountedRef comment claimed a dev warning React 19 no longer emits.

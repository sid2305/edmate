# 8.6d review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings

- [HIGH] [fixed] apps/web/app/teacher/packages/PackagesView.tsx — refresh() cast the GET body with `as` and no validation; now parsed with a zod schema, and a bad body shows the error banner (fix round, verified by typescript-reviewer).
- [HIGH] [fixed] apps/web/app/teacher/packages/PackagesView.tsx — the save response was cast and spread into state unvalidated; now validated with the same schema (fix round, verified by typescript-reviewer).
- [HIGH] [deferred 8.6g] docs/tasks/8.6d/handoff.md — the Phase D manual timed walkthrough (two packages in under 15 minutes) was not run; lead decision in the handoff, run in 8.6g.
- [MEDIUM] [deferred 8.6g] apps/web/app/teacher/packages/PackagesView.tsx — helpCeiling uses an unchecked `as 1 | 2 | 3 | 4` cast; narrow with an allow-list.
- [MEDIUM] [deferred 8.6g] apps/web/app/teacher/packages/PackagesView.tsx — ERROR_KEYS lacks the API's limit_reached code.
- [LOW] [deferred 8.6g] apps/web/app/teacher/packages/PackagesView.tsx — refresh() has no unmount guard.
- [LOW] [deferred 8.6g] apps/web/app/teacher/packages/PackagesView.test.tsx — no test for a GET that is non-2xx or throws (the fix round added the malformed-body case).

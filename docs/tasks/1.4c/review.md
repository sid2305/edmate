# 1.4c review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

## Findings
- [LOW] [wontfix] apps/web/src/auth/config.ts — a signed-in user cannot self-link Google to their own unlinked account (the shared-device rule compares `linkedOwner`, which is unset); fails closed and matches the existing shared-device rule (security-reviewer)
- [LOW] [wontfix] apps/web/src/auth/config.ts — `hasLinkedAccount` is not try/caught, so a database error throws out of `signIn`; Auth.js treats a throw as a failed sign-in (fails closed), the same as the callback's other identity calls (typescript-reviewer)
- [LOW] [wontfix] packages/db/src/identity/store.ts — `hasLinkedAccount` selects `sql\`1\`` where a sibling check selects a column; style only (database-reviewer)

After review, a CI fix round added one test in apps/web/src/auth/config.test.ts (the age-blocked refusal on the Google sign-in path) to keep src/auth/** at 100% statement coverage; no source change.

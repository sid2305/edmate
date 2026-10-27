# 12.1c review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

## Findings
- [LOW] [wontfix] apps/web/app/api/staff/verifications/handlers.ts — the error-kind switches don't list 'limit' and have no exhaustiveness guard; no call here throws 'limit' today (typescript-reviewer)

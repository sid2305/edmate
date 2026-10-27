# 13.4b review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer, database-reviewer

## Findings
- [LOW] [deferred 13.4d] apps/web/src/export/accountExport.ts — the account-wide export leaves out consents and ended subscriptions; the builder logged it as risk: high, and the reads it needs live in out-of-bounds files (security-reviewer)
- [LOW] [deferred 13.4e] apps/web/src/account/delete.ts — the B-59 payment-dispute hold is not logged as a decision; the lead logs it and adds 13.4e for after payments (security-reviewer)
- [LOW] [wontfix] packages/db/src/repositories/safety-alerts.ts — a partial index on (student_id) where acknowledged_at is null would make hasOpenForStudent index-only; per-student alert counts are small, so the leading-column index is enough (database-reviewer)
- [LOW] [wontfix] apps/web/src/account/delete.ts — race between the hold check and anonymise; accepted in the plan because alerts keep their rows (typescript-reviewer)

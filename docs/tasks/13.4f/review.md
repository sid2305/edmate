# 13.4f review — APPROVE

Reviewers: security-reviewer, code-reviewer, typescript-reviewer

## Findings
- [MEDIUM] [deferred 13.4g] apps/web/src/export/accountExport.ts — on an exact periodEnd tie the dedupe keeps the first row listAllForStudent returns, which can be an ended row rather than the live one; break ties toward the non-ended row and test it (code-reviewer)
- [LOW] [deferred 13.4g] packages/db/src/identity/store.ts — parseConsentRow is exported and throws a raw ZodError when called outside the guarded store methods; document or wrap its error (security-reviewer)

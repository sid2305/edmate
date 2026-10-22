# 12.4f review — APPROVE
Reviewers: security-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (sonnet)

The staff agents page keeps the dirty subject select across reloads, parses the select with a zod enum instead of a cast, reads approvedBy and approvedAt from a fresh GET after approve or revoke, and puts focus back after cancel and confirm. All three reviewers approve. Staff-only access and the confirm step are unchanged, and the new tests fail on the old code. The one LOW is deferred to 12.4g.

## Findings
- [LOW] [deferred 12.4g] apps/web/app/staff/agents/view.tsx:105 — the post-action reload copies only approvedAt, approvedBy and regulatedSubject from the fresh record; replace the whole record.

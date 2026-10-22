# 12.4d review — APPROVE

Reviewers: security-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (sonnet), lead

The security-reviewer checked the following:
- `/staff/agents` runs the real `requireRole(['staff'])` before any read.
- The client posts only to the same-origin staff API and parses every reply with zod. It shows fixed error codes, never raw text.
- Teacher text is rendered as plain JSX, and rows carry no personal data.
- The PublishView change is display only; the block itself stays on the server.
- The integration test uses the real guard and shows a teacher or signed-out user is refused, with no audit row written.

The code-reviewer found that rows kept stale local state after Reload, so Save could overwrite another staff member's newer flag and clear its approval. A fresh fixer keyed each row by agent, subject and approval time. Its new test fails without the fix and passes with it, and the code-reviewer confirmed the fix.

## Findings
- [HIGH] [fixed] apps/web/app/staff/agents/view.tsx — rows keyed by agentId alone kept a stale subject after Reload, so Save could overwrite a fresh value; rows are now keyed by agentId, subject and approvedAt, with a red-then-green reload test.
- [MEDIUM] [fixed] apps/web/app/staff/agents/agent-row.tsx — the subject state never resynced to new props (typescript-reviewer; same root cause as the HIGH).
- [MEDIUM] [deferred 12.4f] apps/web/app/staff/agents/agent-row.tsx — focus is lost to the page body after an Approve or Revoke confirm or cancel.
- [MEDIUM] [deferred 12.4f] apps/web/app/staff/agents/view.test.tsx — no two-row test that an unsaved edit on one row survives a reload that changes another row.
- [LOW] [deferred 12.4f] apps/web/app/staff/agents/agent-row.tsx — `as SubjectOption` cast on the select value.
- [LOW] [deferred 12.4f] apps/web/app/staff/agents/view.tsx — the optimistic patch takes approvedBy from the stale prop.

# 9.3e review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

A safety-reason rejection takes the teacher's live agents down in the same transaction, and a lift returns an agent to live only for a verified teacher (lead decision after Phase A). Staff mark a rejection as a safety rejection in the verification queue. security-reviewer (opus) found that a safety-rejected teacher's agents reach no student, that neither a lift nor re-verification puts an agent back to live, that the staff route stays staff-only with a strict body, and that every writer locks the profile before the agent, so nothing can deadlock. No CRITICAL or HIGH. The MEDIUM (verified teachers cannot be safety-rejected from the console yet) goes to 9.3f with the builder's left-to-do; the LOWs go to 9.3g.

## Findings
- [MEDIUM] [deferred 9.3f] packages/db/src/repositories/teacher-profiles.ts:307 — the safety checkbox only reaches pending teachers in the verification queue; a verified teacher with live subscribers cannot be safety-rejected from the console.
- [LOW] [deferred 9.3g] packages/db/src/repositories/teacher-profiles.ts:226 — the stale-active-row branch suspends an agent with no audit row of its own and no staff action on the existing takedown.
- [LOW] [deferred 9.3g] packages/db/src/repositories/takedowns.ts:397 — lift returns no agent status, so a content-takedown lift for a pending teacher leaves the agent in draft with no signal to staff.
- [LOW] [deferred 9.3g] packages/db/src/repositories/takedowns.ts:379 — the no-profile -> draft branch of lift has no test.
- [LOW] [deferred 9.3g] packages/db/test/takedowns.int.test.ts:748 — no two-connection forced-order test for setVerification(safety) against goLive or create.
- [LOW] [deferred 9.3g] apps/web/app/staff/view.tsx:66 — the rejectedSafety notice says an agent was taken off even when the teacher had none.

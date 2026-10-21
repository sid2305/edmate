# 9.3 review — APPROVE

Reviewers: code-reviewer (opus), typescript-reviewer (sonnet), security-reviewer (sonnet)

The start route is student-only and same-origin. The student comes from the session and the body is a strict `{agentId, packageId}`. A draft or suspended agent and a package that isn't live are refused. A double start gets 409 from the partial unique index. There's no payment call anywhere. Fix round 1 fixed two MEDIUMs: the compare page now gets only public package fields, and `liveForAgent` itself refuses an agent that isn't live. The security reviewer re-checked them.

## Findings
- [MEDIUM] [fixed] packages/db/src/repositories/package-versions.ts:12 — liveForAgent returned the full PackageConfig (module ids, helpCeiling, finalAnswers, lockedReply) and the page serialised it to the client; now a public projection only
- [MEDIUM] [fixed] packages/db/src/repositories/package-versions.ts:143 — liveForAgent didn't join agents, so a draft or suspended agent's live packages were returned; now joined on status live, with a fixture that has a package
- [MEDIUM] [deferred 9.3b] apps/web/app/home/page.tsx:17 — chat and start links load one after the other; use Promise.all
- [LOW] [deferred 9.3b] apps/web/app/packages/[agentId]/PackageCompare.tsx:21 — amountMinor / 100 is wrong for currencies with no minor unit or three decimals (US pilot unaffected)
- [LOW] [deferred 9.3b] apps/web/src/subscriptions/start.ts:48 — every RepositoryError('invalid') becomes 409 already-subscribed; there's no exhaustiveness guard in fromError
- [LOW] [deferred 9.3b] packages/db/src/repositories/subscriptions.ts:122 — start accepts any version of the teacher's package; only the route limits it to the live one
- [LOW] [deferred 9.3b] apps/web/app/packages/[agentId]/page.tsx:38 — a paused subscription shows "continue to chat", but chat is refused while paused
- [LOW] [deferred 9.3b] apps/web/app/packages/[agentId]/PackageCompare.tsx:427 — the network-failure catch doesn't log the error name

# 6.5 review — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), typescript-reviewer (sonnet)

The typescript-reviewer covered the code review too. It ran typecheck and lint in a snapshot (25 of 25 tasks) and the full web suite (833 passed, 4 skipped).

The security reviewer confirmed four things:
- the scope always comes from the signed-in principal and the live agent's owner;
- DELETE goes through `withRole`'s Origin check;
- the audit row holds counts only;
- the 10,000-row export cap is enforced on the server.

The database reviewer confirmed the reset's lock order (sessions, then the profile row) and that the race tests cover it.

## Findings
- [MEDIUM] [deferred 6.5a] packages/db/src/repositories/learner.ts — plain `evidenceEvents.append` inserts without locking the profile row. A future caller racing a reset could leave events that a later `rebuildMastery` turns back into mastery. No code calls it this way today.
- [MEDIUM] [deferred 6.2a] packages/db/src/schema/learning.ts — `evidenceEvents.list` sorts all of the pair's rows. It needs a `(teacher_id, student_id, ts, id)` index.
- [LOW] [deferred 6.5b] apps/web/app/learn/[agentId]/memory/page.tsx — the page builds the scope from `agents.owner()` by hand instead of calling `studentTurnScope` the way the route does.
- [LOW] [deferred 6.5b] apps/web/src/memory/routes.ts — the server-database `memoryHandlers` wiring is untested (the same pattern as subscriptions/start.ts).
- [LOW] [deferred 6.5b] packages/db/src/repositories/learner.ts — when no profile row exists, reset still ends the open session, so the call changes session state without any visible result. This is the intended behaviour (Q1); 6.5b should document it on the route.

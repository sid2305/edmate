# 9.4d review — APPROVE
Reviewers: code-reviewer, security-reviewer

All three 9.4a review MEDIUMs are fixed with tests. The live-class ask route now resolves teachers from the signed-in student's own live subscriptions, and `classQuestionsRepo.submit` still re-checks entitlement inside its transaction. The session-start rate limit fails closed with a 503 after a 3 s deadline, and the limits Redis client has command and connect timeouts. A subscription resolve with no `studentMarket` throws `RepositoryError('integrity')` after the `learnerClear` gate; no current composition root can reach it. The security reviewer raised a LOW about the losing `take()` promise rejecting after the deadline. The code reviewer checked it: `Promise.race` attaches handlers to both promises, so a late rejection is handled and is not an unhandled rejection.

## Findings
- [LOW] [wontfix] apps/web/src/turn/routes.ts:withDeadline — a late rejection of the raced `take()` after the deadline wins; Promise.race already handles it, so no unhandled rejection.

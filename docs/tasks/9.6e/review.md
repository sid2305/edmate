# 9.6e review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

Both reviewers ran on the branch diff (apps/web /home, the package compare page, liveChats.ts, en.json). The paused list is built from the signed-in student's own scope, the compare page gives a paused plan its own text and a plan link, and the three builder decisions match the plan and B-49 (a paused subscription keeps its old chat). Nothing outside scope. One MEDIUM and two LOWs are deferred to 9.3b.

## Findings
- [MEDIUM] [deferred 9.3b] apps/web/app/home/page.tsx — /home runs four sequential candidate scans (chat, start, paused, live classes), each re-querying agents.owner and subscriptions.findLive; load them in parallel or consolidate.
- [LOW] [deferred 9.3b] apps/web/src/chat/liveChats.ts — the startableAgents docstring still says resuming is out of scope.
- [LOW] [deferred 9.3b] apps/web/app/packages/[agentId]/page.test.tsx — the Change plan link is asserted for active only, not trial or past_due.

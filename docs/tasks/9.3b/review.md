# 9.3b review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, database-reviewer, security-reviewer

Four reviewers ran on the branch. Two HIGHs came back. A stale-version refusal from `subscriptions.start` was shown to the student as "this teacher's free plan is paused". The compare page still divided prices by 100 for every currency. One fix round closed both. The repository now marks the stale-version refusal with a fixed reason that the route checks first and answers with its own message. `formatPrice` now scales by the currency's own fraction digits, with JPY and KWD tests. The code and database reviewers re-verified the fix and approved. Security found no problem in the diff. Its one LOW (the same price scaling) is closed by the same fix.

## Findings
- [HIGH] [fixed] apps/web/src/subscriptions/start.ts:113 — a stale-version `invalid` from subscriptions.start had no cause, so explainInvalid reported it as the free plan being paused; the repository now attaches a fixed stale-version reason, checked before the findLive guess, with a route-level test
- [HIGH] [fixed] apps/web/app/packages/[agentId]/PackageCompare.tsx:21 — formatPrice divided amountMinor by a hardcoded 100; it now scales by Intl's resolved fraction digits, and the JPY test expects ¥2,000 (KWD case added)
- [LOW] [fixed] apps/web/app/packages/[agentId]/PackageCompare.tsx:21 — security's note on the same pre-existing price scaling; closed by the HIGH fix
- [LOW] [wontfix] apps/web/app/home/page.tsx:60 — /home runs homeLinks then homeLiveClasses in sequence rather than Promise.all; the live-classes read now needs homeLinks' teacher ids (it replaces a duplicate agents.owner scan), as the handoff's risk: low decision explains; the lead accepts it

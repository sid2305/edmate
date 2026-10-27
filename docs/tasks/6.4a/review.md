# 6.4a review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer, silent-failure-hunter

## Findings
- [HIGH] [fixed] packages/harness/src/tools/practice.ts — topicIdFor fell back to a generated item's `<module>:practice` id, which reached EvidenceEvent.topicId, failed the id() shape and owned-topic check, and made commit throw on every graded generated-item turn; fix round 1 dropped the fallback, added an id()-shape guard in runner.ts evidenceFor and an integration test (typescript-reviewer)
- [MEDIUM] [deferred 6.4b] apps/web/app/api/sessions/[id]/end/route.ts — concurrent end POSTs can each run an unmetered summarize before one write lands (security-reviewer)
- [MEDIUM] [fixed] docs/tasks/6.4a/handoff.md — the dependents-form gate never ran clean locally; closed by fix round 1's run and CI, see the lead decision (code-reviewer)
- [LOW] [deferred 6.4c] packages/harness/src/pipeline/runner.ts — no telemetry when evidenceFor skips a turn with no topic (silent-failure-hunter)
- [LOW] [deferred 6.4c] apps/web/app/api/sessions/[id]/end/route.test.ts — no test for a SessionSummarySchema failure (silent-failure-hunter)
- [LOW] [deferred 6.4c] apps/web/app/api/sessions/[id]/end/route.ts — the RepositoryError switch has no 'limit' case (typescript-reviewer)
- [LOW] [deferred 6.4c] packages/harness/src/tools/practice.ts — pickItem gets no topicMap, so a future DB-backed bank item with a deleted topic would fail commit (typescript-reviewer)

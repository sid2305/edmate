# 8.9c review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings

- [LOW] [deferred 8.9d] apps/web/src/studio/questions/QuestionsInboxView.tsx — onAnswer/onDismiss use try/finally with no catch; an injected action that rejects would become an unhandled rejection. Add a catch that sets the error banner (defence in depth).
- [LOW] [deferred 8.9d] apps/web/src/studio/questions/QuestionsInboxView.tsx — groups/moduleId state is seeded once from props and never resynced; harmless for a server-rendered page, add a comment or resync if the view is reused.

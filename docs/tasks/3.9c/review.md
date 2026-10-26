# 3.9c review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, silent-failure-hunter

## Findings
- [HIGH] [fixed] packages/harness/src/guardrails/warmup.ts — no warm-up sample hit the `sexual` moderation rule, so the minor-marker table stayed cold; a reused test sample now hits it and a test pins that (code-reviewer)
- [MEDIUM] [fixed] packages/harness/src/guardrails/warmup.coldStart.test.ts — the comment claimed vi.resetModules() but the test never called it; it now does (code-reviewer, typescript-reviewer)
- [MEDIUM] [fixed] packages/harness/src/guardrails/warmup.ts — an unneeded `as string` cast on SAMPLES[0]; SAMPLES is now an `as const` tuple (typescript-reviewer)
- [LOW] [fixed] packages/harness/src/guardrails/warmup.ts — matchModeration was never warmed without context, unlike the real call site (silent-failure-hunter)
- [LOW] [deferred 3.9e] packages/harness/src/guardrails/warmup.ts — a matcher throw during warm-up leaves no trace (silent-failure-hunter)
- [LOW] [deferred 3.9e] apps/web/instrumentation.test.ts — no test for the warm-up's failure path (typescript-reviewer)

# 5.8d review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

Both reviewers approve. The diff touches only `apps/cli/src/commands/eval/liveAgent.ts` and its test. Each case gets its own cached session, so no state leaks between cases; the cache is bounded per agent instance; a failing turn aborts that case for good; and every test uses the scripted gateway or a stub judge, never a real model. Both reviewers raised the same latent cache-ordering point. No current caller can trigger it (the runner and the model sweep are sequential and never retry a case id), so it is wontfix with a decision.

## Findings

- [LOW] [wontfix] apps/cli/src/commands/eval/liveAgent.ts:182 — `setupFor()` caches a session before the persona ref is validated, and two concurrent `reply()` calls for one case id could race on the cache; neither can happen with today's sequential callers.

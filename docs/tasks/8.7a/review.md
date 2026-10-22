# 8.7a review — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), code-reviewer (opus), typescript-reviewer (sonnet), lead

## Findings

- [CRITICAL] [fixed] packages/db/src/repositories/publish.ts — startRun locked the agent and then the open run, while goLive locked the run and then the agent, so a re-click on Publish during a passed gate's goLive could deadlock (40P01) and lose the passed run. goLive now takes the same advisory lock, profile, agent, run order as startRun, with a two-connection test (database-reviewer re-verified commit 1d7f908).
- [MEDIUM] [fixed] packages/db/src/repositories/publish.ts — goLive cast `run.agentId as string` with no runtime check; it is now validated and re-checked after locking (1d7f908).
- [LOW] [deferred 8.7i] packages/db/src/repositories/publish.ts — recordResults does not bump eval_runs.updated_at, so "stale" is measured from markRunning, not the last progress; reword the stale-run decision and test name or bump it.
- [LOW] [deferred 8.7i] packages/db/src/repositories/publish.ts — latestRun has no agentId filter; fine while a teacher has one agent.
- [LOW] [deferred 8.7i] packages/db/src/repositories/publish.ts — RunSelect widens createdAt to nullable and casts it back instead of validating it in RunShape.
- [LOW] [deferred 8.7i] packages/db/src/repositories/publish.ts — latestRun and getRun use only the teacher_id index; add (teacher_id, created_at) when runs grow.
- [LOW] [deferred 8.7i] packages/db/migrations — the new FK is added without NOT VALID and the partial unique index without CONCURRENTLY; harmless today on a new all-NULL column, but later migrations on a populated eval_runs must use both.

# 8.3a review — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet)

## Findings

- [MEDIUM] [deferred 8.3c] packages/db/src/repositories/outline.ts — replaceOutline writes one UPDATE or INSERT per module and topic inside the locked transaction; batch them with jsonb_to_recordset.
- [LOW] [deferred 8.3c] packages/db/src/repositories/outline.ts — no expected outlineVersion from the client, so a stale save silently overwrites (plan scope decision 3).
- [LOW] [deferred 8.3c] packages/db/src/repositories/outline.ts — the ensureDefault advisory-lock hash can collide across teachers; the only effect is extra serialisation.
- [LOW] [deferred 8.3c] packages/db/migrations/0019_outline_topic_chunks.sql — the topic_chunks.teacher_id FK is ON DELETE no action; handle it in a teacher-deletion cleanup.

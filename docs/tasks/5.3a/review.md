# 5.3a review — APPROVE

Reviewers: security-reviewer, database-reviewer, rag-pipeline-reviewer, code-reviewer, typescript-reviewer

## Findings
- [HIGH] [fixed] packages/db/src/repositories/retrieval.ts — vectorRows' inner query ordered by distance alone before `LIMIT PER_SIGNAL`, so which tied rows made the cut depended on scan order, not lowest id, and the comment claimed determinism; now over-fetches `PER_SIGNAL * 2` and cuts after `(distance, id)`, with a tied-distance int test (database-reviewer, typescript-reviewer; MEDIUM from rag-pipeline-reviewer, security-reviewer, code-reviewer; re-checked by database-reviewer and typescript-reviewer)
- [LOW] [fixed] docs/tasks/5.3a/handoff.md — claimed `VECTOR_OVERFETCH` was exported; it is module-private (database-reviewer, re-check)
- [LOW] [fixed] docs/tasks/5.3a/handoff.md — described the far decoys as interspersed with lower ids; their ids are all higher (database-reviewer, re-check)

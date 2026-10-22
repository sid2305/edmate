# 11.2a review — APPROVE

Reviewers: security-reviewer (sonnet; also as typescript-reviewer and code-reviewer), database-reviewer (sonnet), lead

The security reviewer found the scoping sound: submit checks the teacher's live class, a live subscription for that student and the package in one statement; the teacher queue never selects a student id; errors carry no ids or text. The database reviewer raised one HIGH: the capped queue scan read newest first, so a teacher with more than 200 pending questions lost the oldest ones. Fix round 1 orders the scan oldest first, with a 201-row test that fails on the old order; the database reviewer re-checked it and found no new issue. The `.for('key share')` lock is correct (it blocks a concurrent cancel while the entitlement is checked) and now has a comment.

## Findings

- [HIGH] [fixed] packages/db/src/repositories/class-questions.ts:122 — listQueueForTeacher scanned newest first before the 200-row cap, so the oldest pending questions were dropped; now asc(createdAt), asc(id) with a test.
- [LOW] [deferred 11.2b] packages/db/src/repositories/class-questions.ts:109 — raw student text is stored as is; the Phase B page must render it only as text, never HTML.
- [LOW] [fixed] packages/db/src/repositories/class-questions.ts:109 — the `.for('key share')` lock on the entitlement check had no comment explaining it.
- [LOW] [deferred 11.2c] packages/db/src/repositories/class-questions.ts:109-123 — no composite index on class_questions (live_class_id, created_at, id) for the queue scan; fine at pilot volumes.

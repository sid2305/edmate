# Handoff: 11.2c — class_questions composite index

Status: DONE (folded into task 12.5d, PR #290)

## What changed
- Migration 0030_alert_queue_indexes.sql (task 12.5d) adds the composite index class_questions (live_class_id, created_at, id), replacing the single-column live_class_id index; packages/db/test/alert-queue-indexes.int.test.ts checks with EXPLAIN that the teacher queue scan uses it. See docs/tasks/12.5d/handoff.md and the "12.5d merge" decision.

## Decisions
None.

## Left to do
None.

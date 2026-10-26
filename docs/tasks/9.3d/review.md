# 9.3d review — APPROVE

Reviewers: code-reviewer, database-reviewer, typescript-reviewer

## Findings
- [HIGH] [fixed] packages/db/test/repositories.int.test.ts — if the bounded poll's assertion threw, finally released the lock while the unawaited start() was still in flight, so it could later insert a subscriptions row nothing cleaned up. Fixed (571f1b89): finally releases the lock, settles start(), then deletes any leaked rows for the test's student; typescript-reviewer re-approved.
- [LOW] [fixed] packages/db/test/repositories.int.test.ts — dead pg_stat_clear_snapshot() call in the poll loop removed.

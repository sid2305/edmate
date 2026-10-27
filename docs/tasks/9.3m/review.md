# 9.3m review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

## Findings
- [HIGH] [fixed] packages/db/src/repositories/teacher-profiles.ts — update()'s prev CTE read the old subject without a lock, so a concurrent update could write a stale "before" value into the teacher.subject audit row; fixed with FOR UPDATE plus a two-connection race test (database-reviewer, rated CRITICAL; the lead rates it HIGH)
- [MEDIUM] [fixed] packages/db/src/repositories/teacher-profiles.ts — the same race, seen as an audit-trail integrity issue (security-reviewer)
- [LOW] [fixed] packages/db/test/teacher-profiles.int.test.ts — no concurrency test for update(); added with the race fix (database-reviewer)
- [LOW] [deferred 9.3n] apps/web/app/staff/verification-row.tsx — the subjectHistory list is keyed on the array index (typescript-reviewer)
- [LOW] [deferred 9.3n] apps/web/app/api/staff/verifications — no route test where findSubjectHistoryForStaff throws inside enrichQueueRows (code-reviewer)
- [LOW] [wontfix] packages/db/test/teacher-profiles.int.test.ts — waitForLockWait polls pg_stat_activity for any waiting session, not the pending call's own; fine while this file's int tests run serially, as every db int test file does today (database-reviewer)

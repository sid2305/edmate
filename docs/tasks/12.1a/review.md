# 12.1a review — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), typescript-reviewer (sonnet, also as code-reviewer), lead

## Findings

- [HIGH] [fixed] packages/db/src/repositories/teacher-profiles.ts — listPendingForStaff ordered by created_at only, so rows with the same created_at could change places between reads. The fix orders by (created_at, id), and a test seeds two rows with the same created_at; database-reviewer verified it.
- [HIGH] [fixed] packages/db/test/teacher-profiles.int.test.ts — the "never exceeds STAFF_QUEUE_MAX_LIMIT rows" test only checked an empty queue. The fix seeds STAFF_QUEUE_MAX_LIMIT+1 pending teachers and checks that exactly the oldest STAFF_QUEUE_MAX_LIMIT come back; typescript-reviewer verified it.
- [LOW] [fixed] packages/db/test/teacher-profiles.int.test.ts — database-reviewer raised the same untested cap, fixed by the same test.
- [MEDIUM] [deferred 12.1c] packages/db/src/schema/users.ts — no partial index supports `verification_status = 'pending' ORDER BY created_at`; fine at pilot scale.
- [MEDIUM] [deferred 12.1c] packages/db/test/leak.test.ts — listPendingForStaff is not in the driver-error leak-test list, although it is the first repository read outside discovery that joins name and email; scrubbing is still enforced structurally.
- [LOW] [deferred 12.1c] packages/db/src/role-lock.ts — the module comment says repositories never name the users table; teacher-profiles.ts now does.
- [LOW] [deferred 12.1c] packages/db/test/scope.test.ts — the "reads a user only through role-lock.ts" test title is now imprecise.

security-reviewer checked that the id is validated before any SQL, only staff get the list, the join selects name and email (never phone), and setVerification is still the only write path.

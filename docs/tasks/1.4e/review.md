# 1.4e review — APPROVE

Reviewers: security-reviewer, typescript-reviewer, code-reviewer

## Findings
- [CRITICAL] [fixed] apps/web/src/auth/redis-ready.ts — every caller subscribed to a shared promise that never settled during an outage, so with steady sign-in traffic the waiter count never reached 0 and callbacks piled up without bound; fix round 1 uses a set of per-caller callbacks that each caller removes on timeout (security-reviewer)
- [MEDIUM] [fixed] apps/web/src/auth/redis-ready.test.ts — no test for ready firing after every caller timed out, or a new caller after the last timeout; added in fix round 1 with a bounded-memory test (security-reviewer, typescript-reviewer, code-reviewer)
- [LOW] [fixed] apps/web/src/auth/redis-ready.ts — the comment on when the entry is dropped was wrong for the ready path; reworded in fix round 1 (typescript-reviewer, code-reviewer)

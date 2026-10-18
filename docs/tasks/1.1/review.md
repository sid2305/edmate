# 1.1 review — APPROVE
Reviewers: database-reviewer (sonnet), security-reviewer (sonnet), typescript-reviewer (sonnet)

database-reviewer confirmed every Data model table and column, `teacher_id`/`student_id` indexed leading where required, all FKs `ON DELETE no action` (no cross-teacher cascades), correct unique constraints, money as bigint minor units with an ISO 4217 CHECK, `timestamptz`, and a create-only reproducible migration. security-reviewer confirmed the CI Postgres image is pinned by digest, throwaway CI credentials, unchanged job names and permissions. typescript-reviewer re-ran the db gates (35 tests incl. real Postgres), no `any`, exact pins, and that integration tests fail rather than skip when `CI=true`. The lead merged main into the branch (lockfile conflict with 2.1, regenerated; 40/40 gates).

## Findings
- [MEDIUM] [deferred 1.2] packages/db/src/schema/agents.ts:30 — jsonb columns infer `unknown`, not the contract types; 1.2's repositories add `.$type<>()` and type checks where they map rows to contract shapes.
- [LOW] [wontfix] packages/db/src/schema/billing.ts:17 — `bigint` in number mode loses precision above 2^53; contracts use JS numbers too. See decision log 18 Oct 2026.
- [LOW] [deferred 1.2] packages/db/src/schema/learning.ts:56 — messages and turn traces are scoped through `sessions`; 1.2's repositories join on it.
- [LOW] [deferred 1.2] packages/db/src/client.ts:19 — pool has no max, idle timeout or statement timeout; set them in 1.2.

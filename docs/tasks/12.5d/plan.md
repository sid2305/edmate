# Plan: 12.5d — safety-alert and class-question indexes (lead-written)

**Status:** READY · one phase · packages/db only

## Acceptance (verbatim)
"per docs/tasks/12.5a/review.md deferred findings; db typecheck, lint and test green."
Lead decision (25 Oct 2026): 11.2c ("a composite index on class_questions (live_class_id,
created_at, id) for the teacher queue scan"; accept "additive migration; db typecheck, lint and
test green") is folded into this task: both are one-migration index changes in the same package,
so one branch and one review round cover them. 11.2c closes with 12.5d.

## Items
1. **12.5a MEDIUM — staff inbox sort.** `listForStaff` in
   `packages/db/src/repositories/safety-alerts.ts` (~line 214) orders by
   `acknowledged_at is not null`, `escalated_at is null`, `created_at asc`, `id asc`, limited.
   The partial index `safety_alerts_open_created_at_id_idx` (created_at, id) WHERE acknowledged_at
   is null cannot serve that order, so Postgres sorts the open set. Add an index whose key matches
   the ORDER BY for the open list, e.g. an expression index on
   `((acknowledged_at is not null), (escalated_at is null), created_at, id)` WHERE
   `acknowledged_at is null`, declared in `packages/db/src/schema/operations.ts` with drizzle's
   `index().on(sql\`...\`, ...)` form. **Do not change the query** (the repository file is a risk
   path; leave it untouched). If the planner can't use the expression index without a query
   change, stop PARTIAL and say so rather than editing the repository.
   Decide whether the old `safety_alerts_open_created_at_id_idx` is still used by any query
   (grep for queries filtering open alerts ordered by created_at only); drop it only if nothing
   else uses it, and log the decision either way.
2. **12.5a LOW — `acknowledged_by` FK index.** Add `index('safety_alerts_acknowledged_by_idx')`
   on `acknowledged_by` (partial WHERE acknowledged_by is not null is fine) in the same schema.
3. **11.2c — class_questions queue scan.** `packages/db/src/repositories/class-questions.ts`
   (~line 146) orders by `created_at, id` per live class. Replace
   `class_questions_live_class_id_idx` (live_class_id) with
   `class_questions_live_class_id_created_at_id_idx` (live_class_id, created_at, id); the old one
   is a strict prefix, so dropping it loses nothing. Schema in `operations.ts` (~line 118).

## Files
- `packages/db/src/schema/operations.ts` (modify)
- `packages/db/migrations/0030_<name>.sql` plus `packages/db/migrations/meta/*` — generate with
  the repo's drizzle-kit script (check `packages/db/package.json`), never hand-edit meta.
- `packages/db/test/<existing index or migration test>.int.test.ts` (modify or add): one test per
  new index that asserts it exists in `pg_indexes` with the expected definition, and one EXPLAIN
  test for item 1 on a handful of seeded open alerts with `SET LOCAL enable_seqscan = off` inside
  a transaction, asserting the plan uses the new index with no Sort node. If an EXPLAIN test
  proves flaky, keep only the pg_indexes assertion and say so in the handoff.
- `docs/tasks/12.5d/handoff.md`
- Out of bounds: `packages/db/src/repositories/**` (risk path), any other package.

## Risk paths
None if the repository files stay untouched. A migration that drops an index is not a data drop,
but database-reviewer runs anyway.

## Reviewers
database-reviewer, code-reviewer, typescript-reviewer.

## Gate
`TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db`
(confirm the int tests ran, not skipped) and `python3 .githooks/secret-scan.py --all`.

## Budget
30 tool calls (about 10 of them setup), stop at 38.

# 9.2a review — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings
- [MEDIUM] [wontfix] packages/db/src/repositories/discovery.ts — bad input throws 'scope' where the plan says 'invalid'; the lead ratified the existing public-read convention.
- [MEDIUM] [deferred 9.2e] packages/db/test/discovery.int.test.ts — the no-seq-scan test sets enable_seqscan off, so it can't fail; assert the index the real statement actually uses, or add a scale fixture where the GIN index takes over.
- [MEDIUM] [deferred 9.2e] packages/db/src/cli.ts — `.values(seed[table] as never)` in the seed loop hides schema/seed mismatches from tsc; narrow per table.
- [LOW] [deferred 9.2e] packages/db/migrations/0020_teacher_profile_search.sql — the stored generated column rewrites the table under ACCESS EXCLUSIVE; use a batched pattern once the table is large.
- [LOW] [deferred 9.2e] packages/db/src/repositories/discovery.ts — three or four near-identical correlated subqueries per row; one lateral join would do once the teacher base grows.
- [LOW] [deferred 9.2e] packages/db/src/repositories/discovery.ts — comment at teacherBySlug that the full, untruncated bio is intentional.
- [LOW] [deferred 9.2b] packages/db/src/repositories/discovery.ts — no rate limiting on the public search; add request-level limits on the /teachers routes.

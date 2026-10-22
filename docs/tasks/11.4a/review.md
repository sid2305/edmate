# 11.4a review — APPROVE
Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (opus)

Migration 0024 adds a nullable documents.live_class_id with a foreign key (ON DELETE SET NULL, added NOT VALID and validated by the post-migrate step, as in 0009 and 0023) and a partial index. documents.create links only the teacher's own class that has already started: another teacher's class, a future class and a missing id all give the same not_found, with no row written. listRecordingsForTeacher scopes both sides of the join to the teacher and returns at most 500 rows with no storage keys. All four reviewers approve. The typescript-reviewer re-ran the changed db tests against its own Postgres (392 pass; drizzle-kit reports no schema drift). Two test-only LOWs are deferred to 11.4e.

## Findings
- [LOW] [deferred 11.4e] packages/db/test/documents.int.test.ts:660 — the cap test only checks that the constant is 500; removing .limit() at live-classes.ts:216 still passes.
- [LOW] [deferred 11.4e] packages/db/src/repositories/live-classes.ts:212 — the same-teacher join check has no test of its own (defence in depth; create already refuses another teacher's class).

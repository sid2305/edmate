# 3.17 review — APPROVE
Reviewers: security-reviewer (sonnet), database-reviewer (sonnet)

A security plan review came before the build. security-reviewer approved the build with no findings:
- every adapter is scoped by the entitlement;
- TeacherQuestion stores scrubbed text only;
- the raw-SQL open is parameterised and tenant-scoped;
- one shared serialisation is used for the evidence id;
- applyMastery never touches last_summary.

database-reviewer found 1 HIGH, 1 MEDIUM and 1 LOW. One fix round (33522c6) fixed all three and was re-verified. db 491 tests pass on Postgres with nothing skipped; `db:generate` is a no-op.

## Findings
- [HIGH] [fixed] packages/db/src/repositories/ports.ts:97 — a lost BKT update under concurrent applyEvidence. Now one transaction with SELECT ... FOR UPDATE on the profile row; the 10-concurrent test gives n == 10; re-verified, with no deadlock risk.
- [MEDIUM] [fixed] packages/db/migrations/0011_teacher_question_open_dedup.sql:11 — the unique index could fail on duplicate open rows. Duplicates are dismissed first (none deleted), with a migration test.
- [LOW] [fixed] packages/db/src/mastery.ts:21 — NaN silently fell back to pInit. It now throws RangeError.
- [LOW] [deferred 3.16d] packages/db/migrations/0011_teacher_question_open_dedup.sql:29 — a plain CREATE UNIQUE INDEX inside drizzle's transaction; teacher_questions is small and low-write today. Move it to a post-migrate concurrent step before real traffic.

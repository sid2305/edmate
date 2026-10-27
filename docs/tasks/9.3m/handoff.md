# 9.3m handoff — Phase A (packages/db)

Status: **DONE**

## Summary

Built, tests-first, the `teacher.subject` audit write and its staff-only read, per B-58.

- `packages/db/src/repositories/teacher-profiles.ts` — `update()`: when a patch changes
  `subject`, the UPDATE now runs as one statement with a sibling read-only `prev` CTE (`with prev
  as (select subject from teacher_profiles where user_id = $1), upd as (update ... from prev
  where ... returning ...) select upd.*, prev.subject as prev_subject from upd, prev`), issued via
  `db.transaction` + `tx.execute(sql\`...\`)`. The old subject is compared to the new one in
  application code; when they differ, `insertAuditEntry` writes a `teacher.subject` row (`actor:
  teacherId, actorRole: 'teacher', before: { subject }, after: { subject }`) in the same
  transaction. The no-subject-change path (displayName/bio/languages only) is untouched: still one
  plain `db.update(...).returning(columns)`, no transaction, no audit row. An empty-array
  `languages` value needed `sql.param(...)::text[]` (plain interpolation turned `[]` into `()`,
  a Postgres syntax error) — same precedent as `teacher-questions.ts`.
- `packages/db/src/repositories/audit.ts` — new `SUBJECT_HISTORY_MAX_LIMIT = 10` and
  `findSubjectHistoryForStaff(by, teacherId, limit)`: parses all three args before any SQL
  (`invalid` on a malformed id or an out-of-range limit), `lockRole`-gated to staff (`scope`
  otherwise), reads the last `limit` `teacher.subject` rows newest-first, parses each row's
  `before`/`after` with a local `{ subject: string }` zod shape (`integrity` on a bad shape),
  returns `{ from, to, ts }[]`.
- Tests: `packages/db/test/audit.test.ts` (new `describe` block, malformed staff/teacher id and
  malformed/out-of-range limit, all `invalid`), `packages/db/test/scope.test.ts` (one new
  exclusion line), `packages/db/test/teacher-profiles.int.test.ts` (each subject-reset case now
  also asserts the matching `teacher.subject` row; new cases for a same-value no-op writing no
  row, two sequential changes writing two rows newest-first, and the no-subject not_found branch —
  see Decisions), `packages/db/test/repositories.int.test.ts` (new `'audit.findSubjectHistoryForStaff'`
  grid entry: scope/invalid/empty/newest-first/limit/integrity cases; added the method name to the
  append-only method-list test).

## Decisions

### 26 Oct 2026 · 9.3m the new audit write and its lock-order/no-read-then-write-window property · decided by builder · risk: high
- Decided: `teacherProfiles.update()` now writes a `teacher.subject` audit row (old/new subject
  only) when a patch changes the stored subject, captured in the same statement as the UPDATE (a
  sibling read-only CTE) so there is no read-then-write window; `audit.findSubjectHistoryForStaff`
  reads the last `SUBJECT_HISTORY_MAX_LIMIT` (10) such rows for staff. B-58.
- Why: matches the plan's design exactly; the CTE shape expressed cleanly as raw SQL via
  `tx.execute(sql\`...\`)` (same pattern as `publish.ts`'s own raw CTE reads), no new shared SQL
  helper needed.

### 26 Oct 2026 · 9.3m test fixes for the shared-audit-log test file · decided by builder · risk: low
- Decided: (a) existing tests in `teacher-profiles.int.test.ts` that query `audit.listForTeacher`
  by `target` only (not `action`) now filter to `action === 'teacher.verify'` before asserting a
  row count, since `teacherId('A')`'s target string is now also written by `teacher.subject` rows
  from earlier tests in the same file (audit_log is append-only and never truncated between
  tests, by design — same precedent as the existing `auditCount()` delta pattern). (b) the new
  subject-audit assertions in that file use `rows[0]` / a before-and-after length delta rather than
  an exact-array `toEqual`, for the same reason. (c) added one new test for the no-subject-patch
  `not_found` branch (`update(A, { bio: 'X' })` on a ghost profile), since splitting `update()`
  into two branches (subject vs. no-subject) left that branch's own `not_found` throw uncovered.
- Why: the plan's test sketches assumed per-test isolation that the file's own existing
  `auditCount()`-delta convention shows was never actually true for this append-only table; fixing
  the assertions (not the feature) keeps the 100%-statement-coverage rule without weakening what
  each test actually checks.

## Gate

```
$ corepack pnpm install --frozen-lockfile
Done (no changes)

$ TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate \
  corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
@edmate/db:typecheck: tsc --noEmit -p tsconfig.json  (pass)
@edmate/db:lint: eslint .  (pass)
@edmate/db:test: vitest run --coverage
  Test Files  80 passed (80)
  Tests  1728 passed | 4 skipped (1732)
  src/repositories  | 100% stmts | 98.38% branch | 100% funcs | 100% lines
  (coverage thresholds for src/repositories/** all met; one unrelated flaky
  retrieval-leak.int.test.ts SLO failure seen once on a loaded machine, not
  reproduced on rerun)

$ corepack pnpm exec prettier --check <files changed>
All matched files use Prettier code style!

$ python3 .githooks/secret-scan.py --all
(clean, no output)
```

Web/worker (`...@edmate/web...`) were not run: Phase A touches no exported type Phase B depends
on yet (the plan's own note — Phase A's gate only needs `@edmate/db`).

## Budget

Tool calls used: 61

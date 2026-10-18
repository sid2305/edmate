# Repositories: scoped by teacher and by student (task 1.2)

Isolation between teachers and between students is enforced here, not by Postgres RLS (decision
"1.1 Isolation in repositories, not RLS"). These rules hold for every method:

1. **Scope first, always required.** The first parameter is a `TeacherScope` (`{ teacherId }`) or a
   `StudentScope` (`{ studentId, teacherId }`; student data is always per student x teacher). No
   method has an optional scope or an overload without one.
2. **Validated at runtime before any SQL.** `teacherScope()` / `studentScope()` parse with schemas
   picked from the contracts (strict objects, contracts id format). A bad scope throws
   `RepositoryError('scope')`. This matters because Drizzle's `and()` drops `undefined` conditions,
   so an unchecked `undefined` id would widen a query.
3. **The scope is in the WHERE clause of the same statement** that reads or writes. Ownership
   checks for writes are atomic: `INSERT … SELECT … FROM <owner table> WHERE id = $x AND
   teacher_id = $t …` (zero rows inserted → `not_found`), or a `FOR KEY SHARE` check plus the
   insert in one transaction when a set of ids (modules, topics, similar questions) must all be the
   teacher's.
4. **Messages and turn traces are scoped through `sessions`** (`ownSession()` in `sessions.ts`):
   a join for reads, `INSERT … SELECT … FROM sessions WHERE <scope>` for writes.
5. **Fail closed without an existence oracle.** Another scope's row and a missing row look the
   same: reads return `null` / `[]`, writes throw `not_found`. Payload ids that disagree with the
   scope throw `scope` before SQL. Error messages name the method and kind only.
6. **Rows leave as contract shapes, parsed** (`map.ts`). A stored row that fails its contract, or
   whose jsonb `teacherId` / `id` / `version` disagrees with its columns, throws `integrity`.
7. **Ownership columns are immutable.** No method updates `teacher_id`, `student_id` or
   `session_id`. There are no delete methods (retention is 13.4, memory reset 6.5).
8. **No raw SQL strings.** No `sql.raw(` and no deletes in this folder (`test/scope.test.ts`
   checks).
9. **No personal details.** No method selects from the user table, so display names, emails and
   phone numbers never leave through a repository. `teacherQuestions.listForTeacher` never selects
   `student_id`.

## Adding a method

Add it to a repository returned by `createRepositories`, then add its case to `CASES` in
`test/repositories.int.test.ts`. `CASES` is a `Record<RepositoryMethod, IsolationCase>`, so the
package does not typecheck until the case exists; the test also compares the methods it finds at
runtime with `CASES`, and `test/scope.test.ts` calls every method with bad scopes.

## Ports

Frozen ports without a scope parameter are bound to a scope at construction:
`transcriptStoreFor(repos, scope)` returns a `TranscriptStore` for one student x teacher, built
per turn by the caller. Other port adapters (EntitlementStore 3.2, ProfileStore 6.2,
TeacherQuestionStore / CorrectionStore 5.10, UsageMeter 2.4, TraceSink 3.8 / 7.7, RetrievalIndex
5.3 / 5.4) belong to their tasks and must add their isolation cases here.

## Package surface

`@edmate/db` exports `openDatabase`, the repositories, scope parsers and `RepositoryError`, and
the migrator. The raw Drizzle handle and the schema are only in `@edmate/db/internal`, for
migrations, the seed and tests.

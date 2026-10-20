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
   checks for writes are atomic:
   `INSERT … SELECT … FROM <owner table> WHERE id = $x AND teacher_id = $t …` (zero rows inserted
   → `not_found`), or a `FOR KEY SHARE` check plus the insert in one transaction when a set of ids
   (modules, topics, similar questions) must all be the teacher's.
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

10. **Driver errors are scrubbed.** `createRepositories` wraps every method in `guarded()`: any
    error that is not a `RepositoryError` becomes `RepositoryError('failed')` whose cause keeps
    only the driver's error code and constraint name. Drizzle's own message
    ("Failed query: … params: …") quotes ids and student text, so it never leaves.
    `messages.append` reports a duplicate (caller-chosen, globally unique) message id as
    `not_found`, so ids in other sessions can't be probed.

11. **Two reads without a teacher or student scope.** `agents.owner({ agentId })` (task 3.2)
    returns `{ teacherId }` for a `live` agent and nothing for a draft, suspended or missing one,
    because which teacher owns a live agent is public on teacher pages.
    `usageLedger.teacherIdsWithUsageSince({ since })` (task 3.8) is a system read for the
    scheduled cost alarm: the sorted ids of teachers with non-eval usage since a date, and nothing
    else (no student, package or figure). Both arguments are parsed like a scope (`scope` error
    before any SQL). Only server jobs call the second; no route exposes it.

12. **Help state** (ADR-0005, task 3.8). `sessions.saveHelpState` writes `help_state` of the
    scope's own open session only (`ended_at IS NULL` in the same UPDATE; else `not_found`), and
    refuses a value over `LIMITS.helpStateMaxJsonLength` or not serialisable (`invalid`) before
    any SQL. It holds the answer key: no other method writes it, and no message or trace does.

## Audit log (task 1.6)

`audit` is append-only: `appendForTeacher` / `appendForStudent` and two scoped lists, no update or
delete. Every row carries `teacher_id`; student x teacher rows (memory changes) also carry
`student_id`, and only the student scope reads them (`listForTeacher` returns teacher-only rows).
A teacher or student actor must be the scope's own; staff may act in any scope. `before` / `after`
go through JSON, then `redactPersonalData()` (`redact-json.ts`), then a 10 000-character cap
(larger is `invalid`, never truncated). The redaction is defense in depth: callers still keep
personal text out of these payloads.

Staff's cross-teacher view (the trust console, 12.1) is a different access pattern that rule 1
does not allow; 12.1 adds and reviews its own read path. Nothing here reads across teachers.

## Adding a method

Add it to a repository returned by `createRepositories`, then add its case to `CASES` in
`test/repositories.int.test.ts`. `CASES` is a `Record<RepositoryMethod, IsolationCase>`, so the
package does not typecheck until the case exists; the test also compares the methods it finds at
runtime with `CASES`, and `test/scope.test.ts` calls every method with bad scopes.

## Ports

Frozen ports without a scope parameter are bound to a scope at construction:
`transcriptStoreFor(repos, scope)` returns a `TranscriptStore` for one student x teacher, built
per turn by the caller. `entitlementStoreFor(repos, opts)` (3.2) binds the trusted server state
(the user's market, the studio's preview package, the eval run's pinned package) and resolves all
three sources; `turnConfigStoreFor(repos, { locales })` (3.2, ADR-0004) loads a turn's agent,
package, style card and locale pack and returns null unless the session is the entitlement's and
open. Other port adapters (ProfileStore 6.2,
TeacherQuestionStore / CorrectionStore 5.10, TraceSink 3.8 / 7.7, RetrievalIndex 5.3 / 5.4; see
§ Retrieval)
belong to their tasks and must add their isolation cases here.

**UsageMeter (task 2.4, done).** `usageMeterFor(repos, scope)` binds one student x teacher and
returns the frozen `UsageMeter` plus `recordUnmetered`: the sink `@edmate/gateway`'s
`createMeteredGateway` writes to. A context naming another pair is `scope`. The `usageLedger`
repository's four methods have their cases in `CASES`; writes take the package from the scope's
teacher (`INSERT … SELECT … FROM packages WHERE id = $p AND teacher_id = $t`, else `not_found`).
A call with unknown usage, or an unpriced model, is a row with `status` `unknown` / `unpriced`,
a fixed `reason`, and NULL for what is not known (tokens and cost, or cost); a CHECK requires a
`recorded` row to have every figure. One row per provider attempt: `@edmate/gateway` meters each
adapter, so a primary that fails over has its own row. Rows hold ids, the model id, tier, counts,
cost and the reason code only; never request text (`test/usage-ledger.int.test.ts` checks the
parameters every write sends).

**Cost alarm (task 2.5).** Two teacher-scoped methods for `apps/worker/src/alarms`:
`usageLedger.sumForTeacherSince(scope, since)` sums one teacher's rows since an ISO timestamp
(inclusive) across every student, leaving out `eval` rows (billed to Edmate), with the same
`recorded` / `unknown` / `unpriced` split as `sumForStudent` (index
`usage_ledger_teacher_id_created_at_idx`). `subscriptions.pauseFreeForTeacher(scope, { monthStart,
reason })` pauses, in one transaction, every trial / active / past_due subscription of the scope's
teacher whose package version is free (`pricePerMonth.amountMinor` = 0), and writes one audit row
per pause (actor `system_cost_alarm`, role `system`, student x teacher row, before/after status).
Paid, ended and already paused subscriptions are never touched. A subscription with a
`subscription.pause_cost_alarm` audit row since `monthStart` is skipped, so a staff unpause holds
for the rest of the month. Both have cases in `CASES`; `test/cost-alarm.int.test.ts` checks the
sums against raw SQL, the free/paid split, the audit rows, the once-a-month rule and concurrency.
The audit `system` role (enum `audit_actor_role`, separate from `user_role` so no user can hold
it) requires an actor id starting `system_`, and no other role may use that prefix.

## Retrieval (task 5.3)

**Writes.** `documents.create(scope, { id, moduleId, kind, sourceTitle, storageKey? })` is
`INSERT … SELECT FROM modules WHERE id = $m AND teacher_id = $t`; another teacher's module, a
missing one and a document id already taken by anyone are all `not_found`.
`chunks.insertMany(scope, documentId, drafts)` reads the document in the scope (and its module,
still the teacher's) in the same statement, and takes teacher, module, kind and source title from
it, so a chunk can't be filed under another teacher's module. Chunk ids are
`<documentId>-c<0000>` (document order without an `ord` column); writing the same `ord` twice is
`invalid`. `chunks.setEmbeddings(scope, items)` is all or nothing: any id that is not the scope's
is `not_found` and nothing is written; vectors are checked (1536 finite numbers) before SQL.

**Material revision.** Every write above bumps `teacher_material_revisions.revision` for the
scope's teacher in the same transaction (`retrieval.revision(scope)` reads it; 0 before any
write). leakCheck's cache key includes it (ADR-0007). **Any future path that deletes or edits a
teacher's documents or chunks (8.x, 13.4) must bump it too**, or a cached leak index goes stale.

**Search and probe.** `retrieval.search(scope, { q, allowedModuleIds, k, embedding? })` runs
one statement per signal (full text over the generated `'simple'` tsvector with prefix terms and a
short stop-word list; vector by cosine distance when an embedding is given), each with
`teacher_id = $t AND module_id IN (allowed) AND module_id IN (the teacher's modules)` in the same
WHERE clause, before ranking. Results are fused by reciprocal rank (k = 60, ties by id), matching
teacher notes go first, and `score` is an absolute 0-1 relevance (not the RRF value; constants
calibrated in 5.3 Phase D). Allowed ids the teacher does not own are ignored. Module ids are part
of the scope: malformed is `scope`. `retrieval.probe(scope, { q, moduleIds, embedding? })` ranks
the same way over the scope's own `moduleIds` and returns only `{ hit, score }` (ADR-0003).

**Port.** `retrievalIndexFor(repos, { embedder?, embedTimeoutMs?, onEmbedFallback? })` is the
production `RetrievalIndex`: it validates the port scope before embedding the query, and an
embedder that throws, times out (800 ms default) or returns a bad vector falls back to full text,
reporting only a fixed code (`embed_failed` / `embed_timeout` / `embed_invalid`), never the
query or the error.

**leakCheck (ADR-0007).** `retrieval.material(scope)` returns every chunk text of the teacher's own
modules, ordered by module, document and chunk; only leakCheck reads it, and it never leaves the
adapter. leakCheck rejects a malformed scope (`scope`) or candidate list (`invalid`) before any
SQL, then reads the revision and takes the locked index for (teacher, revision, sorted allowed
ids) from an LRU cache of 64 (`leakCache.ts`), or builds it with the shared `lockedIndex` from
`@edmate/harness`: modules outside `allowedModuleIds` are locked (draft and unpackaged ones
included), a span also in an allowed module is ignored. Another teacher's module ids in the
allowed list match none of this teacher's chunks, so they widen nothing. The call races
`leakTimeoutMs` (100 ms default); a timeout or any error is `{ hit: true }`, reported to
`onLeakFallback` as `leak_timeout` / `leak_failed` only. A cold build that loses the race keeps
running (dropped after `leakBuildTimeoutMs`, 30 s), so the next call is warm. A newer revision
drops the teacher's older entries; a failed build is never cached. Nothing here logs.

## Package surface

`@edmate/db` exports `openDatabase`, the repositories, scope parsers and `RepositoryError`, and
the migrator. The raw Drizzle handle and the schema are only in `@edmate/db/internal`, for
migrations, the seed and tests.

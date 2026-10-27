# Repositories: scoped by teacher and by student (task 1.2)

Isolation between teachers and between students is enforced here, not by Postgres RLS (decision
"1.1 Isolation in repositories, not RLS"). These rules hold for every method:

1. **Scope first, always required.** The first parameter is a `TeacherScope` (`{ teacherId }`) or a
   `StudentScope` (`{ studentId, teacherId }`; student data is always per student x teacher). No
   method has an optional scope or an overload without one.

   **Bare-id exception (9.4e item 5).** Two kinds of method take a bare id instead, still validated
   with a schema before any SQL, never an optional or overloaded scope: (a) a staff-only method
   (`teacherProfiles.listPendingForStaff`, `reports.listOpenForStaff` / `.review`,
   `safetyAlerts.listForStaff` / `.acknowledge`, `takedowns.create` / `.lift` /
   `.listActiveForStaff`, the regulated-subjects `listForStaff` / `setSubject` / `setApproval`)
   takes the acting user's own id `by` first, checked with `role-lock.ts`'s `lockRole` (not
   staff right now is `scope`, never an existence check on anyone else); and (b)
   `subscriptions.listLiveForStudent` / `.listUnavailableForStudent` take the signed-in student's
   own `studentId` alone, because they read across every teacher by design (a per-teacher
   `StudentScope` can't express that) — same `IdSchema` guard as every other id here, just with
   no `teacherId` half.
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
   `session_id`. The delete methods are `documents.delete` and `documents.startReplace` (task 8.2,
   § Documents below), `learnerProfiles.reset`'s delete of `evidence_events` (task 6.5, §
   Memory reset and export below) and `outline.replaceOutline`'s delete of dropped `topics` and
   of kept topics' `topic_chunks` links (task 8.3, § Outline below); whole-account retention is
   13.4. `topic_chunks` has two `ON DELETE CASCADE` foreign keys (to `topics` and `chunks`), so
   those deletes and `documents.delete` also drop links; no ownership column is ever updated by
   them (an outline edit changes only titles, orders, a topic's module and the row set).
8. **No raw SQL strings.** No `sql.raw(` and no `delete from` text in this folder; Drizzle
   `.delete(` appears only in `chunks.ts` (on `chunks` and `documents`), in `learner.ts` (on
   `evidence_events` alone) and in `outline.ts` (on `topics` and `topic_chunks`), each with the
   scope's columns (`teacherId`, and `studentId` for `evidence_events`) in the same statement
   (`test/scope.test.ts` checks).
9. **No personal details.** No method selects from the user table, so sign-in names, emails and
   phone numbers never leave through a repository, except `discovery.ts` (`users.role` only, to
   find teacher accounts -- task 9.2d moved the public display name to
   `teacher_profiles.display_name`, so `discovery.ts` no longer reads `users.name`, § 11 below)
   and `teacherProfiles.listPendingForStaff` (task 12.1a, § 11 below): staff-only, name and
   email, never phone. `teacherQuestions.listForTeacher` never selects `student_id`. Any new
   staff/role check inside a transaction uses `role-lock.ts`'s `lockRole`, never a fresh select.

10. **Driver errors are scrubbed.** `createRepositories` wraps every method in `guarded()`: any
    error that is not a `RepositoryError` becomes `RepositoryError('failed')` whose cause keeps
    only the driver's error code and constraint name. Drizzle's own message
    ("Failed query: … params: …") quotes ids and student text, so it never leaves.
    `messages.append` reports a duplicate (caller-chosen, globally unique) message id as
    `not_found`, so ids in other sessions can't be probed.

11. **The public reads: no teacher or student scope at all.** `agents.owner({ agentId })` (task
    3.2) returns `{ teacherId }` for a `live` agent and nothing for a draft, suspended or missing
    one, because which teacher owns a live agent is public on teacher pages.
    `packageVersions.liveForAgent({ agentId })` (task 9.3) returns the public `offer` of each of a
    live agent's live packages, never the teacher's internal config. `discovery.search` and
    `discovery.teacherBySlug` (task 9.2, display name task 9.2d) are the only unauthenticated
    reads anyone can reach from a page: a verified teacher with a live agent and at least one
    live, sellable package shows a `PublicTeacherCard` (slug, `displayName` -- the teacher's own
    `teacher_profiles.display_name`, falling back to `slug` when the teacher has not set one yet,
    never the sign-in name `users.name` -- subject, a 280-character bio excerpt on search cards,
    languages, `packageCount`, `hasFree`) or, by slug, a `PublicTeacherPage`
    (the card plus the agent's live ids, capped at 5) — never `userId`, email, phone, photo,
    payout ref or verification status. A pending, rejected, role-changed, draft-agent,
    suspended-agent or no-live-package teacher is absent from `search` and `null` by slug, the
    same as a missing one (no enumeration). `usageLedger.teacherIdsWithUsageSince({ since })`
    (task 3.8) is a system read for the scheduled cost alarm: the sorted ids of teachers with
    non-eval usage since a date, and nothing else (no student, package or figure). Every argument
    is parsed like a scope or a strict input (`scope`/`invalid` before any SQL). Only server jobs
    call `teacherIdsWithUsageSince`; no route exposes it. `usageLedger.costByPackageSince({
    since, until? })` and `subscriptions.activeCountByPackage()` (task 13.5, the cost dashboard)
    are the same kind of unscoped system read -- totals and active-student counts grouped by
    `(teacherId, packageId)` across every teacher, no student-level detail. The staff-only
    `/api/staff/cost` route is the one caller: it joins the two by `(teacherId, packageId)` after
    checking the caller is staff.

    `teacherProfiles.listPendingForStaff(by)` (task 12.1a) is not a public read -- it takes no
    `TeacherScope`/`StudentScope`, but it is staff-only, checked by a plain (unlocked) read of
    `by`'s role: a malformed `by` is `invalid`, a well-formed `by` that is not staff now is
    `scope`. It is the one repository method that joins `users` for `name` and `email` (never
    `phone`), because staff need them to check a teacher's declared identity before approving or
    rejecting; pending teachers only, oldest first, capped at `STAFF_QUEUE_MAX_LIMIT` (50).

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
runtime with `CASES`, and `test/scope.test.ts` calls every method with bad scopes. A role or
staff check inside a transaction uses `role-lock.ts`'s `lockRole`; `teacher-profiles.ts`'s
`setVerification` is the existing example.

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
SQL (at most `LEAK_CANDIDATES_MAX` candidates of `LEAK_CANDIDATE_MAX_LENGTH` characters, 4x the
harness's largest legitimate batch), then reads the revision and the teacher's module ids
together and takes the locked index for (teacher, revision, sorted **owned** allowed ids) from an
LRU cache of 64 (`leakCache.ts`), or builds it with the shared `lockedIndex` from
`@edmate/harness`: modules outside the owned allowed set are locked (draft and unpackaged ones
included), a span also in an allowed module is ignored. Another teacher's or an unknown module id
in the allowed list is dropped before the key, so it widens nothing and shares the owned key
(task 5.4). The call races
`leakTimeoutMs` (100 ms default); a timeout or any error is `{ hit: true }`, reported to
`onLeakFallback` as `leak_timeout` / `leak_failed` only. A cold build that loses the race keeps
running (dropped after `leakBuildTimeoutMs`, 30 s), so the next call is warm. A newer revision
drops the teacher's older entries; a failed build is never cached. Nothing here logs.

**Full-text terms.** Each query term goes to `to_tsquery` as a quoted literal (`'term':*`,
`tsTerm`), so no character, Unicode or tsquery syntax, can make the query raise.

**The cache rule (task 5.4, ADR-0003 point 6).** A cache that holds anything derived from teacher
material or an entitlement is keyed by everything that decides access: the package id and version,
or the exact owned allowed-module set, plus the material revision for material. The inventory is
the harness `promptCacheKey` and the `leakCache` here; adding a cache means adding it to this list
and to `harness/src/access/index.ts`.

**No unfiltered search (task 5.4).** `test/access-audit.test.ts` reads every package's and app's
source and fails when: the `chunks` table is named outside the schema, `internal.ts` and the
`chunks` / `retrieval` repositories; `retrieval.ts` gains a read of `chunks` (the count is pinned)
or has one whose statement lacks the scope; anything but `retrieval.ts` calls `.material(`; a file
off the allowlist implements `RetrievalIndex`; or harness code outside `access/scopedRetrieval.ts`
searches or probes the index (`.leakCheck(` only in `guardrails/lockedLeak.ts`).

## Documents (task 8.2)

A document's `status` (`uploading` -> `processing` -> `ready` / `failed`) is a studio display
field, never a retrieval gate: chunks are searchable as soon as they are written.
`documents.get(scope, id)` and `documents.listForTeacher(scope, { moduleId? })` (newest first, at
most `DOCUMENT_LIST_MAX`) read the scope's rows only. `documents.updateStatus(scope, id, status,
failureReason?)` is one scoped UPDATE that also requires an allowed previous state (`processing`
from uploading / processing / failed, `ready` from processing, `failed` from uploading /
processing; `uploading` only through create and replace), so a stale worker can't mark a replaced
document ready; anything else is `not_found`. `failed` needs a fixed code (`[a-z][a-z0-9_]*`, at
most 64 characters, never raw error text; a CHECK keeps it null otherwise). It does not bump the
material revision.

`documents.delete(scope, id)` and `documents.startReplace(scope, id, { storageKey })` lock the
scope's row `FOR UPDATE` (a concurrent `chunks.insertMany` then waits and finds nothing), delete
its chunks, then delete the row (or point it at the new key, reset it to `uploading` and clear the
failure), and bump the material revision, all in one transaction: the next search and leakCheck
miss the old material at once. They return the old storage key for the caller to delete the file.
Another teacher's or a missing document is `not_found` and nothing is written.

## Outline (task 8.3)

`courses.get(scope)` is the scope's first course (by order) or null. `courses.ensureDefault(scope)`
inserts the teacher's course ("My course") when there is none and, when the teacher has no module
at all, one "Module 1" in it, in one transaction under a per-teacher transaction lock, so it is
idempotent under concurrency; a scope id that is not a user is `not_found`.

`outline.getOutline(scope)` reads the first course's modules, their topics and each topic's
source links (`chunkId`, `sourceTitle`, `locator`; never chunk text), every statement with the
scope's `teacher_id`. `outline.replaceOutline(scope, { modules })` rewrites the named modules in one
transaction. Lock order is the scope's courses, then the named modules, then their topics (each by
id), so two edits can't deadlock. Any named module that is not the scope's is `not_found`, and
modules of two courses are `invalid`. A listed topic id must be a topic of one of the named modules
(else `not_found`). A topic without an id is created. A topic of a named module that is not listed
is deleted (merge), unless it has `evidence_events`: then the edit is `invalid`, because student
data is never deleted by an outline edit. Links are inserted by `insertTopicLinks` (`chunks.ts`,
the only file besides retrieval.ts that may name `chunks`): one `INSERT … SELECT` joining each
link to the teacher's own chunk and topic, so an unknown or another teacher's chunk id writes
fewer rows and the edit is `invalid`. The course's `outline_version` goes up by 1 and one
`outline.edit` audit row (before/after `{ outlineVersion, moduleCount, topicCount }`, counts only)
commits with it. Any failure writes nothing. Modules are renamed and reordered only: merging or
splitting modules would move documents and chunks, which is out of scope.

`chunks.listForModule(scope, moduleId)` returns the scope's chunks of `ready` documents in one
module (`id`, `text`, `locator`, `sourceTitle`), ordered by document then chunk, for the outline
drafter. Another teacher's or a missing module is `[]`. More than `MODULE_CHUNKS_MAX` is `invalid`,
never a cut list.

## Ask the teacher (task 5.10)

**`insertTeacherNote(tx, teacherId, input, method)`** (`chunks.ts`, the only file allowed to name
`chunks`) is the one transaction that turns a teacher's answer or correction into a teacher note:
a `documents` row (`kind 'teacher_note'`, `status 'ready'`, no storage key, source title from
`@edmate/harness`'s `teacherNoteSource`) via `INSERT … SELECT FROM modules WHERE id = $m AND
teacher_id = $t` (another teacher's module or a missing one is `not_found`), its one chunk (text
from `teacherNoteText`, locator the answer's UTC date), one `teacher_eval_cases` row and a
material-revision bump. `question` / `answer` are validated by `teacherNoteParts` (the same helper
the harness's memory `CorrectionStore` double uses, so the two formats can't drift): empty after
trimming or over `TEACHER_NOTE_PART_MAX` is `invalid`, before any SQL. `chunks.addTeacherNote(scope,
input)` wraps it in its own transaction; `correctionStoreFor(repos, scope)` (`ports.ts`) is the
bound `CorrectionStore` adapter — a payload `teacherId` other than the bound one is `scope`, before
any write. Phase C's `teacherQuestions.answer` calls `insertTeacherNote` directly (not the port),
so the note, the question's status and the student delivery commit together.

`teacher_eval_cases` (7.3 converts rows into eval suite cases) and `notifications` (Phase C) are
additive tables from migration 0018; `teacher_questions.group_id` (unused since 0001) is backfilled
to each row's own id so every question starts as its own group once Phase C's grouping lands.

**`teacherEvalCases.listForTeacher(scope)`** (task 7.4, `teacher-eval-cases.ts`, read-only) returns
the scope's own `teacher_eval_cases` rows (`id, moduleId, question, answer, origin`; no teacher or
chunk id), ordered `created_at, id`, for the quality gate's per-agent accuracy cases. More than
`TEACHER_EVAL_CASES_MAX` (10 000) rows is `invalid`, never a truncated list: a cut suite would let
a publish pass on cases it never ran.

**Grouping (Phase C, § Ask the teacher 2, Q1).** `teacherQuestions.open` lexically groups a new
question with that teacher's and that agent's own other **open** questions, inside its own
transaction: `question-similarity.ts`'s `questionSimilarity` (Jaccard over `retrieval.ts`'s
`queryTerms`, ≥ 0.5 and ≥ 2 shared terms) and `bestGroup` (best score, ties to the oldest candidate,
then the lowest id) over at most `GROUPING_CANDIDATE_MAX` of that teacher+agent's newest open
questions. `group_id` becomes the chosen match's group (or its own id when none matches), and
`similar_ids` becomes the caller's ids plus the group's other members (at most `SIMILAR_IDS_MAX`).
This is never a real similarity search (`teacherQuestionStoreFor.findSimilar` stays `[]`, see
`ports.ts`) and never crosses a teacher or an agent. The agent row lock moved from `key share` to
`no key update`, so two concurrent opens for one agent serialise through this grouping read instead
of racing it. `teacherQuestions.listGroupsForTeacher(scope, { limit })` groups the teacher's own
open questions the same way, in memory, over at most `GROUPING_SCAN_MAX` rows (biggest group first,
then oldest, at most `GROUPS_MAX_LIMIT` groups of at most `GROUP_QUESTIONS_MAX` questions); it never
selects `student_id`.

**`teacherQuestions.answer(scope, { questionId, moduleId, answer, noteQuestion? })`** answers the
scope's own open question and every open question sharing its group, in one transaction, in this
lock order (task 5.10b, review follow-up): an unlocked peek at the target row for its `agentId`
and `groupId` (both immutable once `open` writes them, so reading them before any lock is safe);
the agent row `FOR NO KEY UPDATE` (the same lock, same mode, `open` takes — a question opened for
this agent mid-answer can't land after the group below is read); then every currently-open member
of the group, locked in **one statement, ascending by id** (`WHERE id = ANY(ids) ORDER BY id FOR
UPDATE`) — two concurrent answers into the same group always acquire that same row set low-to-high,
so one holds the whole set while the other blocks on the lowest id, instead of each holding one row
the other wants (the prior per-row lock order could 40P01-deadlock). Another teacher's, a missing,
an already-answered or a dismissed question is `not_found`, checked against this fresh read, not
the first peek. Calls `insertTeacherNote` once, so the note, the members' status and the student
delivery commit together; the thread message and `teacher_questions.answer` both store the same
`answer.trim()` (whatever `insertTeacherNote` accepted, since it validates through the same
`teacherNoteParts` helper); sets every member `status 'answered'` with `answer` and `answered_at`;
then, for each **distinct student** among the members (the earliest, then lowest-id member stands
for them), writes one `teacher` message into that student's open session with this teacher and
agent (`insertSelect`, `order by created_at desc, id desc limit 1` in case more than one is somehow
open at once — the statement would otherwise try to insert one row's id twice and fail its primary
key) and one `notifications` row (`onConflictDoNothing`, so a retry is harmless). Returns counts
only (`answered`, `students`, `threadMessages`, `noteChunkId`, `evalCaseId`) — no student id ever
leaves.

**Index (task 5.10b).** `teacher_questions_teacher_id_agent_id_status_created_at_idx` (migration
0025, additive) covers `open`'s grouping read, which filters on exactly
`(teacher_id, agent_id, status = 'open')` and orders by `created_at` (fix round:
`listGroupsForTeacher`'s scan filters only `(teacher_id, status)`, with no `agent_id` predicate, so
it can't use this index's `agent_id`/`created_at` prefix and ties with or loses to the existing
`teacher_questions_teacher_id_status_idx` instead — this index only serves `open`). The 5.10 review
also asked for a unique partial index on open sessions per `(teacher, student, agent)`; that was
**not**
added — `sessions.create` (`sessions.ts`) opens a new session on every call with no check for an
existing open one for the same triple, and `apps/web/src/turn/routes.ts`'s `startSession` calls it
unconditionally, so two open sessions for one triple already happen today (this is exactly why
`teacherQuestions.answer`'s message insert already picks `order by … limit 1` instead of assuming
one row). Adding the unique index first needs that caller to check for an existing open session
(or `sessions.create` itself to do an insert-or-return-existing, as `teacherQuestions.open` does),
which is outside `packages/db`'s and this task's bounds (`apps/web` is out of bounds for this
builder). Left for a follow-up task.

**Follow-up, closed (task 5.10d).** `sessions.create` now reuses an existing open session for the
same `(teacher_id, student_id, agent_id)` triple instead of inserting a second one — one
transaction, `ON CONFLICT (teacher_id, student_id, agent_id) WHERE ended_at IS NULL DO NOTHING`
then a same-transaction read on a lost race, same shape as `teacherQuestions.open`'s
insert-or-return-existing. The unique partial index
(`sessions_open_teacher_student_agent_key`, migration 0028) is schema-only
(`src/schema/learning.ts`) and built by the post-migrate step with `CREATE UNIQUE INDEX
CONCURRENTLY`, same as this table's other two indexes — not a plain migration, because `sessions`
is big and high-write. The migration itself ends (never deletes) any pre-existing duplicate open
sessions first, keeping the newest (most likely to hold live `help_state`) so the index build
never sees a duplicate.

`retentionRepo`'s three cutoff-scan indexes (`chunks_transcript_created_at_idx`,
`sessions_created_at_idx`, `turn_traces_created_at_idx`; migration 0032, task 13.4a, 13.4 review
deferral) are schema-only the same way, built by the post-migrate step with `CREATE INDEX
CONCURRENTLY` instead of the migration file: `chunks`, `sessions` and `turn_traces` are all big,
high-write tables.

**`teacherQuestions.dismiss(scope, questionId)`** (task 8.9) closes the scope's own open question
alone: a single scoped UPDATE (`status 'open' -> 'dismissed'`, `answer`/`answered_at` left null),
never the group or the other members — unlike `answer`, dismissing one wording never silently
closes a differently-worded sibling that might still deserve an answer. Another teacher's, a
missing, or an already-answered/dismissed question is `not_found` and nothing is written.

**`notifications`** (`notifications.ts`) is the student's own read of a teacher's answer: in-app
only (email and push wait, decision B-25). `listForStudent(scope, { unreadOnly, limit })` joins to
the scope's own `teacher_questions` row (another scope's notification can't be read through a
borrowed id), newest first. `markRead(scope, id)` is a scoped UPDATE; another student's or a
missing id is `not_found`.

**`db:questions` (Phase D).** The teacher's own command-line view onto the two reads/writes above,
after `pnpm --filter @edmate/db build`: `pnpm --filter @edmate/db db:questions -- list --teacher
<id>` prints each open group (id, count, oldest) and its member questions (id, text); `pnpm
--filter @edmate/db db:questions -- answer --teacher <id> --question <id> --module <id>
--answer-file <path> [--note-question <text>]` reads the answer from a file (never the shell's
argv or history) and calls `teacherQuestions.answer`, printing counts only (never a student id).
A bad usage or a missing `--answer-file` never opens the database; a `RepositoryError('not_found',
...)` (another teacher's or an already-answered question, a missing module) prints a fixed
message; any other failure is `redact()`ed before it reaches the terminal. See
`runTeacherQuestionsCli` (`src/cli.ts`) and `src/bin/teacher-questions.ts`.

## Test chat and corrections (task 8.5)

The teacher's test chat previews one of the teacher's own packages as a student would see it,
before or after publishing. Teacher-scoped only; no student scope reaches any of these.

**`corrections.record(scope, { moduleId, question, badAnswer, correctedAnswer })`**
(`corrections.ts`) records a teacher marking an agent answer wrong, in one transaction:
`insertTeacherNote` (above) with `origin 'correction'` and the corrected answer — so the note
chunk, its `teacher_eval_cases` row and the material-revision bump are the same as for a teacher
answer — then one `corrections` row (`teacher_id` = the scope's, and the bad answer kept for the
record). The module ownership check is `insertTeacherNote`'s `INSERT … SELECT FROM modules WHERE id
= $m AND teacher_id = $t`, run first, so a missing or another teacher's module is `not_found` and
nothing is written. All three texts go through `teacherNoteParts` before any SQL (empty after
trimming or over `TEACHER_NOTE_PART_MAX` = `LIMITS.turnTextMaxLength` is `invalid`); the stored
texts are trimmed. Returns `{ correctionId, chunkId, evalCaseId }`. This file names no chunks
table; it only calls `insertTeacherNote`.

**`agentVersions.latest(scope, agentId)`** returns `{ version, config }` for the newest
`agent_versions` row of the scope's own agent, whatever the agent's status (a draft is what the
test chat previews); `null` for no version, a missing or another teacher's agent. Mirrors
`packageVersions.latest`.

**`packageVersions.listForAgent(scope, agentId)`** returns `{ packageId, name }[]`: the scope's own
packages for that agent that have at least one `package_versions` row (an `EXISTS` filtered by the
same teacher), any status, newest created first then id, at most `AGENT_PACKAGES_MAX` (100).
Another teacher's or a missing agent is `[]`. `liveForAgent` stays the public, live-only read.

## Memory reset and export (task 6.5)

`learnerProfiles.reset(scope)` is the student's own "reset what my tutor remembers". One
transaction, lock order sessions-then-profile (matches `sessions.end`, so the two can never
deadlock, 40P01): ends every one of the pair's still-open sessions (no summary, so a later
`sessions.end` / `endOnPackageChange` on one is a no-op); locks the profile row (no row is `{
reset: false }`, nothing else written); deletes the pair's `evidence_events` (keeping them would
let `rebuildMastery` bring the mastery back); clears `mastery` to `{}`, `mistakes` to `[]` and
`last_summary` to null (`lang` is kept — a setting, not memory); writes one `profile.reset` audit
row (actor the scope's own student) with before/after **counts and booleans only**, never the
summary text or tag names. Deleting the row itself (instead of clearing it in place) is unsafe:
every other writer here inserts a default row, locks it, and throws `scope` if it has vanished
underneath it.

`evidenceEvents.list(scope, { limit })` is the export read: the scope's own events, ordered `ts
ASC, id ASC`, `limit` capped at `EVIDENCE_LIST_MAX` (10 000). It fetches `limit + 1` rows to set
`truncated`, so a cut export always says so instead of silently looking complete.

## Agent bootstrap and packages (task 8.6b)

`agents.ensureDraft(scope, { courseId, styleCardId, promptPackVersion, modelPolicy })` returns
`{ agentId, version }`: the scope's teacher's agent (MVP: one per teacher). Under a per-teacher
transaction lock it first key-share-locks the course and style card by id **and** `teacher_id`
(either missing or another teacher's is `not_found`, on every call); then it returns the teacher's
oldest agent with its newest version number, or inserts a `draft` agent and its version 1. The
config is built from the scope (`teacherId`), the input and `languages: ['en']` and parsed by
`AgentConfigSchema` before any SQL (`invalid`); the input is strict, so a client-set `teacherId`
is `invalid`. An existing agent is never re-versioned here (publishing is 8.7).

`packages.create(scope, { agentId, draft })` → `{ packageId, version: 1 }`,
`packages.saveVersion(scope, { packageId, agentId, draft })` → `{ packageId, version }` and
`packages.listForTeacher(scope)` → `TeacherPackageRow[]`. A `PackageDraft` is a `PackageConfig`
without `id`, `version`, `teacherId` and `agentId` (strict: any of them is `invalid`); the
repository fills them from the scope and the rows and parses the full config. `create` locks the
teacher (advisory), checks the agent row by id and `teacher_id` (`not_found`), every module by id
and `teacher_id` (`scope`), and the `PACKAGES_MAX` (20) cap (`invalid`), then inserts the package
and its version 1 in one transaction. `saveVersion` locks the package row `FOR UPDATE` by id,
`teacher_id` and `agent_id` (`not_found`), checks the modules, writes version max + 1 (the unique
`(package_id, version)` index is the backstop) and updates `packages.name`, the only column it ever
changes; ownership columns (`teacher_id`, `agent_id`) and `live_version` are never updated. Each
write adds one `package.save` audit row: `target` `package:<id>`, `after` `{ version }` only (no
price, no names). `listForTeacher` reads the scope's packages oldest first (at most
`PACKAGES_MAX`) and each one's newest version, both filtered by `teacher_id`.

## Publish gate runs (task 8.7a)

`publish` stores the publish gate's runs in `eval_runs` (suite `gate`, migration 0021 adds
`agent_id`, `status`, `changes`, `basis`, `summary`, `scorecard`, `published_at`; a partial unique
index allows one open run per agent). Every method takes the teacher id from the scope only, and
every run is selected by id AND `teacher_id`.

- `startRun(scope, pins)` takes a per-teacher advisory lock, checks the teacher is verified
  (`FOR SHARE`, else `scope`), locks the agent `FOR UPDATE`, refuses a suspended agent, an open run
  (unless stale: not marked running again for its deadline plus 15 minutes, then it is closed as
  `error` — only `startRun`/`markRunning` ever update the run's `updated_at` while it is open, so
  "stale" is since markRunning, not since the last `recordResults`), no packages, or nothing
  changed since the last published run. It cuts agent version N+1 and inserts a `queued` run whose
  `basis` snapshots the pins, material revision and each package's newest version. Refusals are
  `PublishRefusedError` with a `reason`.
- `markRunning`, `recordResults` (idempotent per case, at most `GATE_RESULTS_MAX`), `finishRun`
  (`failed` or `error`) move a run along.
- `goLive(scope, input)` runs in one transaction: verified check `FOR SHARE`, run `FOR UPDATE`
  (must be `running`), agent `FOR UPDATE` (not suspended), then sets the agent live at the run's
  version, each basis package's `live_version`, one `agent.publish` and one `package.publish`
  audit row each, and marks the run `passed` with `published_at`.
- `latestRun`, `getRun`, `failedCases` (at most `FAILED_CASES_MAX`) are teacher-scoped reads.
- `publicScorecard({ agentId })` is public: it returns null unless the agent is live and its
  teacher verified, and carries each category forward from the newest passed run that measured it.

Migration 0021 added `eval_runs`' FK and partial index as plain (non-`NOT VALID`/`CONCURRENTLY`)
steps, which was fine on an empty column at the time; any later migration against a populated
`eval_runs` (e.g. a `(teacher_id, created_at)` index, if runs ever grow past pilot scale) must add
its constraint `NOT VALID` and its index `CONCURRENTLY`, same as the other tables' rule above.

## Live classes (task 11.1a, edit/cancel 11.1d)

In-app, pull-based only (decision B-45, 22 Oct 2026): no email/SMS, no background job
(`packages/queue/**` and `apps/worker/**` are untouched). `liveClasses.create(scope, { title,
link, startsAt, packageIds })` schedules one of the scope's teacher's classes, attached to 1..20 of
that teacher's own packages: `link` must be an **https** URL (no plain `http`), at most
`LIVE_CLASS_LINK_MAX_LENGTH` (2048) characters, and `startsAt` a future timestamp (`invalid`); any
package id that is not the scope's own is `not_found`, key-share locked in the same transaction as
the insert (same shape as `packages.ts`'s `checkModules`). Writes one `live_class.schedule` audit
row (`after`: title, startsAt, packageIds). `title`/`link`/`startsAt` share one set of field
schemas with `update` so the https-and-length check lives in one place.

`listForTeacher(scope)` returns the scope's own classes, soonest first, at most
`LIVE_CLASS_LIST_MAX` (500), each with `status` (`'scheduled'` | `'cancelled'`).
`listUpcomingForStudent(scope, { now? })` returns the scope's own teacher's classes that have not
started, attached to the base package of the scope's own live (`trial` / `active`) subscription
only (`paused` / `past_due` / `ended` see nothing), each with a window label (`reminder_24h` /
`reminder_1h` / `starting_soon` / `later`) computed here, from `startsAt` vs `now`, inside
`live-classes.ts` (the one place this label is computed; `options.now` only overrides the clock for
deterministic tests), at most `LIVE_CLASS_LIST_MAX`, `.selectDistinct`-ed as defence in depth (the
`subscriptions_one_live_per_pair_key` constraint already stops a student holding two live
subscriptions to one teacher, so the join can't duplicate a class today; `DISTINCT` keeps that
true if the join or constraint changes). A cancelled class with a future `startsAt` still appears here (status shown, not
filtered out — see the task's own "cancelled class is marked, not dropped" decision); it drops off
on its own, like any class, once `startsAt` passes.

`update(scope, id, { title, link, startsAt })` and `cancel(scope, id)` (task 11.1d) both lock the
row `FOR UPDATE` by id **and** teacherId first: another teacher's id or a missing one is
`not_found`, before any other check. `update` on an already-cancelled class, or one whose own
(current, not the caller's) `startsAt` has passed, is `invalid`; otherwise it writes the new
title/link/startsAt and one `live_class.update` audit row (`link` left out of the payload, matching
`create`). `cancel` on an already-cancelled class is an idempotent no-op — `{ cancelled: false }`,
nothing written, no audit row, so a double-click or a retried request never errors; on a
`'scheduled'` class whose `startsAt` has already passed it is `invalid` (the class already
happened, this is not the no-op case); otherwise it sets `status = 'cancelled'` and writes one
`live_class.cancel` audit row.

## Live-class recordings (task 11.4)

A class's recording, transcript or captions is an ordinary document with `documents.live_class_id`
set (migration 0024: nullable, FK `ON DELETE SET NULL`, validated after migrate; partial index).
`documents.create(scope, { …, liveClassId })` links it only to one of the scope's own classes that
has already started (`starts_at <= now()`), checked in the same `INSERT … SELECT` as the module:
another teacher's class, a future one and a missing one are all `not_found` and nothing is written,
so class ids can't be probed. `startReplace` keeps the link; `get`, `listForTeacher` and
`DocumentRow` don't show it. `liveClasses.listRecordingsForTeacher(scope)` is one query (the
scope's documents joined to the scope's own classes): `{ liveClassId, documentId, sourceTitle,
status, failureReason? }`, newest first, at most `RECORDING_LIST_MAX` (500). Scope is validated
before any SQL; the isolation grid has its `CASES` entry and `scope.test.ts` sweeps it. Chunks are
searchable once written, like any document; status is display only.

## Pre-class question queue (task 11.2a)

"Topic" is the existing lexical cluster (5.10/8.9's own convention), not the curriculum `topics`
table: neither `class_questions` nor `teacher_questions` carries a `topic_id` (lead answer Q1, 22
Oct 2026). `classQuestions.submit(scope, { liveClassId, text })` validates `text` (non-empty, ≤
`LIMITS.turnTextMaxLength`), and checks, in one statement, that the class belongs to the scope's
own teacher, the scope's student holds a live (`trial`/`active`) subscription to one of the
class's packages, and the class has not started yet (`startsAt > now`) — the same
entitlement/window `liveClasses.listUpcomingForStudent` already checks (lead answer Q4); anything
else is `not_found`, nothing written. Writes one `class_questions` row. `listQueueForTeacher(scope,
{ limit? })` reads the teacher's own classes' pending `class_questions`, clusters them with
`clusterQuestions` (a pure, sibling clusterer of 5.10's `bestGroup` in `question-similarity.ts`,
over a flat list rather than one-at-a-time against caller-filtered candidates), and returns
`TopicQuestionGroup[]`, biggest group first then oldest. A cluster may span more than one of the
teacher's classes (lead answer Q3, `liveClassIds: string[]`); the table has no student id, so the
result never carries one.

## Reports (12.2)

No migration: the `reports` table is from 0001. `reports.file(scope, { sessionId, messageId,
category })` files the scope's student's report on an agent or teacher reply in their own session,
in one INSERT…SELECT scoped through the session (a student message, another scope's message or a
missing one is `not_found`, nothing written). `category` is one of `REPORT_CATEGORIES`; students
send no free text. The row id is `reportRowId(student, message)`, so a second report on the same
message is `{ created: false }` (first category wins). `target` is `message:<id>`; `reporter_id`
never leaves the repository.

`reports.listOpenForStaff(by)` and `reports.review(by, reportId, { decision, note? })` take a bare
staff id first (malformed `invalid`, not staff right now `scope`, checked with `lockRole` so no
repository source names the users table). The queue is open reports oldest first by
`(created_at, id)`, at most `REPORTS_QUEUE_MAX_LIMIT` (50), each with the reported reply (null if
gone), the session's teacher and agent ids, the teacher's slug and up to 10 of the teacher's
documents a cited source title names (`takenDown` when an active `document:<id>` takedown exists).
Never the reporter's id, name, email or phone, and never the session id. `review` sets `dismissed`
or `actioned` once (a closed or concurrently closed report is `not_found`), appends `{ actor,
action, note, ts }` to `staff_actions` and writes a `report.review` audit row (target
`report:<id>`, the reply's teacher, note as reason). Lock order: role (`FOR SHARE`), then the
report (`FOR UPDATE`); 12.2b's takedowns keep role first and report last.

## Safety alerts (task 12.5a)

The staff alert inbox (`safety_alerts`, migration 0022). The alert worker writes; only staff
read. `record(alert)` and `markEscalated(alert, round)` take the contracts `SafetyAlert` (no
separate scope: its student, teacher and session ids are the scope) and insert through the
alert's own session, so another pair's session is `not_found` and nothing is written. `record` is
idempotent (`written: false` on a replay). `markEscalated` upserts (it works without `record`):
`escalation_round` becomes at least `round + 1`, `escalated_at` keeps its first value,
`last_paged_at` is now, and the ack fields are never touched. `isAcknowledged(alertId)` is the
worker's ack read (a missing row is `false`). `listForStaff(by, { status, limit })` and
`acknowledge(by, { alertId, note? })` need `by` to be staff right now (role-lock.ts), else
`scope`. The list holds ids, level, kind, the scrubbed excerpt, timestamps, the round, the ack
fields and the teacher's public slug, never a name, email or phone; open alerts first, escalated
first, oldest first, capped at `SAFETY_ALERT_LIST_MAX_LIMIT` (50). `acknowledge` runs in one
transaction with the lock order in the file header (the acting user's role FOR SHARE, then the
alert row FOR UPDATE): an alert already acknowledged returns `acknowledged: false` and writes
nothing; otherwise the ack fields and one `safety_alert.ack` audit row (the note as its reason,
at most 500 characters, never the excerpt) commit together.

## Takedowns (task 12.2b)

Staff take down one teacher document (`document:<id>`) or a whole agent (`agent:<id>`) and lift
it again (`takedowns.ts`; the `takedowns` table is from 0001, no migration).

- `create(by, { kind, targetId, category, reportId?, note? })`, `lift(by, takedownId, { note? })`
  and `listActiveForStaff(by)` are staff-only (`lockRole`; anyone else is `scope`). Create and
  lift are audited (`takedown.create`, `takedown.lift`) and append to `staff_actions`.
- One active takedown per target (a second is `invalid`), serialised by the target row's lock.
  A linked `reportId` must be an open report about the same teacher; it is set `actioned` with a
  `report.review` audit row.
- A document takedown is a filter, not a delete: `notTakenDown(column)` is the only place the
  predicate is written. It is in `retrieval.ts`'s one scope fragment (full text, vector and term
  stats, so `search` and `probe`), in `retrieval.material` (leakCheck's locked index) and in
  `chunks.listForModule` (the outline drafter). Create and lift bump the material revision, so
  leakCheck rebuilds. The predicate probes `takedowns_target_idx`.
- An agent takedown sets the agent `suspended` (every student-facing read requires `live`;
  publish refuses it). A lift sets `live` when it has a live version, else `draft`.
- Lock order: staff role row (`FOR SHARE`), the target row (`FOR UPDATE`), the takedown row,
  then the report. publish takes advisory, profile, agent, run; the agent is the only shared
  row, so there is no cycle (two-connection test against `publish.goLive`).
- `countUpheld(scope)` (task 12.3b) counts the teacher's active `copyright` takedowns on their
  own documents and agents; a lifted one does not count. The owner is the target's teacher now
  or the teacher on the takedown's `takedown.create` audit row, so deleting a taken-down
  document does not clear it. A read only: no lock, no caller, no threshold yet (12.3d).

## Regulated subjects (12.4)

Staff flag an agent as covering a regulated subject and approve it (columns on `agents`,
migration 0023; 12.4b makes publish refuse a flagged, unapproved agent). Every method takes the
acting user id `by` first, which must be staff right now (role-lock.ts), else `scope` and nothing
is written. `listForStaff(by)` returns every agent newest first, capped at `REGULATED_LIST_MAX`
(200): agent id, the teacher's public slug, status, `liveVersion`, `regulatedSubject`,
`approvedAt` and `approvedBy` (an id); never a name, email or phone.
`setSubject(by, { agentId, subject, note? })` sets one of `REGULATED_SUBJECTS` (`investing`,
`health`, `law`, equal to the contracts enum) or `null`; `setApproval(by, { agentId, approved,
note? })` approves or revokes. Both run in one transaction in the file header's lock order (the
acting user's role FOR SHARE, then the agent FOR UPDATE; an unknown agent is `not_found`). The
same state is a no-op (`changed: false`, no audit row); a subject change clears the approval;
approving an unflagged agent is `invalid`. Each change writes one `agent.regulated_flag` or
`agent.regulated_approval` audit row (actorRole `staff`, before and after, the note as its reason,
at most 500 characters). The migration backfilled each agent's subject from its newest version's
config, unapproved.

## Package surface

`@edmate/db` exports `openDatabase`, the repositories, scope parsers and `RepositoryError`, and
the migrator. The raw Drizzle handle and the schema are only in `@edmate/db/internal`, for
migrations, the seed and tests.

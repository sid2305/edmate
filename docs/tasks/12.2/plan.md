# Task 12.2: Report button, review queue and takedown of material or agents

## Acceptance (verbatim)
> a report reaches staff < 5 minutes; a takedown removes material from retrieval at once.

## How it will be shown
- **Report reaches staff < 5 minutes.** A student's report is one synchronous INSERT; the staff
  queue reads the table directly, so the report is listed on the very next staff read. The staff
  reports page re-reads the queue every 60 s (`REPORTS_POLL_MS = 60_000`) and announces the new
  count in an `aria-live` region, so an open console shows a new report within 60 s, well under 5
  minutes. Proof: a `packages/db` int test (file, then `listOpenForStaff` returns it); a real-Postgres
  route int test in apps/web (the student route files a report, the staff GET lists it in the same
  test); a fake-timer view test (a report that appears on the server shows within one 60 s poll).
- **A takedown removes material from retrieval at once.** The retrieval SQL itself excludes any
  chunk whose document has an active takedown, in the same statement as the teacher and module
  filter, so the first search after the takedown commits no longer returns it (no cache, no job).
  Proof: a `packages/db` int test over `retrievalIndexFor(repos)`: search returns document A's
  chunk; staff take A down; the very next `search` and `probe` on the same index instance return
  nothing from A; `leakCheck`'s cache is rebuilt (the takedown bumps the material revision); after
  `lift`, A's chunk is back.
- Agent takedown is shown by the same int suite: after it, `agents.owner` is null,
  `entitlementStoreFor(...).resolve` (subscription) is null, the teacher drops out of
  `discovery.search` (if it was their only live agent), `subscriptions.start` is `not_found` and
  `publish.startRun` is refused `suspended`; after `lift` the agent is `live` again.
- Manual check in the last handoff: grant staff locally (`db:grant-role`), file a report from the
  chat, open `/staff/reports`, take down the cited document, confirm a chat question on it now gets
  the "not covered" path.

## Context already in place (read, not rebuilt)
- Tables `reports`, `takedowns`, `safety_events` exist since migration 0001
  (`packages/db/src/schema/operations.ts`, `trustColumns`: `target` `<kind>:<id>`, `reason`,
  `status` free text default `open`, `staff_actions` jsonb `[]`; `reports.reporter_id` → users;
  indexes on target and status). **No migration and no schema change.**
- `agent_status` already has `suspended`, and every student-facing read already requires `live`:
  `agents.owner` (so `entitlementStoreFor` and `apps/web/src/turn/scope.ts` refuse it per turn),
  `discovery`, `packageVersions.liveForAgent`, `subscriptions.start`/`changePackage`;
  `publish.startRun`/`goLive` refuse a suspended agent. Agent takedown = set `suspended`.
- Retrieval (`packages/db/src/repositories/retrieval.ts`): `rank()` builds one `scope` SQL fragment
  used by the text, vector and term-stats queries; `material()` feeds leakCheck's locked index,
  whose cache key is the teacher's material revision (`bumpRevision` in `chunks.ts`).
  `chunks.listForModule` (outline drafter) reads chunks too.
- Staff pattern from 12.1: reads check `users.role = 'staff'` with a plain select
  (`teacherProfiles.listPendingForStaff`); writes use `lockRole` (`packages/db/src/role-lock.ts`,
  `FOR SHARE`) in the same transaction, then an `audit_log` row with `actorRole: 'staff'`.
  apps/web: `withRole(['staff'])`, handlers in a `handlers.ts` next to `route.ts`, fixed error
  codes, `cache-control: no-store`, `describeError` logging, client views that safeParse.
- Route policy (`apps/web/src/auth/policy.ts`) already covers every route here:
  `/api/sessions/**` POST (student, clearance `agent`) and `/api/staff/**` GET/POST (staff).
  **No policy change.**
- Chat: message ids reach the client (`loadChat` history ids; a finished turn's `messageId`);
  `studentTurnScope` (apps/web/src/turn/scope.ts) builds the StudentScope from the agent id.

## Design (decided here; open questions below may change it)
- Report target: an agent or teacher message in the student's own session, `message:<id>`.
  `reason` = one category from a closed set
  `REPORT_CATEGORIES = ['harmful', 'inappropriate', 'wrong_information', 'copyright', 'other']`.
  No free text from students (Q2). Row id = `rp_` + sha256(reporter, target) (the
  `safetyEventRowId` pattern), `on conflict do nothing`: one report per student per message.
- Takedown targets: `document:<id>` or `agent:<id>`. `reason` = a category from the same set.
  `status`: `active` | `lifted`. One active takedown per target, serialised by locking the target
  row `FOR UPDATE` (no unique index, so no migration).
- Material takedown is a **filter, not a delete** (Q4): chunks stay, every retrieval read adds
  `not exists (active takedown on 'document:' || chunks.document_id)`. One exported SQL helper is
  the only place that writes this predicate. It survives `documents.startReplace` (same id).
- Lock order for every takedown write: staff `lockRole` (`FOR SHARE`), then the target row
  `FOR UPDATE` (the document, or the agent), then the takedown row. No run or profile lock, so it
  can't form a cycle with publish's order (advisory, profile, agent, run); state this in the file
  header, per the 8.7a lesson.
- Staff never see the reporter's id, name or email; they see the reported message text, its cited
  sources mapped to the teacher's document ids, the teacher slug and the agent id.

## Phases
Five phases, one package each, about 70 tool calls each. Order: A, then B and C in parallel
(different packages), then D (needs B and C), then E (needs D). Board ids 12.2a to 12.2e.

### Phase A: packages/db, reports repository (12.2a)
Files:
- `packages/db/src/repositories/reports.ts` (new):
  - `REPORT_CATEGORIES`, `REPORTS_QUEUE_MAX_LIMIT = 50`, `REPORT_NOTE_MAX = 500`.
  - `file(scope: StudentScope, { sessionId, messageId, category }) → { id, created }`: one
    INSERT…SELECT from `messages` joined to `sessions` with `ownSession(sessionId, scope)`,
    `messages.role in ('agent','teacher')`; nothing written (not own, missing, student role) is
    `not_found`; a duplicate is `{ created: false }` (checked in scope, like `safetyEvents.record`).
  - `listOpenForStaff(by) → StaffReportRow[]`: plain staff role check (`invalid` malformed, `scope`
    non-staff), open reports oldest first by `(created_at, id)`, capped; joined to the message
    (text, sources, role, createdAt; a missing message gives `message: null`), its session
    (teacherId, agentId) and `teacher_profiles.slug`; `citedDocuments`: that teacher's documents
    whose `source_title` matches a cited source title (id, title, kind, `takenDown`), at most 10.
    Never `reporter_id`, never `users` personal columns.
  - `review(by, reportId, { decision: 'dismissed' | 'actioned', note? })`: `lockRole` staff, then
    the report `FOR UPDATE` where `status = 'open'` (else `not_found`), set status, append
    `{ actor, action, note, ts }` to `staff_actions`, audit row `report.review`
    (target `report:<id>`, teacherId from the session, before/after status, note as reason).
- `packages/db/src/repositories/map.ts`: `StaffReportRowSchema` and type (append).
- `packages/db/src/repositories/index.ts` (**shared**): append `reports: guardAll(...)` as the last
  entry of `createRepositories` and one export line at the end. Nothing else edited.
- `packages/db/src/repositories/README.md`: a "Reports (12.2)" section.
- Tests first: `packages/db/test/reports.test.ts` (bad scope/input before SQL),
  `packages/db/test/reports.int.test.ts` (own message files once, second time `created: false`,
  another student's or a student-role message `not_found`, staff list shape and order and cap,
  no reporter id in the payload, review audited, non-staff `scope`, reviewing twice `not_found`).
- **Shared, append-only:** `packages/db/test/repositories.int.test.ts` (one `CASES` entry per new
  method, required by the `RepositoryMethod` type), `packages/db/test/scope.test.ts` (grid
  exclusions for `by`-first methods and the users-read exception, as 12.1a did).

State after A: reports can be filed and reviewed in the database; no UI.

### Phase B: packages/db, takedowns and the retrieval filter (12.2b)
Files:
- `packages/db/src/repositories/takedowns.ts` (new):
  - `notTakenDown(documentIdColumn): SQL`, the one predicate (exported for retrieval and chunks).
  - `create(by, { kind: 'document' | 'agent', targetId, category, reportId?, note? }) → { id }`:
    lock order above; missing target `not_found`; an active takedown already on the target is
    `invalid`; inserts the row (`active`, first `staff_actions` entry); agent → `status
    'suspended'`; document → `bumpRevision`; `reportId` → that report set `actioned` only if it is
    open and about the same teacher (else `invalid`, nothing written); audit `takedown.create`.
  - `lift(by, takedownId, { note? })`: reads the target, locks it, then the takedown `FOR UPDATE`
    and re-checks `active` (else `not_found`); sets `lifted`; agent → `live` when `live_version`
    is not null, else `draft`; document → `bumpRevision`; audit `takedown.lift`.
  - `listActiveForStaff(by)`: active takedowns newest first, capped at 200, with kind, target id,
    teacher slug, category, createdAt.
- `packages/db/src/repositories/retrieval.ts`: add `notTakenDown(chunks.documentId)` to `rank()`'s
  `scope` fragment (covers text, vector and term stats) and to `material()`.
- `packages/db/src/repositories/chunks.ts`: export `bumpRevision`; add `notTakenDown` to
  `listForModule`. No other change.
- `index.ts` (append `takedowns` entry and export line), `map.ts` (append row type), README section.
- Tests first: `packages/db/test/takedowns.int.test.ts` (the acceptance tests in "How it will be
  shown", both target kinds, lift, double takedown `invalid`, non-staff `scope`, report linking,
  audit rows, a two-connection test that takedown and `publish.goLive` on one agent never deadlock
  and always end `suspended` when the takedown commits last),
  `packages/db/test/takedowns.test.ts` (input validation), and an `EXPLAIN` check (or a note in the
  handoff) that the filter probes `takedowns_target_idx`. Shared appends as in Phase A.

State after B: takedowns work end to end in the database; retrieval, leakCheck and the outline
drafter skip taken-down documents; a suspended agent is invisible to students.

### Phase C: apps/web, report button in the chat (12.2c)
Files:
- `apps/web/app/api/sessions/[id]/reports/route.ts` and `handlers.ts` (new): `POST`, wrapped in
  `withRole(['student'])` (policy row `/api/sessions/**` already applies, clearance `agent`). Strict
  body `{ agentId, messageId, category }`; scope from `studentTurnScope` (import, don't edit); the
  student id only from the session. `created` either way is 201/200 with `{ ok: true }`; repository
  errors map to fixed codes (`not_found` 404, `invalid`/`scope` 400/403, else 500), no raw text.
- `apps/web/app/api/sessions/[id]/reports/route.test.ts` (new): 401/403 for signed out, teacher,
  staff; bad bodies 400; a body `studentId`/`teacherId` key 400; not own message 404; duplicate ok.
- `apps/web/src/chat/ReportButton.tsx` and `reportMessage.ts` (new, plus tests with jest-axe):
  a small "Report" button opens a category radio group with Send and Cancel; try/catch/finally
  around a busy flag; reply safeParsed; after success it shows "Thanks, our team will review
  this." and stays disabled for that message; an error re-enables it.
- `apps/web/src/chat/ChatView.tsx`: render `ReportButton` under agent and teacher messages that
  have a server id (history items, and finished turns with a `messageId`); no other change.
- `apps/web/app/learn/[agentId]/page.tsx`: one line, pass `report: messages.report` to the client
  provider.
- `apps/web/messages/en.json` (**shared**): append one top-level `report` block at the end.

State after C: a student can report any agent or teacher reply; staff can only see it through the
database until D and E.

### Phase D: apps/web, staff reports and takedowns API (12.2d)
Files:
- `apps/web/app/api/staff/reports/route.ts` and `handlers.ts` (new): `GET` the open queue,
  `POST { reportId, decision, note? }`, both `withRole(['staff'])`.
- `apps/web/app/api/staff/takedowns/route.ts` and `handlers.ts` (new): `GET` active takedowns,
  `POST` a discriminated body `{ action: 'create', kind, targetId, category, reportId?, note? }` or
  `{ action: 'lift', takedownId, note? }`.
- Tests: `route.test.ts` for each (guard 401/403 for student and teacher; strict bodies; a body
  `by` key 400; every repository error kind to its fixed code; `no-store`), and one
  `apps/web/app/api/staff/reports/route.int.test.ts` gated on `TEST_DATABASE_URL` like 12.1b: the
  student report handler files a report, the staff GET lists it; a document takedown through the
  staff POST removes the chunk from `retrievalIndexFor` search at once; lift restores it.

### Phase E: apps/web, staff reports page (12.2e)
Files:
- `apps/web/app/staff/reports/page.tsx`, `view.tsx`, `report-row.tsx`, `client.ts` (new) and
  `page.test.tsx`, `view.test.tsx`, `client.test.ts`: `requireRole(['staff'])` before any read;
  each report shows the category, when, teacher slug, the reported text (through `renderReply`,
  text nodes only) and its cited documents; actions Dismiss, Take down this document, Take down
  this agent (each with a confirm step) and an active-takedowns list with Lift. Polls every 60 s;
  `aria-live` count of open reports; one action at a time; every lesson from 8.4b and 9.5a
  (try/catch on body reads, finally on busy flags, safeParse with a fallback view). jest-axe clean.
- `apps/web/app/staff/page.tsx`: one nav entry to `/staff/reports`.
- `apps/web/messages/en.json` (**shared**): append one top-level `staffReports` block at the end.

## Files out of bounds
`packages/contracts/**`, `packages/harness/**`, `packages/db/src/schema/**`,
`packages/db/migrations/**`, `packages/db/src/identity/**`, `apps/web/src/auth/**` (policy and
guard unchanged), `apps/web/src/turn/**` (imported only), `apps/worker/**`,
`packages/db/src/repositories/subscriptions.ts` and `publish.ts` (9.6h is editing
subscriptions.ts; publish.ts is read for its lock order only), `apps/web/app/teacher/**`,
`.claude/**`. If any of these needs a change, stop at `Status: PARTIAL`.

## Tests first
Every phase writes its failing tests before the code (tdd-workflow): A and B the int tests named
above, C to E the route and view tests. The two acceptance tests (report visible to staff on the
next read; takedown excluded on the next search) are written first and run red.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (Phases A and B: reports.ts, takedowns.ts, retrieval.ts,
  chunks.ts, map.ts, index.ts, README.md). Reviewers: **security-reviewer**. Also recommended,
  not required by the gate: **database-reviewer** for Phase B (lock order, the retrieval
  predicate, the deadlock test).
- `apps/web/app/api/staff/**` (Phase D). Reviewers: **security-reviewer**.
- `apps/web/app/staff/**` (Phase E) is not a glob yet (12.1c adds it); treat it as risky and ask
  **security-reviewer** anyway.
- Not risky (checked): `apps/web/app/api/sessions/[id]/reports/**`, `apps/web/src/chat/**`,
  `apps/web/app/learn/**`, `apps/web/messages/en.json`, `packages/db/test/**`.
- No contracts, ADR, migration, harness, safety-group or `.claude/**` path is touched.
- Each of Phases A, B, D and E logs a `risk: high` decision in its handoff: A (staff read of
  reported messages, reporter hidden), B (takedown filter in retrieval, agent suspension and the
  lock order), D (staff trust API boundary), E (staff page).

## Open questions (none blocking; each has a recommendation)
1. Does "reaches staff < 5 minutes" need an outbound notice (email or SMS) when no one has the
   console open? **Recommendation:** no for now: the queue is instant and the open console polls
   every 60 s. Add a board task to page the trust inbox on a new report, reusing 12.5's alert
   channel when it lands.
2. Can a student add free text to a report? **Recommendation:** no; categories only for the
   pilot, so the table never stores student-written personal details. The reported reply gives
   staff the context.
3. What can be reported? **Recommendation:** agent and teacher replies in the chat only. Staff can
   take down the whole agent from any report. A report link on public teacher pages is a later
   task.
4. Should a material takedown delete the chunks or filter them? **Recommendation:** filter.
   It works at once, can be lifted, keeps evidence for 12.3's repeat-infringer count, and a
   teacher's replace of the same document can't bring it back.
5. Should taken-down material also leave leakCheck's locked index? **Recommendation:** yes. The
   model never sees it, so excluding it everywhere (with a revision bump) keeps "removed from
   retrieval" simple and consistent.
6. Does an agent takedown pause or refund subscriptions? **Recommendation:** no. Students simply
   can't start turns while it is suspended. Refunds wait for M10 (payments last).
7. Is the teacher told about a takedown? **Recommendation:** not in 12.2. Add a board task for a
   "Removed by Edmate staff" badge in the upload centre and the publish page. 12.3 owns the
   copyright notice and repeat-infringer steps and should read 12.2's `takedowns` rows
   (`reason = 'copyright'`).
8. Known gap: past chat messages and session summaries that quoted taken-down material keep that
   text. The acceptance covers retrieval only. **Recommendation:** accept for the pilot and note
   it for 13.4 (retention).

## Budget
Budget: 350 tool calls (5 phases, packages/db + apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck, lint and test for the phase's package; a
disposable Postgres container for int tests, never the `edmate-*` ones; the secret scan).

## Exit conditions
- `Status: DONE` for a phase when its tests are green (`corepack pnpm turbo run typecheck lint test
  --filter=<pkg>...`, int tests on a disposable Postgres), the secret scan is clean, the shared
  files were only appended to, and the handoff has its `risk: high` decision where listed. The
  task is DONE when Phase E is and the manual check is recorded.
- `Status: PARTIAL` past about 85 tool calls in a phase without green tests, or when a file out of
  bounds (above) turns out to need a change (for example a policy row, a schema change or a
  migration): stop and hand back instead of widening scope.

## Lead answers (22 Oct 2026)
- Phases run as board tasks 12.2a (reports repo), 12.2b (takedowns repo and the retrieval filter), 12.2c (report button and student route), 12.2d (staff reports and takedowns API) and 12.2e (/staff/reports page). Order: 12.2a, then 12.2b and 12.2c in parallel, then 12.2d, then 12.2e. Each phase has its own handoff in `docs/tasks/<phase id>/`.
- Reviewers: security-reviewer on 12.2a, 12.2b, 12.2d and 12.2e; database-reviewer on 12.2b too; typescript-reviewer and code-reviewer on every phase.
- Q1: no email or SMS now; the 60 s refresh meets the target while the console is open. Paging the trust inbox for new reports is follow-up 12.2f (with 12.5's alert channel and 4.3c).
- Q2–Q5: accepted as recommended (category only, no free text; only chat replies are reportable, staff can still take down the whole agent; a takedown hides material and can be lifted; taken-down material leaves the answer-leak check's material too).
- Q6: no pause or refund in 12.2. Payments are not live until M10; the human is asked in blocker B-49 what a paying student gets when an agent is taken down, and 10.x follows the answer.
- Q7: not in 12.2; the teacher's "Removed by Edmate staff" badge is follow-up 12.2f.
- Q8: accepted for internal testing; whether past chat text from taken-down material must be scrubbed before the pilot is in blocker B-49.

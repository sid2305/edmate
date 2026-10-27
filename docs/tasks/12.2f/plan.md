# 12.2f plan — 12.2 follow-ups: trust-inbox paging, a teacher takedown badge, and three LOWs

## Acceptance (verbatim)
> each follow-up has a test; touched packages green.

Shown by: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web`
green, plus each new/changed test quoted red-then-green in the handoff per phase, plus a
`## Decisions` entry (risk: high, standing rule) for the risky-path phases.

## Scope and what waits
The task title bundles six items. 4.3c (real SMS/email paging behind a notifier port) is
`status: todo`, deps `GATE, 4.3` — not built. 12.5 (the staff safety-alert inbox: record, list,
acknowledge, 15-minute escalation) is `status: done` (phases a+b+c). So "page the trust inbox when
a report arrives" can be built now as **an entry in the existing staff alert inbox** (12.5's
`safetyAlerts.record` + `/staff/alerts`), with no re-paging/escalation wired to it (see Q1) and no
real phone/email (that part waits on 4.3c — named below, not built here).

Four independently green phases, each its own commit:
- **Phase A** — the three LOWs (12.2a x2, 12.2d, 12.2g x2 tests). No risky-path behaviour change.
- **Phase B** — the trust-inbox alert on a new report.
- **Phase C** — the "Removed by Edmate staff" badge for a taken-down **document**.
- **Phase D** — the same badge for a taken-down **agent**.

## Design

### Phase A — the three deferred LOWs
1. `packages/db/src/repositories/reports.ts` `listOpenForStaff`: `rows.map((r) => toStaffReportRow(...))`
   throws `RepositoryError('integrity', method)` for the **whole batch** when one row's stored
   `reason` fails `ReportCategorySchema` (e.g. a value written before a category was removed from
   `REPORT_CATEGORIES`). Fix: wrap each row's `toStaffReportRow` call and skip (don't push) a row
   that throws `integrity`, logging nothing from this pure function — the caller (the staff route)
   already logs only error names, and here there is no error to log since the batch no longer
   throws. One bad row drops out of the queue instead of hiding every row.
2. Same file, the cited-documents query (`REPORTS_QUEUE_MAX_LIMIT * REPORT_CITED_DOCUMENTS_MAX`
   batch-wide cap): the lower-risk fix the review names is to document the cap, not restructure the
   query (scoping it per report needs a lateral join or N queries — out of scope for a LOW). Add a
   code comment directly above the `.limit(...)` call stating: the cap is batch-wide, ordered by
   `(createdAt, id)` ascending, so once more than `REPORTS_QUEUE_MAX_LIMIT * REPORT_CITED_DOCUMENTS_MAX`
   distinct (teacher, title) document rows exist across the open queue, a report late in that order
   can have its `citedDocuments` silently truncated below its own per-report cap; acceptable at
   today's queue sizes, revisit if the queue regularly nears the cap. No behaviour change, no new
   test (doc-only).
3. `apps/web/app/api/staff/reports/handlers.ts` and `apps/web/app/api/staff/takedowns/handlers.ts`:
   both declare a local `export const MAX_NOTE_CHARS = 500` duplicating `@edmate/db`'s
   `REPORT_NOTE_MAX` / `TAKEDOWN_NOTE_MAX` (both already exported from the package's barrel,
   confirmed in `packages/db/src/repositories/index.ts`). Fix: import the real constant and assign
   it to the same exported name (`export const MAX_NOTE_CHARS = REPORT_NOTE_MAX;` /
   `= TAKEDOWN_NOTE_MAX;`) — keeps the existing export name so `route.test.ts` in both folders (which
   imports `MAX_NOTE_CHARS`) needs no change, while removing the duplicated literal.
4. `apps/web/app/staff/reports/view.test.tsx`: add the two tests the 12.2g review named: (a) an
   `<a href="javascript:...">` string embedded in reported text renders as inert plain text (same
   pattern as the existing markdown-link test at line 255: assert the literal string is shown via
   `getByText` and `screen.queryByRole('link')` is `null`); (b) the stale-poll test at line 283
   (dismissed report) has a sibling for a **lifted takedown**: start a poll in flight, Lift a
   takedown (confirm-free action), let the stale poll resolve with the old (still-active) takedown
   row, and assert the takedown stays gone (same `generationRef` staleness guard, the takedowns
   side of the same code path).

### Phase B — page the trust inbox on a new report
`apps/web/app/api/sessions/[id]/reports/handlers.ts` (`createSessionReportsHandlers`'s `file`
handler): after `reports.file(...)` returns `{ created: true }` (a genuinely new report, never a
duplicate), best-effort record a `kind: 'other'`, `level: 'info'` `SafetyAlert` via
`repos().safetyAlerts.record(...)` so the report shows up in the existing staff alert inbox
(`/staff/alerts`, 12.5) alongside real safety alerts, in addition to the `/staff/reports` queue
(12.2e). `excerptRedacted` is a **fixed, non-PII string** built only from the closed-set category —
never the reported message's text or the reporter's identity: `` `A student reported a ${category}
reply.` `` (`category` is one of the five fixed `REPORT_CATEGORIES` values, never free text, so
this cannot leak anything). `studentId`/`teacherId`/`sessionId` come straight from the already-
validated `scope` and `path.data.id` used for `reports.file` itself — no new lookup. The alert `id`
is derived deterministically from the report id with a local helper (same shape as `reports.ts`'s
`reportRowId`: `createHash('sha256').update(...).digest('hex')`, a different domain tag so it can
never collide with a report id), so a retried request or a replayed duplicate report never double-
records (`safetyAlerts.record` is already `on conflict (id) do nothing`). The write is wrapped in
its own `try/catch`: a failure here (e.g. the session row is gone by the time this second write
runs) is logged by **event name and error name only** (`sessions.reports.alert_failed`, never the
report id or any text) and never changes the response — the report itself already succeeded and
that is what `{ ok: true }` reports. No escalation/re-page wiring (Q1) and no change to
`apps/worker/src/alerts/**` or the queue.

`SessionReportsBackend`'s `repos()` return type widens from `Pick<Repositories, 'reports'>` to
`Pick<Repositories, 'reports' | 'safetyAlerts'>`; the one runtime wiring call site (outside this
plan's files, confirmed by grep before editing) already returns the full `Repositories` object, so
no other file needs a change there.

### Phase C — "Removed by Edmate staff" badge, documents
A taken-down document already has a `takenDown` boolean computed today only for the staff view
(`reports.ts`'s `sql<boolean>\`not ${notTakenDown(documents.id)}\`.mapWith(Boolean)`). The teacher's
own upload centre never reads it. Add it to the teacher-facing read, end to end:
1. `packages/db/src/repositories/map.ts`: add `takenDown: z.boolean()` to `DocumentRowSchema`, and
   the matching required field (not optional — a document is never ambiguously taken-down) to
   `toDocumentRow`'s input type and build.
2. `packages/db/src/repositories/chunks.ts`: both query sites that build `DocumentRow` (`get` and
   `listForTeacher`, confirmed as the only two `toDocumentRow(...)` call sites) add the same
   `takenDown` column using the existing `notTakenDown` import (already imported in this file),
   the same expression the staff report query uses: `sql<boolean>\`not ${notTakenDown(documents.id)}\`.mapWith(Boolean)`.
3. `apps/web/src/studio/routes.ts`: `view(row: DocumentRow)` (the shape the upload centre's GET
   returns) adds `takenDown: row.takenDown`.
4. `apps/web/src/studio/uploadClient.ts`: `DocumentView` adds `takenDown: boolean`.
5. `apps/web/app/teacher/uploads/UploadsView.tsx`: each document row shows a "Removed by Edmate
   staff" badge (new `uploads.takenDownBadge` message key) when `d.takenDown`, alongside (not
   replacing) its existing `status.${d.status}` text — a document can be `ready` and taken down at
   once (status is upload lifecycle; takedown is a separate axis, confirmed by reading
   `takedowns.ts`'s header comment).
6. `apps/web/messages/en.json`: one new key under the existing `uploads` block (append-only, same
   lesson as 12.2e's `staffReports` block: verify the JSON diff adds only this key).

### Phase D — "Removed by Edmate staff" badge, agent
An agent takedown already sets `agents.status = 'suspended'` (confirmed in `takedowns.ts`); the
teacher only learns this today when they try to run the publish gate or start a publish (`suspended`
in `PublishView.tsx`'s `RUN_ERROR_KEYS`/`START_ERROR_KEYS` — a reactive error, not a standing badge).
Add a persistent badge, visible on page load with no action needed:
1. `apps/web/src/studio/publish.ts` (the route backing `loadLatestRun`): read the scope's own agent
   status via the existing `repos().agents.get(scope, agentId)` (no new repository method — the
   field already exists on `AgentRow`/the agents table) and add `agentStatus: row.status` to the
   JSON `loadLatestRun` returns, alongside the existing run fields.
2. `apps/web/src/studio/publishClient.ts`: the `PublishRun`-adjacent load result type gains
   `agentStatus: 'draft' | 'live' | 'suspended'`.
3. `apps/web/app/teacher/publish/PublishView.tsx`: renders a standing "Removed by Edmate staff"
   banner (new `publish.suspendedBanner` message key) whenever the loaded `agentStatus ===
   'suspended'`, independent of whether a gate run or a start attempt has happened — the existing
   `suspended` error-key copy on a failed start/run stays as is (same wording is fine; this is an
   additive, always-visible notice, not a replacement).
4. `apps/web/messages/en.json`: one new key under the existing `publish` block (append-only).

## Files to create/modify
- Phase A: `packages/db/src/repositories/reports.ts`, `packages/db/test/repositories.int.test.ts` or
  `reports.test.ts` (whichever already covers `listOpenForStaff`/`reviews` — confirm which exists
  before editing), `apps/web/app/api/staff/reports/handlers.ts`,
  `apps/web/app/api/staff/takedowns/handlers.ts`, `apps/web/app/staff/reports/view.test.tsx`.
- Phase B: `apps/web/app/api/sessions/[id]/reports/handlers.ts`,
  `apps/web/app/api/sessions/[id]/reports/route.test.ts`.
- Phase C: `packages/db/src/repositories/map.ts`, `packages/db/src/repositories/chunks.ts`,
  `packages/db/test/repositories.int.test.ts` (documents tests), `apps/web/src/studio/routes.ts`,
  `apps/web/src/studio/routes.test.ts`, `apps/web/src/studio/uploadClient.ts`,
  `apps/web/src/studio/uploadClient.test.ts`, `apps/web/app/teacher/uploads/UploadsView.tsx`,
  `apps/web/app/teacher/uploads/UploadsView.test.tsx`, `apps/web/messages/en.json`.
- Phase D: `apps/web/src/studio/publish.ts`, `apps/web/src/studio/publish.test.ts`,
  `apps/web/src/studio/publishClient.ts`, `apps/web/src/studio/publishClient.test.ts`,
  `apps/web/app/teacher/publish/PublishView.tsx`, `apps/web/app/teacher/publish/PublishView.test.tsx`,
  `apps/web/messages/en.json`.
- No new files; no migration (every field above reads existing columns/tables).

## Files out of bounds
`apps/worker/src/alerts/**`, `packages/queue/**` (no escalation/re-page wiring in Phase B — Q1),
`packages/contracts/src/safety.ts` (no new `SafetyAlert` kind/level — `other`/`info` already exist),
`apps/web/app/staff/alerts/**` (the inbox UI itself is unchanged; Phase B only adds a row to what it
already reads), `packages/db/src/repositories/takedowns.ts`, `packages/db/src/repositories/safety-alerts.ts`
(read-only use of their existing exports; no behaviour change inside either file), any
`packages/db` migration, `apps/web/app/staff/reports/report-row.tsx` / `view.tsx` (Phase A's view
test needs no production change — the review already says "the code is already safe"),
`content/prompt-packs/**`, `packages/harness/**` (unrelated to this task).

## Tests first
- Phase A.1: add a `listOpenForStaff` case with one open report whose stored `reason` is not in
  `REPORT_CATEGORIES` (insert directly, bypassing the app-level enum) alongside one normal open
  report; red today (throws for the batch); green after the fix (returns only the normal report).
- Phase A.3: no new test needed — the existing `route.test.ts` note-length cases already exercise
  `MAX_NOTE_CHARS`; confirm they stay green with the value now sourced from `@edmate/db`.
- Phase A.4: the two named tests, written to fail first against the **current** file (confirm the
  javascript-href case already passes with no production change — the review says the code is
  already safe, so this test is a coverage addition, not a red-first fix; the stale-poll-lift case
  should also already pass against the current `view.tsx` — confirm, and if either is unexpectedly
  red, stop and say so rather than widening Phase A into a production fix).
- Phase B: `route.test.ts` cases — a new report (`created: true`) also calls
  `repos().safetyAlerts.record` with the expected fixed-string excerpt and the scope's own ids; a
  duplicate report (`created: false`) does not call it a second time; a `safetyAlerts.record`
  rejection still returns the same `{ ok: true }` the report write already produced, and logs only
  `sessions.reports.alert_failed` with the error's name.
- Phase C: a `listForTeacher`/`get` case where a document has an active takedown returns
  `takenDown: true` and one with no takedown returns `false`; `routes.test.ts` asserts `view()`
  passes the field through; `UploadsView.test.tsx` renders the badge only when `takenDown` is true,
  alongside (not instead of) the existing status text.
- Phase D: `publish.test.ts` asserts `loadLatestRun`'s reply carries `agentStatus` from
  `agents.get`; `PublishView.test.tsx` renders the standing banner when `agentStatus === 'suspended'`
  with no run or start attempt, and not otherwise.

## Risky paths touched (checked against .claude/skills/merge-gate/risk-paths.txt)
- `packages/db/src/repositories/**` — reviewers: **security-reviewer** (code-reviewer always
  required). Touched in Phase A (`reports.ts`) and Phase C (`map.ts`, `chunks.ts`).
- `apps/web/app/api/staff/**` — reviewers: **security-reviewer**. Touched in Phase A
  (`staff/reports/handlers.ts`, `staff/takedowns/handlers.ts`), import-only change.
- `apps/web/app/staff/**` — reviewers: **security-reviewer**. Touched in Phase A
  (`staff/reports/view.test.tsx`), test-only.
- `apps/web/app/api/sessions/[id]/reports/handlers.ts` (Phase B) matches no risk-paths.txt glob —
  it is under `apps/web/app/api/sessions/**`, not `/api/staff/**`, `/api/auth/**` or
  `/api/webhooks/**`. Not risky by path, but it does write a new row via `safetyAlertsRepo` (a
  method inside the risky `packages/db/src/repositories/**`, used, not edited) — name this in the
  PR description for the reviewer's context even though the glob doesn't require it.
- `apps/web/src/studio/routes.ts`, `uploadClient.ts`, `publish.ts`, `publishClient.ts`,
  `PublishView.tsx`, `UploadsView.tsx` (Phases C/D) match no risk-paths.txt glob.
- Log a `risk: high` decision at closeout for Phases A and C (standing rule, `packages/db/src/repositories/**`
  touched), naming the required reviewer.

No `packages/contracts` change in any phase (Phase B reuses the existing `SafetyAlert` `other`/`info`
values; no new exported type), so no architect/ADR review is needed.

## Questions
1. **Does the new report alert escalate/re-page like a real safety alert?** Recommend **no**. 12.5's
   15-minute escalation exists for alerts where an unacknowledged risk is dangerous (distress,
   abuse, misuse); a filed report is already visible and actionable in `/staff/reports` under its
   own 5-minute visibility bar (12.2's accept criterion), so a second re-paging channel for the same
   event risks alert fatigue in the one inbox meant for safety escalations. Build Phase B with no
   enqueue to the escalation queue; if the human wants reports to also escalate, that is a small,
   separate follow-up once seen in practice.
2. **Alert `kind` for a filed report: `other` or `misuse`?** Recommend **`other`**. `misuse` is used
   today only for decisive guard blocks (harm-to-others, critical level) — reusing it for a student
   complaint would blur that signal in the staff inbox's filtering/metrics. `other` is the schema's
   explicit catch-all.
3. **Badge wording**: "Removed by Edmate staff" is the task title's own wording; used verbatim for
   both Phase C and Phase D's message keys unless the human prefers different copy for the two
   surfaces (document vs. agent). Recommend keeping it identical — same action, same actor, same
   plain meaning either way.

## Budget
Budget: 195 tool calls (4 phases: A 45, B 35, C 60, D 55; packages: db, web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test and the secret scan only).

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web`, plus
`python3 .githooks/secret-scan.py --all`, run at the end of every phase.

## Exit conditions
Each phase: `Status: DONE` once that phase's files are green (gate above) with its tests quoted
red-then-green, and (for Phases A and C) a `risk: high` decision logged. `Status: PARTIAL` past
roughly that phase's own tool-call share above, or if a file outside that phase's "Files to
create/modify" needs changing (e.g. a second `toDocumentRow` call site turns up, or the runtime
wiring for `SessionReportsBackend` turns out not to pass the full `Repositories` object) — hand back
with what was found rather than widening scope. Phase D only starts once Phase C's handoff is read
(same pattern as the plan's other phased tasks); a Phase B or D builder that finds 4.3c has landed
in the meantime still does not wire real paging here — that stays 4.3c's own task.

## Lead answers (27 Oct 2026)
- Q1: no escalation. A filed report adds an in-app staff inbox alert only; no escalation-queue enqueue. Real paging stays with 4.3c.
- Q2: `kind: 'other'`, as recommended; `misuse` stays for decisive guard blocks.
- Q3: "Removed by Edmate staff" on both surfaces (documents and agent), as recommended.
- Sequencing: Phase A starts only after 9.2g merges (shared `apps/web/app/staff/**`, `apps/web/messages/en.json` and `packages/db/src/repositories/map.ts`); the builder merges `origin/main` first.

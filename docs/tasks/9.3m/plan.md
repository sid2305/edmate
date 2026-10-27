# 9.3m plan — a teacher's subject-edit history, written and shown to staff

Status: **READY**

## Acceptance (verbatim from the board)

> editing a subject writes one teacher.subject audit row; a staff view test shows a teacher's
> past subject changes on a queue row; db and web typecheck, lint and test green.

## Decision this plan builds (B-58, human, 26 Oct 2026)

From `docs/decisions/log.md`: "each subject edit writes an audit row (old and new subject only),
and staff see the last 10 changes." Why: "staff can spot a teacher who switches subjects to get
past a rejection; no new personal data and no migration."

Starting design: `docs/tasks/9.3k/plan.md` ("Design — Q1's follow-up, if approved"), confirmed
against the current code below. This plan refines that sketch into exact files, types and tests.

## What I read

- `packages/db/src/repositories/teacher-profiles.ts` `update()` (lines ~206-231): today a single
  `UPDATE ... RETURNING` with a `CASE` that resets `verificationStatus` to `pending` when the
  stored subject differs from the incoming one (8.1c, B-30). No audit write. The `CASE` works
  because a `SET` expression sees the row's **pre-update** value of a column it also sets — the
  same property this plan's new write needs, but `RETURNING` itself only ever reflects the **new**
  row, so the old subject must be captured a different way (see Design, Phase A).
- `packages/db/src/repositories/audit.ts`: `insertAuditEntry` (the one write path: actor check,
  redaction, size cap), `findLastVerifyForStaff` (staff-only read, `lockRole`-gated, parses a
  known `after` shape with a local zod schema and throws `integrity` if it doesn't match) is the
  precedent for this plan's new read. `AUDIT_MAX_LIMIT` (200) is the general cap; B-58's own cap
  (10) is smaller and task-specific, so it gets its own exported constant, not `AUDIT_MAX_LIMIT`.
- `apps/web/app/api/staff/verifications/handlers.ts`: `enrichQueueRows` is the one helper `list`,
  `lookup` and `page.tsx`'s SSR first paint all share (9.3h) — adding subject history here, once,
  reaches a queue row, a lookup row and the server-rendered first paint together, matching the
  acceptance line's "on a queue row".
- `apps/web/app/staff/{verification-row.tsx, client.ts}`, `apps/web/app/staff/page.tsx`,
  `apps/web/app/api/staff/verifications/route.ts` and `.../lookup/route.ts`: confirmed `toQueueItem`
  / `toLookupItem` are called from `handlers.ts` (`list`, `lookup`) and `page.tsx` — all three call
  sites need their call updated when the two functions' signatures grow a parameter.
- `packages/db/src/schema/operations.ts` (`auditLog` table, lines ~249-274): `audit_log_teacher_id_
  ts_idx` on `(teacher_id, ts)` already exists and is what `findLastVerifyForStaff` scans with an
  `action = 'teacher.verify'` filter layered on top — the new read reuses it the same way with
  `action = 'teacher.subject'`. **No migration**: no new column, table or index.
- `packages/db/test/scope.test.ts` (~line 136-140): `findLastVerifyForStaff`'s own exclusion line
  (it takes a bare staff id and bare teacher id, not a `TeacherScope`/`StudentScope`, so it's
  excluded from the generic bad-scope grid and gets its own cases in `audit.test.ts` and
  `repositories.int.test.ts`) — the new method needs an identical line.
- `packages/db/test/audit.test.ts` and `packages/db/test/repositories.int.test.ts` (~line 4137-4182,
  6424): `findLastVerifyForStaff`'s unit (invalid-input, no DB) and integration (grid entry) test
  shapes are this plan's template for the new method.
- `packages/db/test/teacher-profiles.int.test.ts` (~line 488-539): the existing subject-reset tests
  ("a verified teacher who changes subject is pending again", "...goes back to pending", "...stays
  pending") assert the CASE's behaviour by calling `update()` once and checking the result — there
  is no literal concurrency-race harness anywhere in this file today (checked: no `Promise.all` /
  race test for `setVerification` vs `update()`). This plan's new tests follow the same
  call-once-and-assert shape, not a new timing harness — see Tests below.

## Design

Two phases (different packages; each is its own green commit and handoff note, per the team's
sizing rule). **Phase A must merge before Phase B** (Phase B's tests mock `repos.audit.
findSubjectHistoryForStaff`, which does not exist until Phase A ships).

### Phase A — `packages/db` (risky: `packages/db/src/repositories/**`)

1. **`teacher-profiles.ts` `update()`**: only the `p.subject !== undefined` branch changes.
   - Today's no-subject-change path (`displayName`/`bio`/`languages` only) is untouched: still one
     plain `db.update(...).returning(columns)`, no transaction, no audit row.
   - When `p.subject !== undefined`: the statement that updates the row must still be the *only*
     place the pre-update subject is read (no separate `SELECT` beforehand — that would reopen the
     read-then-write window 8.1c closed). Shape it as one SQL statement with a sibling read-only
     CTE alongside the existing data-modifying one, e.g. `WITH prev AS (SELECT subject FROM
     teacher_profiles WHERE user_id = $1), upd AS (UPDATE teacher_profiles SET subject = $2,
     verification_status = <existing CASE> WHERE user_id = $1 RETURNING ...) SELECT upd.*, prev.
     subject AS prev_subject FROM upd, prev` (run via `db.execute(sql\`...\`)`/drizzle's `$with`,
     builder's choice of exact API) — every CTE in one statement runs against the same snapshot and
     the data-modifying CTE still takes the normal row lock, so this adds no new window. Issued
     inside `db.transaction(async (tx) => ...)` so the audit insert below can follow in the same
     transaction.
   - After that statement: if `row` is missing, `not_found` (unchanged). Otherwise, compare
     `prev_subject` to the new `subject` in application code (string equality, same condition the
     existing CASE already tests) and, only when they differ, call `insertAuditEntry(tx, method,
     teacherId, null, { actor: teacherId, actorRole: 'teacher', action: 'teacher.subject', target:
     \`teacher:${teacherId}\`, before: { subject: prevSubject }, after: { subject: newSubject } })`
     — matches B-58's "old and new subject only" (no bio, no languages, no reason: `update()` takes
     no actor-supplied reason).
   - `prev_subject` is read out of the raw-SQL row only to decide whether to write the audit row;
     it is never passed to `toTeacherProfile` (which keeps taking exactly today's `columns` shape).

2. **`audit.ts`**: new exported constant `SUBJECT_HISTORY_MAX_LIMIT = 10` (B-58's own cap; not
   `AUDIT_MAX_LIMIT`, which is the general 200-row cap for other reads). New method:
   ```
   findSubjectHistoryForStaff(by: unknown, teacherId: unknown, limit: unknown):
     Promise<{ from: string; to: string; ts: string }[]>
   ```
   Same shape as `findLastVerifyForStaff`: `parseArg(IdSchema, by, method)` and `parseArg(IdSchema,
   teacherId, method)` before any SQL (`invalid` on a malformed id); `limit` parsed with a
   `z.int().min(1).max(SUBJECT_HISTORY_MAX_LIMIT)` schema (`invalid` if out of range); `lockRole(tx,
   staff) !== 'staff'` → `scope`; else select rows where `teacherId = tid AND action =
   'teacher.subject'`, `order by ts desc, id desc`, `limit`. Each row's `before`/`after` are parsed
   with a local strict zod shape (`{ subject: string }` each, same pattern as `VerifyAfter`,
   defined locally in `audit.ts` — not imported from `teacher-profiles.ts`, to avoid a cycle with
   that file's existing `import { insertAuditEntry } from './audit.js'`); a row that fails either
   shape is `integrity` (never returned), matching `findLastVerifyForStaff`'s own handling. Maps to
   `{ from: before.subject, to: after.subject, ts: iso(row.ts) }`.

3. **Tests first** (write before the implementation above):
   - `packages/db/test/audit.test.ts`: a new `describe('audit.findSubjectHistoryForStaff rejects
     before any SQL', ...)` block mirroring the existing `findLastVerifyForStaff` block exactly —
     malformed staff id, malformed teacher id, and (new, since this method takes a third argument)
     malformed/out-of-range limit, all `invalid`, all with the same `BAD_IDS`-style table.
   - `packages/db/test/scope.test.ts`: one new exclusion line for `audit.findSubjectHistoryForStaff`
     next to `findLastVerifyForStaff`'s, same comment shape (bare ids, not a scope object).
   - `packages/db/test/teacher-profiles.int.test.ts`: extend the existing subject-reset describe
     block (~line 488) so each of its three cases ("verified → pending", "rejected → pending",
     "pending stays pending") also asserts a `teacher.subject` audit row now exists with the
     correct `before`/`after`; add one new case for a patch that sets `subject` to its *current*
     value (trimmed) — asserts **no** audit row is written (the silent-no-op risk the lesson in
     9.3k's plan calls out: "a check that silently skips looks like a pass" — get the comparison
     wrong and every edit silently stops being recorded, so this case must fail loudly if the guard
     breaks) — call `audit.listForTeacher` or a direct count query to prove the absence. Also add a
     case for two sequential subject changes asserting both audit rows exist, newest first.
   - `packages/db/test/repositories.int.test.ts`: a new grid entry `'audit.findSubjectHistoryForStaff'`
     next to `'audit.findLastVerifyForStaff'` (~line 4137), following its shape: a non-staff `by` is
     `scope`; a malformed `teacherId` is `invalid`; a teacher with no subject changes returns `[]`;
     a teacher with changes returns them newest-first, capped at `limit`; a limit over
     `SUBJECT_HISTORY_MAX_LIMIT` is `invalid`. Also add the method name to the list near line 6424
     if that's a coverage/completeness list (confirm its purpose when editing, same file).
   - Coverage: 100% statements/functions/lines maintained in `packages/db` (existing project rule).

### Phase B — `apps/web` (risky: `apps/web/app/api/staff/**`)

1. **`apps/web/app/api/staff/verifications/handlers.ts`**:
   - `enrichQueueRows` adds one more parallel per-row call: `repos.audit.findSubjectHistoryForStaff
     (by, row.teacherId, 10)` (the fixed cap; no UI control to change it), alongside the existing
     `findLastVerifyForStaff` call for that row.
   - New exported interface `SubjectChange { from: string; to: string; ts: string }`.
   - `QueueItem` gains `subjectHistory: SubjectChange[]`; `toQueueItem` gains a fourth parameter
     (default `[]`, same default style as the existing two); `toLookupItem` forwards it the same
     way `lastDecision` is forwarded today.
   - `Pick<Repositories, 'teacherProfiles' | 'takedowns' | 'audit'>` already includes `audit` — no
     type widening needed there.

2. **`apps/web/app/staff/client.ts`**: new `SubjectChangeSchema` (`{from: string, to: string, ts:
   string}`), `QueueItemSchema` gains `subjectHistory: z.array(SubjectChangeSchema)`.

3. **`apps/web/app/staff/verification-row.tsx`**: one more `dt`/`dd` pair, same list style as
   `activeTakedowns`/`lastDecision` (`subjectHistoryLabel`; empty → `subjectHistoryNone`; else a
   list of `subjectHistoryLine` entries, one per change, each formatted the same way
   `lastDecisionLine` formats its date — reuse `useFormatter().dateTime(...)`, no new formatting
   helper).

4. **`apps/web/app/staff/page.tsx`**: update its own `toQueueItem(r, r.activeTakedowns, r.
   lastDecision)` call to also pass `r.subjectHistory` (the only other call site besides `handlers.
   ts`'s own `list`/`lookup`).

5. **`apps/web/messages/en.json`** (`staff` namespace, near `lastDecisionLabel`/`lastDecisionLine`
   at ~line 638-643): add `subjectHistoryLabel`, `subjectHistoryNone`, `subjectHistoryLine` (e.g.
   `"{from} to {to} on {date}"`).

6. **Tests first** (write before each implementation change above), following 9.3h's own pattern
   for `activeTakedowns`/`lastDecision` file-by-file:
   - `apps/web/app/api/staff/verifications/handlers.test.ts` (if it exists) or the relevant unit
     test for `enrichQueueRows`/`toQueueItem`/`toLookupItem` — a case with a non-empty
     `subjectHistory`.
   - `apps/web/app/api/staff/verifications/route.test.ts`, `route.int.test.ts` — extend the staff
     `audit` repo mock/fixture with `findSubjectHistoryForStaff` and assert the field appears in the
     `list`/`decide`/lookup response bodies.
   - `apps/web/app/staff/client.test.ts` — a round-trip case through `QueueItemSchema`/
     `loadQueue`/`findTeacherBySlug` with a non-empty `subjectHistory`.
   - `apps/web/app/staff/page.test.tsx` — the SSR fixture gains `subjectHistory` so `toQueueItem`'s
     new argument is exercised from `page.tsx`'s own call site.
   - `apps/web/app/staff/view.test.tsx` — **the acceptance line's own test**: a queue-row case
     asserting the rendered subject-history lines (old → new, formatted date) for a row whose fixture
     carries a non-empty `subjectHistory`, plus an empty-history case asserting
     `subjectHistoryNone`.

## Files to create / modify

Phase A:
- `packages/db/src/repositories/teacher-profiles.ts` — `update()`'s subject branch.
- `packages/db/src/repositories/audit.ts` — `SUBJECT_HISTORY_MAX_LIMIT`, `findSubjectHistoryForStaff`.
- `packages/db/test/audit.test.ts`, `packages/db/test/scope.test.ts`,
  `packages/db/test/teacher-profiles.int.test.ts`, `packages/db/test/repositories.int.test.ts`.

Phase B:
- `apps/web/app/api/staff/verifications/handlers.ts`
- `apps/web/app/staff/client.ts`
- `apps/web/app/staff/verification-row.tsx`
- `apps/web/app/staff/page.tsx`
- `apps/web/messages/en.json`
- `apps/web/app/api/staff/verifications/route.test.ts`, `route.int.test.ts`
- `apps/web/app/staff/client.test.ts`, `page.test.tsx`, `view.test.tsx`
- (confirm at build time whether a standalone `handlers.test.ts` exists for `enrichQueueRows`; if
  not, its case goes in `route.test.ts` alongside the others, same as 9.3h's own follow-up did)

## Files out of bounds

- `packages/db/src/repositories/safety-alerts.ts`, `apps/web/app/api/me/**`,
  `apps/web/src/account/**`, `apps/web/src/export/**` — 13.4b is building these concurrently
  (adding a method to `safety-alerts.ts` and the account/export API and UI). This plan touches
  none of them.
- `packages/contracts/**` — no new error code; `RepositoryError` kinds (`invalid`, `scope`,
  `not_found`, `integrity`) are all existing ones, same as `findLastVerifyForStaff`.
- `packages/db/src/schema/**` — no schema or migration change (see "What I read" above: the
  existing `audit_log` table, its `action`/`before`/`after` columns and the
  `audit_log_teacher_id_ts_idx` index already serve this read).
- `apps/web/app/staff/alerts/**`, `apps/web/app/staff/agents/**`, `apps/web/app/staff/reports/**` —
  unrelated staff console pages.
- `teacherProfiles.setVerification`, `takedowns.ts` — unchanged; this plan's `update()` edit is
  scoped to the `subject` branch only, and the lock order comment in `setVerification`'s own
  docstring (role → profile → agents → takedowns) is undisturbed since this plan adds no new lock
  (the audit insert only touches `audit_log`, same as `setVerification`'s own `teacher.verify`
  write).

## Why no migration

B-58's write reuses the existing `audit_log` table (a new `action` string value, `'teacher.
subject'`, needs no new column — `action` is already a free-form `varchar`/text column other
actions like `teacher.verify` and `takedown.create` populate) and the existing
`audit_log_teacher_id_ts_idx` index (teacher_id, ts), the same index `findLastVerifyForStaff`
already scans with its own `action` filter layered on top. No new table, column or index.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/teacher-profiles.ts`, `packages/db/src/repositories/audit.ts` —
  group `packages/db/src/repositories/**`: required `security-reviewer`. Recommended also
  `database-reviewer` (the CTE/lock-order shape of the new `update()` statement, and the new
  audit-insert-in-a-transaction path, are exactly the kind of change that reviewer group exists
  for) and `code-reviewer`.
- `apps/web/app/api/staff/verifications/handlers.ts` — group `apps/web/app/api/staff/**`: required
  `security-reviewer`. Recommended also `code-reviewer`.
- Not risky by path: `apps/web/app/staff/**` (console UI/tests, not under `apps/web/app/api/**`),
  `apps/web/messages/en.json`, every test file touched. No `packages/contracts/**`, no ADR, no
  `.claude/**`/`.githooks/**`, no migration.
- This is a `risk: high` task (per the board) — the handoff for **each phase** logs its own
  `risk: high` decision (Phase A: the new audit write and its lock-order/no-read-then-write-window
  property; Phase B: the new staff-facing field).

## Decisions to log (handoff `## Decisions`, risk: high, one per phase)

- Phase A: "`teacherProfiles.update()` now writes a `teacher.subject` audit row (old/new subject
  only) when a patch changes the stored subject, captured in the same statement as the UPDATE (a
  sibling read-only CTE) so there is no read-then-write window; `audit.findSubjectHistoryForStaff`
  reads the last `SUBJECT_HISTORY_MAX_LIMIT` (10) such rows for staff. B-58."
- Phase B: "the staff verification queue, lookup and SSR first paint (`enrichQueueRows`) now show
  each row's last 10 subject changes (old → new, dated), per B-58's cap."

## Gate commands

```bash
source ~/.nvm/nvm.sh && corepack pnpm install
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/web...
python3 .claude/skills/merge-gate/merge_gate.py 9.3m
python3 .githooks/secret-scan.py --all
```
(run from the repo root; `@edmate/web...` includes its dependents per the "gate dependents in
briefs" lesson; Phase A's own gate run only needs the `@edmate/db` filter since no exported type
changes shape until Phase B adds `subjectHistory`.)

## Open questions

None blocking — B-58 (Q1 from 9.3k) and Q2 (the cap: 10) are both answered. One judgment call this
plan makes and is prepared to be told to change: the staff-facing shape is `{from, to, ts}` per
change (reconstructed from each row's `before`/`after`) rather than a flat list of subjects only,
because B-58's own "why" ("staff can spot a teacher who switches subjects to get past a rejection")
reads most clearly as an old→new line per change, and it costs nothing extra (both values are
already stored on the row).

## Budget

Budget: 95 tool calls (2 phases: Phase A ~45, Phase B ~50; packages/db, apps/web) — sized above the
single-phase "aim 50" rule of thumb because this task spans two packages and >8 files in total
(the sizing trigger in `CLAUDE.md`); each phase is its own builder, its own green commit, and its
own `risk: high` handoff decision. A fresh Phase B builder reads this plan and Phase A's handoff
before starting.

## Allowed tools

Phase A: Read, Grep, Glob, Edit, Bash (pnpm typecheck/lint/test for `@edmate/db`, the secret scan,
git add/commit/push on the task branch only). No Write needed (no new files; the test files already
exist and are edited, not created).

Phase B: Read, Grep, Glob, Edit, Bash (pnpm typecheck/lint/test for `@edmate/web...`, the secret
scan, git add/commit/push). No Write needed, same reason.

## Exit conditions

- `Status: DONE` (Phase A): the `teacher.subject` audit write and `findSubjectHistoryForStaff` are
  built tests-first, `@edmate/db` typecheck/lint/test green with coverage maintained, secret scan
  clean, handoff written with `Tool calls used:` and the Phase A `risk: high` decision above.
- `Status: DONE` (Phase B): the staff console shows subject history on a queue row (the acceptance
  line), tests-first, `@edmate/web...` typecheck/lint/test green, secret scan clean, handoff with
  `Tool calls used:` and the Phase B `risk: high` decision above.
- Stop at `Status: PARTIAL` past ~45 calls (Phase A) or ~50 calls (Phase B), or if the CTE shape
  can't be expressed cleanly through the project's existing drizzle helpers and would need a new
  shared SQL helper outside `teacher-profiles.ts` (a design question for the lead, not a judgment
  call to make alone) — or if anything touches `packages/db/src/repositories/safety-alerts.ts` or
  `apps/web/app/api/me/**`/`apps/web/src/account|export/**` (13.4b's files; out of bounds here).

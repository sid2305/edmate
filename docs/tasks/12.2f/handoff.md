# 12.2f Phase A handoff

Status: DONE (Phase A)

Branch: `m13/12.2f-report-followups`
Worktree: `.claude/worktrees/agent-a12744b3866280fa0` (relative to repo root)
SHA: `fd32b5e935cf4b95687f3fc342b1ba8d4e39a62d`

## Summary of changes

1. `packages/db/src/repositories/reports.ts` — `listOpenForStaff`: each row's
   `toStaffReportRow(...)` call is now wrapped in its own `try { ... } catch { ... }`. A row whose
   stored `reason` fails `ReportCategorySchema` throws `RepositoryError('integrity', ...)` inside
   `toStaffReportRow` (map.ts's `checked` helper is its only throw site, and it only ever throws
   that one kind) — that row is now skipped (dropped from `out`), not re-thrown for the whole
   batch. Nothing is logged from this catch: it is a pure function, and the caller (the staff
   route) already logs only error names.
2. Same file — added a code comment directly above the cited-documents `.limit(...)` call stating
   the cap is batch-wide (not per report), ordered by `(createdAt, id)` ascending, and can silently
   truncate a late report's `citedDocuments` once the queue is large; acceptable at today's sizes.
   Doc-only, no behaviour change.
3. `apps/web/app/api/staff/reports/handlers.ts` / `apps/web/app/api/staff/takedowns/handlers.ts` —
   `export const MAX_NOTE_CHARS` now assigns from `@edmate/db`'s `REPORT_NOTE_MAX` /
   `TAKEDOWN_NOTE_MAX` (both `500`) instead of a duplicated local literal. Export name kept
   unchanged so `route.test.ts` in both folders needed no change.
4. `apps/web/app/staff/reports/view.test.tsx` — added two tests the 12.2g review named:
   - `'reports the reported text as plain text: a javascript: link never becomes a live link'`
     (an `<a href="javascript:...">` string in reported text renders as inert plain text via
     `getByText`, no `link` role). Already passed against the current `view.tsx` — confirmed, no
     production change (the review already said the code is safe).
   - `'a stale poll in flight when a lift succeeds does not bring the lifted takedown back'`, the
     takedowns-side sibling of the existing dismiss-side stale-poll test: a poll starts in flight
     (`loadTakedowns` held open), the takedown is lifted (confirm-free), then the stale poll
     resolves with the old (still-active) takedown row; the takedown stays gone (same
     `generationRef` staleness guard). Also already passed, no production change.
5. `packages/db/test/reports.int.test.ts` — `listOpenForStaff` describe block:
   - Renamed/rewrote the old `'a stored row with an unknown category is integrity, never
     returned'` test to `'...is skipped, not thrown for the whole batch'`, now asserting
     `listOpenForStaff` returns `[]` instead of throwing.
   - Added `'one bad row drops out of the queue; a normal row alongside it still returns'`: one
     unknown-category row plus one normal `other`-category row; asserts only the normal row comes
     back.

No change to `apps/web/app/staff/reports/report-row.tsx` / `view.tsx`, `takedowns.ts`,
`safety-alerts.ts`, or any migration, matching "Files out of bounds".

## Red-then-green evidence

**`packages/db/test/reports.int.test.ts` (listOpenForStaff, unknown-category rows), red** (production
fix temporarily reverted via a scoped `git stash`, same test file):
```
FAIL  test/reports.int.test.ts > reports on Postgres > listOpenForStaff >
  a stored row with an unknown category is skipped, not thrown for the whole batch
FAIL  test/reports.int.test.ts > reports on Postgres > listOpenForStaff >
  one bad row drops out of the queue; a normal row alongside it still returns
RepositoryError: reports.listOpenForStaff: integrity
 ❯ checked src/repositories/map.ts:28:25
 ❯ toStaffReportRow src/repositories/map.ts:508:10
```

**Green, after reapplying the fix:**
```
Test Files  1 passed (1)
     Tests  16 passed (16)
```

**`apps/web/app/staff/reports/view.test.tsx` (javascript: link + lift stale-poll tests)** — both
already passed against the current `view.tsx` on first run, confirming the review's "the code is
already safe" note; no production change made, per the plan's instruction for A.4:
```
Test Files  1 passed (1)
     Tests  38 passed (38)
```

## Decisions

### 27 Oct 2026 · 12.2f Phase A skip-row catch has no "unexpected error" branch · decided by builder · risk: low
- Decided: the `catch` around each row's `toStaffReportRow(...)` call swallows any thrown error
  unconditionally (no `instanceof RepositoryError && kind === 'integrity'` check, no re-throw
  branch), with a comment explaining why: `toStaffReportRow`'s only throw site (`map.ts`'s
  `checked` helper) only ever throws `RepositoryError('integrity', ...)`, so a conditional re-throw
  branch would be dead code that `@edmate/db`'s 100%-branch coverage threshold on
  `src/repositories/**` cannot pass without an artificial test for an unreachable path.
- Why: the plan's design text said "wrap ... and skip (don't push) a row that throws `integrity`",
  which read literally as "only skip when the kind is `integrity`, else propagate" — that version
  typechecked and matched all of this phase's tests, but its unreachable rethrow branch failed the
  package's existing coverage gate (`ERROR: Coverage for statements (99.96%) does not meet
  "src/repositories/**" threshold (100%)`), a repository-wide rule the plan did not call out and
  this task's scope does not permit relaxing. Catching unconditionally reaches the same practical
  behaviour (the plan names no other throw kind this call site can produce) while keeping the
  package green; the comment makes the "why no check" visible to the next reader.

### 27 Oct 2026 · 12.2f risky-path reviewers (Phase A) · decided by lead/plan, logged by builder · risk: high
- Decided: Phase A touches `packages/db/src/repositories/reports.ts` (risky path
  `packages/db/src/repositories/**`) and `apps/web/app/api/staff/reports/handlers.ts` /
  `apps/web/app/api/staff/takedowns/handlers.ts` (risky path `apps/web/app/api/staff/**`); both
  require **security-reviewer** (code-reviewer always required) per
  `.claude/skills/merge-gate/risk-paths.txt`, as the plan's "Risky paths touched" section already
  states.
- Why: standing rule (non-negotiable 6 / 8) — logging it here so the merge gate finds the required
  `risk: high` decision for these paths.

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm --filter @edmate/db run test` —
  **84 test files, 1785 passed, 4 skipped (pre-existing, unrelated)**, no db int test skipped;
  coverage thresholds (including 100% on `src/repositories/**`) pass.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web` —
  typecheck and lint both pass for both packages (0 errors; 2 pre-existing warnings in an untouched
  file, `apps/web/test/lighthouse-a11y.test.ts`). The combined test run surfaced one unrelated
  flaky failure, `apps/web/src/auth/index.guard-only.test.ts` (`Test timed out in 20000ms`, a file
  this phase never touches); re-run alone it passes (`1 passed`), confirming flakiness, not a
  regression from this change. All `@edmate/web` tests besides that one timeout passed: **171 of
  172 files, 2687 of 2688 tests** in the combined run.
- `corepack pnpm exec prettier --check` on the five changed files — all pass.
- `python3 .githooks/secret-scan.py --all` — clean, no output.

## Budget

Phase A tool calls used: 58

## Phase B

Phase B status: DONE

### Summary

`apps/web/app/api/sessions/[id]/reports/handlers.ts` — `createSessionReportsHandlers`'s `file`
handler now pages the existing staff alert inbox (12.5's `safetyAlerts.record`) on a genuinely new
report (`reports.file`'s `{ created: true }`), in addition to the `/staff/reports` queue (12.2e):

- `SessionReportsBackend.repos()`'s return type widens from `Pick<Repositories, 'reports'>` to
  `Pick<Repositories, 'reports' | 'safetyAlerts'>`. The one runtime wiring site,
  `apps/web/app/api/sessions/[id]/reports/route.ts`, already passes `serverDatabase().repos` (the
  full `Repositories` object) — confirmed by grep before editing; no other file needed a change.
- A new local helper `reportAlertId(reportId)` derives the alert row id deterministically from the
  report id (`createHash('sha256').update('report-alert\0' + reportId).digest('hex')`, prefixed
  `ra_`), the same shape as `reports.ts`'s `reportRowId` but with a different domain tag
  (`report-alert` vs. `reportRowId`'s message-target tag), so it can never collide with a report
  id. Deterministic means a retried or replayed report never double-records — `safetyAlerts.record`
  is already `on conflict (id) do nothing`.
- On `created: true`, the handler calls `backend.repos().safetyAlerts.record({...})` with
  `level: 'info'`, `kind: 'other'` (lead answer Q2), `studentId`/`teacherId`/`sessionId` taken
  straight from the already-validated `scope` and `path.data.id` (no new lookup), and
  `excerptRedacted` a fixed, non-PII string built only from the closed-set category:
  `` `A student reported a ${category} reply.` ``. `category` is always one of the five fixed
  `REPORT_CATEGORIES` enum values (never free text), so this string can never leak the reported
  message's text or the reporter's identity.
- The write is wrapped in its own `try/catch`: a failure there is logged by event name and error
  name only (`sessions.reports.alert_failed`), and never changes the response — `{ ok: true }`
  still reflects the report write, which already succeeded.
- No escalation/re-page wiring (lead answer Q1); no change to `apps/worker/src/alerts/**`,
  `packages/queue/**`, `apps/web/app/staff/alerts/**`, `packages/db/src/repositories/safety-alerts.ts`
  or `packages/contracts/src/safety.ts` (the existing `other`/`info` values are reused, no new type).

`apps/web/app/api/sessions/[id]/reports/route.test.ts` — the memory backend now carries a mocked
`safetyAlerts.record`; three new cases:

1. a new report (`created: true`) calls `safetyAlerts.record` once with the expected `level`,
   `kind`, the scope's own ids and the fixed excerpt string;
2. a duplicate report (`created: false`) does not call it a second time;
3. a `safetyAlerts.record` rejection still returns `201` / `{ ok: true }` (the report's own
   success), logging only `sessions.reports.alert_failed` and the error's name.

Two existing tests that stub `repos()` with a bare `{ reports: { file } }` cast needed the cast's
type widened to include a stubbed `safetyAlerts.record` (the "default logger" test and the memory
helper) so the handler's new call has something to call; no behaviour in those tests changed.

### Red-then-green evidence

Red (scoped `git stash push -u -- apps/web/app/api/sessions/*/reports/handlers.ts`, same test
file, then `vitest run`):

```
❯ app/api/sessions/[id]/reports/route.test.ts (32 tests | 2 failed)
  × a new report also pages the trust inbox with a fixed, non-PII excerpt
    AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
  × a safetyAlerts.record failure still returns the report success and logs only the error name
    AssertionError: expected [] to deeply equal [ { event: 'sessions.reports.alert_failed', ... } ]
Test Files  1 failed (1)
     Tests  2 failed | 30 passed (32)
```

Green (`git stash apply` + `git stash drop` to restore the handler change, re-run):

```
Test Files  1 passed (1)
     Tests  32 passed (32)
```

### Decisions

### 27 Oct 2026 · 12.2f Phase B alert id domain tag · decided by builder · risk: low
- Decided: the staff-alert row id for a filed report is `ra_<sha256("report-alert\0" + reportId)
  first 40 hex chars>`, a local helper (`reportAlertId`) in `handlers.ts`, not a new export from
  `@edmate/db`'s `reports.ts`.
- Why: the plan asked for "a different domain tag" from `reportRowId` so the two id spaces can
  never collide, but did not say where the helper should live. Keeping it local to the one call
  site that needs it (this handler) avoids widening `packages/db`'s public surface for a
  single-caller id scheme; `reports.ts`'s own `reportRowId` stays untouched (out of bounds for this
  phase per the plan's "Files out of bounds").

### Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/web` —
  10 of 10 tasks successful (typecheck, lint, test for `@edmate/web` and its dependents).
- `./node_modules/.bin/prettier --check apps/web/app/api/sessions/[id]/reports/handlers.ts apps/web/app/api/sessions/[id]/reports/route.test.ts` —
  all matched files use Prettier code style (ran via a glob to avoid the bracket-path shell guard;
  one formatting fix applied to `route.test.ts` before this passed).
- `python3 .githooks/secret-scan.py --all` — clean, no output.

### Budget

Phase B tool calls used: 29

## Phase C

Phase C status: DONE

### Summary

Extends the "Removed by Edmate staff" fact (already computed for the staff report query's
`citedDocuments`) to the teacher's own upload centre, end to end, read-only:

- `packages/db/src/repositories/map.ts` — `DocumentRowSchema` gains `takenDown: z.boolean()` (not
  optional: a document is never ambiguously taken down); `toDocumentRow`'s input type and build
  both carry it through.
- `packages/db/src/repositories/chunks.ts` — `documentColumns` (the one column map shared by both
  `documents.get` and `documents.listForTeacher`, confirmed as the only two `toDocumentRow(...)`
  call sites) adds `takenDown` using the existing `notTakenDown` import, the same expression
  `reports.ts`'s staff query already uses: `` sql<boolean>`not ${notTakenDown(documents.id)}`.mapWith(Boolean) ``.
- `apps/web/src/studio/routes.ts` — `view(row: DocumentRow)` (the upload centre's GET shape) adds
  `takenDown: row.takenDown`.
- `apps/web/src/studio/uploadClient.ts` — `DocumentView` adds `takenDown: boolean`.
- `apps/web/app/teacher/uploads/UploadsView.tsx` — each document row shows a
  `uploads.takenDownBadge` ("Removed by Edmate staff") span when `d.takenDown`, alongside (not
  replacing) its existing `status.${d.status}` text.
- `apps/web/messages/en.json` — one new key, `uploads.takenDownBadge`, appended inside the existing
  `uploads` block (verified the diff adds only this key).

Two test-fixture-only fixes outside the plan's listed files, needed for the gate to type-check
(both are plain object literals of `DocumentRow`/`DocumentView` that needed the new required
field, no behaviour assertions changed):
- `packages/db/test/documents.int.test.ts` — the one `toEqual<DocumentRow>(...)` literal gains
  `takenDown: false`.
- `apps/web/app/teacher/live-classes/LiveClassesView.test.tsx` — the local `view(over)` factory's
  default object gains `takenDown: false`.

### Red-then-green evidence

**`packages/db/test/repositories.int.test.ts`** — new test `'documents.get and listForTeacher
carry takenDown: false until an active takedown, true while active, false once lifted'`. Red
(before the `map.ts`/`chunks.ts` production change):
```
AssertionError: expected undefined to be false // Object.is equality
 ❯ test/repositories.int.test.ts:4915:33
```
Green, after the fix:
```
Test Files  1 passed (1)
     Tests  1 passed | 189 skipped (190)
```

**`apps/web/src/studio/routes.test.ts`** — new test `'carries takenDown through from the
repository row (task 12.2f Phase C)'`. Red (routes.ts's `view()` change stashed out):
```
- Expected
+ Received
  {
    "id": "doc_1",
-   "takenDown": true,
  }
```
Green, after reapplying:
```
Test Files  1 passed (1)
     Tests  80 passed (80)
```

**`apps/web/app/teacher/uploads/UploadsView.test.tsx`** — new test `'shows a "Removed by Edmate
staff" badge only for a taken-down document, alongside its status (task 12.2f Phase C)'`. Red
(`UploadsView.tsx` and `en.json` changes stashed out):
```
Error: expect(element).toHaveTextContent()
Expected element to have text content:
  Removed by Edmate staff
Received:
  Algebra notes.pdfReadyReplaceDelete
```
Green, after reapplying:
```
Test Files  3 passed (3)
     Tests  134 passed (134)
```
(ran together with `routes.test.ts` and `LiveClassesView.test.tsx`, all green)

### Decisions

### 27 Oct 2026 · 12.2f Phase C two extra test-fixture fixes · decided by builder · risk: low
- Decided: `packages/db/test/documents.int.test.ts` (one `toEqual<DocumentRow>` literal) and
  `apps/web/app/teacher/live-classes/LiveClassesView.test.tsx` (one `DocumentView` factory
  default) each needed `takenDown: false` added to a plain fixture literal once the field became
  required; both are outside the plan's "Files to create/modify" list but are type-only, no new
  assertion and no production-file change, so this stays a fixture fix, not scope creep per the
  plan's exit condition about files turning up outside the list.
- Why: `DocumentRowSchema`/`DocumentView` making `takenDown` a required (not optional) field,
  exactly as the plan specified ("not optional -- a document is never ambiguously taken-down"),
  means every existing literal of that shape across the whole workspace must supply it; `tsc
  --noEmit` surfaced these two during the gate run, and both were one-line, no-behaviour-change
  fixes.

### 27 Oct 2026 · 12.2f risky-path reviewers (Phase C) · decided by lead/plan, logged by builder · risk: high
- Decided: Phase C touches `packages/db/src/repositories/map.ts` and `chunks.ts` (risky path
  `packages/db/src/repositories/**`), which requires **security-reviewer** (code-reviewer always
  required) per `.claude/skills/merge-gate/risk-paths.txt`, as the plan's "Risky paths touched"
  section already states. The `apps/web/src/studio/**` and `apps/web/messages/en.json` files
  touched match no risk-paths.txt glob.
- Why: standing rule (non-negotiable 6 / 8) — logging it here so the merge gate finds the required
  `risk: high` decision for this path.

### Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
  typecheck lint test --filter=@edmate/db --filter=@edmate/web` — **13 of 13 tasks successful**
  (typecheck, lint, test for both packages and their shared deps). `@edmate/db` test: 100% branch/
  statement/function/line coverage on `src/repositories/**` (the package threshold). `@edmate/web`
  test: 170 test files passed, 2683 tests passed, 11 skipped (the same pre-existing skips, no new
  ones). The known-flaky `src/auth/index.guard-only.test.ts` passed on this run (8538ms, no
  re-run needed); an earlier run (with a second gate invocation racing the same test Postgres
  concurrently, now known to be the cause) showed two unrelated int-test failures from that DB
  contention, not from this change -- the clean single run above is the one that counts.
- `corepack pnpm exec prettier --check` then `--write` then `--check` again on every file this
  phase touched — clean (five files needed a `--write` pass for consistent formatting; re-run
  after confirmed `All matched files use Prettier code style!`, and the affected test files were
  re-run green after the formatting pass).
- `python3 .githooks/secret-scan.py --all` — clean, no output.

### Budget

Phase C tool calls used: 44

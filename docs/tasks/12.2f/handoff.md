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

## Phase D

Phase D status: DONE

### Summary

Adds a persistent "Removed by Edmate staff" banner to the teacher's publish page, visible on page
load whenever their agent is suspended -- with no action (no gate run, no start attempt) needed.

- `apps/web/src/studio/publish.ts` -- `PublishBackend.repos` gains `agents: Pick<Repositories['agents'],
  'get'>` (no new repository method). The `latest` `Work` function (the route backing the client's
  `loadLatestRun`): when `publish.latestRun` returns a run, it also calls `repos.agents.get(scope,
  run.agentId)` and returns `agentStatus` (`agent?.status ?? 'draft'`) as a field alongside `run` in
  the JSON body. When there is no run yet (`{ run: null }`), the reply is left exactly as before --
  an agent that has never had a publish run can never be `suspended` (an agent takedown sets
  `suspended` only on a `live` agent, confirmed in `takedowns.ts`'s header comment: every
  student-facing read requires `live`), so there is nothing to look up and no extra query on that
  path.
- `apps/web/src/studio/publishClient.ts` -- `loadLatestRun`'s resolved value widens from
  `PublishRun | null` to a new `LatestLoad` interface: `{ run: PublishRun | null; agentStatus:
  AgentStatus | null }` (`AgentStatus = 'draft' | 'live' | 'suspended'`). The server's `agentStatus`
  field is optional in the parse schema (absent on the no-run path) and defaults to `null` client-side.
- `apps/web/app/teacher/publish/PublishView.tsx` -- a new `suspended` boolean state, set from
  `agentStatus === 'suspended'` on every load/poll; renders `<p role="alert">{t('suspendedBanner')}</p>`
  whenever true, additive to (not replacing) the existing `idle`/`RunDetails` rendering and the
  existing `suspended` entries in `RUN_ERROR_KEYS`/`START_ERROR_KEYS` (those stay for a failed
  run/start attempt; this banner is the new standing notice).
- `apps/web/messages/en.json` -- one new key, `publish.suspendedBanner`, value `"Removed by Edmate
  staff"` (lead answer Q3: identical wording to Phase C's document badge), appended inside the
  existing `publish` block (verified the diff adds only this one key).

### Red-then-green evidence

Red (`git stash push -u` on `publish.ts`, `publishClient.ts`, `PublishView.tsx` and `en.json` only,
test files kept, then `vitest run`):

`src/studio/publish.test.ts`:
```
 FAIL  GET /api/studio/publish > a running run has no failed cases and is not asked for them
   expected [ 'publish.latestRun', 'publish.changedSinceLastPublish' ] to deeply equal
   [ ..., 'agents.get' ]
 FAIL  GET /api/studio/publish > carries the agent status (task 12.2f Phase D): live by default, suspended after a takedown
   AssertionError: expected undefined to be 'live'
 FAIL  GET /api/studio/publish > an error run carries its code; a passed run its scorecard and published time
   expected [...] to deeply equal [ ..., 'agents.get' ]
Test Files  1 failed (1)
     Tests  3 failed | 27 passed (30)
```

`src/studio/publishClient.test.ts`:
```
 FAIL  loadLatestRun parses a well-formed run and its agent status
   - Expected: { ok: true, value: { agentStatus: 'live', run: {...} } }
   + Received: { ok: true, value: {...run fields, no wrapper...} }
 FAIL  loadLatestRun defaults agentStatus to null when the server omits it (no run yet)
   - Expected: { ok: true, value: { run: null, agentStatus: null } }
   + Received: { ok: true, value: null }
```

`app/teacher/publish/PublishView.test.tsx`:
```
 FAIL  task 12.2f Phase D: a suspended agent shows a standing badge with no run or start attempt
   TestingLibraryElementError: Unable to find role="alert"
Test Files  3 failed (3)
     Tests  3 failed | 40 passed (43)
```

Green (`git stash apply` + `git stash drop`, re-run all three together):
```
Test Files  3 passed (3)
     Tests  73 passed (73)
```

### Decisions

### 27 Oct 2026 · 12.2f Phase D agentStatus placement and no-run path · decided by builder · risk: low
- Decided: `agentStatus` is a top-level field of the `GET /api/studio/publish` JSON body, sibling
  to `run` (not nested inside the `PublishRunView`/`run` object), and is **only computed and
  returned when a run already exists** (`run !== null`); the `{ run: null }` no-run reply is
  unchanged, with no `agents.get` call on that path. Client-side, `loadLatestRun`'s resolved value
  becomes `{ run, agentStatus }` (`agentStatus: null` when the server omitted it).
- Why: the plan's wording ("add `agentStatus` ... alongside the existing run fields" /
  "`PublishRun`-adjacent load result type") was read literally as a field next to `run`, not inside
  it, matching publishClient.ts's own file header lesson ("loose objects so an extra server field
  never breaks the page" -- a sibling field, not a nested one, keeps `PublishRun`'s own shape
  untouched for every other caller). Skipping the lookup on the no-run path is a real behaviour
  choice the plan didn't spell out for that branch: an agent takedown only ever sets `suspended` on
  a `live` agent (confirmed in `takedowns.ts`'s header comment -- every student-facing read already
  requires `live`), and a `live` agent can only exist after a passed publish run, so `run === null`
  implies the agent has never been anything but `draft` and can never be `suspended`; querying
  `agents.get` there would be a correct but needless extra read on the one path per request that
  already returns early.

### Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
  typecheck lint test --filter=@edmate/web` -- **9 of 10 tasks successful** (typecheck and lint for
  `@edmate/web` both cache-hit clean; `@edmate/web#test` failed). The failure is four pre-existing
  integration-test suites unrelated to any Phase D file --
  `app/api/staff/agents/route.int.test.ts`, `app/api/staff/verifications/route.int.test.ts`,
  `app/api/staff/alerts/route.int.test.ts`, `app/api/staff/reports/route.int.test.ts` -- all failing
  with `connect ECONNREFUSED 127.0.0.1:55432` / a failed `migrate.js` against that same port: the
  shared dev Postgres container (`edmate-postgres-1`) had exited partway through this session
  (confirmed via `docker ps -a`, not stopped by this builder; the brief's docker/psql restriction
  means it was not restarted here). All 167 other test files passed (2665 tests), including every
  Phase D file. Ran the three Phase D test files alone separately, green: `Test Files 3 passed (3)`,
  `Tests 73 passed (73)` (`src/studio/publish.test.ts`, `src/studio/publishClient.test.ts`,
  `app/teacher/publish/PublishView.test.tsx`).
- The known-flaky `src/auth/index.guard-only.test.ts` -- run alone, once: passed (1 passed, no
  re-run needed).
- `corepack pnpm exec prettier --check` then `--write` then `--check` again on every file this
  phase touched -- clean after one `--write` pass (five files needed formatting); the three
  Phase D test files re-run green after the formatting pass (see above).
- `python3 .githooks/secret-scan.py --all` -- clean, no output.

### Budget

Phase D tool calls used: 32

## Fix round 1

Fix for the typescript-reviewer HIGH on `apps/web/src/studio/publish.ts:180`: the `latest` route
returned `{ run: null }` on the no-run path before ever calling `agents.get`, so a teacher whose
agent was suspended while still a draft (an agent takedown, `takeDownAgentInTx`, sets `suspended`
on an agent of **any** status, not only `live`) never saw the standing "Removed by Edmate staff"
banner until their first publish run existed.

### What changed

- `apps/web/src/studio/publish.ts` -- the no-run branch of `latest` no longer returns early with no
  lookup. It now finds the teacher's own agent id the same way `start` already does, through
  `repos.packages.listForTeacher(scope)` (no new repository method), and calls `repos.agents.get`
  with that id. `{ run: null }` (no `agentStatus` field, matching the original shape) is returned
  only when the teacher has no packages yet -- there is no agent to look up. Otherwise the reply is
  `{ run: null, agentStatus }` (`agent?.status ?? 'draft'`), the same shape the run-exists branch
  already returns. A new `teacherAgentId` helper holds the shared lookup.
- `apps/web/src/studio/publish.test.ts` -- the existing "no run yet" test now covers the true
  no-agent case (`rows: []`) and asserts no `agents.get` call; two new `it.each` cases cover a
  no-run teacher whose agent is `suspended` and one whose agent is `draft`, each asserting
  `agentStatus` round-trips and `packages.listForTeacher` + `agents.get` are both called.
- `apps/web/src/studio/publishClient.ts` -- only the doc comment on `LatestLoad` changed (no type
  or logic change -- `agentStatus` was already optional/nullable on the client, and already handled
  a present-or-absent field on every path); the old wording claimed the no-run path could "never"
  be suspended, which was the wrong premise this fix round corrects.

### Red-then-green evidence

Red (`git stash` on `publish.ts` and `publishClient.ts` only, test file kept, `vitest run
src/studio/publish.test.ts`):
```
 FAIL  GET /api/studio/publish > no run yet and no packages (no agent to look up) is {run: null}, no agents.get call
   expected [ 'publish.latestRun' ] to deeply equal [ 'publish.latestRun', 'packages.listForTeacher' ]
 FAIL  GET /api/studio/publish > no run yet but a suspended agent ... carries agentStatus suspended
   expected { run: null } to deeply equal { run: null, agentStatus: 'suspended' }
 FAIL  GET /api/studio/publish > no run yet but a draft agent ... carries agentStatus draft
   expected { run: null } to deeply equal { run: null, agentStatus: 'draft' }
Test Files  1 failed (1)
     Tests  3 failed | 29 passed (32)
```

Green (fix restored, same two files + `publish.test.ts`, run together with `publishClient.test.ts`):
```
Test Files  2 passed (2)
     Tests  39 passed (39)
```

### Decisions

### 27 Oct 2026 · 12.2f agentStatus on the no-run path · decided by builder · risk: low
- Decided: `GET /api/studio/publish`'s no-run path now looks up the teacher's agent (via
  `packages.listForTeacher` + `agents.get`) and returns `agentStatus` there too, exactly as the
  run-exists path already does, except when the teacher has no packages yet (no agent exists to
  look up -- `{ run: null }` with no `agentStatus` field, unchanged from before).
- Why: the Phase D decision's premise -- "an agent takedown sets `suspended` only on a `live`
  agent ... so `run === null` implies the agent can never be `suspended`" -- was wrong.
  `takeDownAgentInTx` (`packages/db/src/repositories/takedowns.ts`) updates `agents.status` to
  `suspended` unconditionally, regardless of the agent's current status; a draft agent (one that
  has never had a publish run) can be taken down just as a live one can. Skipping the lookup on the
  no-run path therefore hid a real "removed by staff" state from the teacher. The extra read this
  adds is one `packages.listForTeacher` + one `agents.get` call on the single path per request that
  used to return early with no reads at all -- the same cost the `start` handler already pays on
  every call.

### Gate

- `corepack pnpm exec prettier --check` on `publish.ts`, `publish.test.ts`, `publishClient.ts` and
  this handoff -- clean, no reformatting needed.
- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
  typecheck lint test --filter=@edmate/web` -- **10 of 10 tasks successful** in one run (dev
  Postgres was up this round, unlike Phase D's). No separate re-run of the flaky
  `src/auth/index.guard-only.test.ts` was needed -- it passed inside this single green run.
- `python3 .githooks/secret-scan.py --all` -- clean, no output.

### Budget

Fix round tool calls used: 19

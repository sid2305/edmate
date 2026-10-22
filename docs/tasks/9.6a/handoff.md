# Handoff: 9.6a — paged export readers (`sessions.listForStudent`, `messages.listForStudent`)

## Summary
Added two new student-scope repository readers for task 9.6 Phase A, so a later complete export
(9.6b) can page through everything Edmate keeps for a pair without a 200-row cap:
- `sessions.listForStudent(scope, { after?, limit })`: every one of the scope's own sessions
  (open and ended), oldest first by `(createdAt, id)`. Shape is `{ id, agentId, agentVersion,
  packageId, packageVersion, summary, createdAt, endedAt }` — `help_state` and `studentId`/
  `teacherId` are never in the result.
- `messages.listForStudent(scope, { after?, limit })`: every message of every one of the scope's
  own sessions, oldest first by `(createdAt, id)`, each tagged with its `sessionId`. Joins
  `sessions` on the pair (the same ownership predicate `ownSession` already checks one session at
  a time) and reuses `toMessage`.

Both share a keyset cursor schema `{ createdAt: iso, id: IdSchema }` and `EXPORT_PAGE_MAX = 500`
(module-local exports of `sessions.ts`; `messages.ts` imports them from there rather than
redefining them). `limit` 0 or 501 is `invalid`; a malformed cursor (bad id format or a
non-ISO `createdAt`) is `invalid`. `next` is the cursor of the last row of the page, or `null` on
the last page.

`packages/db/src/repositories/index.ts` was not touched: `RepositoryMethod` is a mapped type over
`Repositories`, so it picked up both new methods automatically, and the int test's "has a case for
exactly the methods" check confirms it. `EXPORT_PAGE_MAX` is imported by the int test directly from
`../src/repositories/sessions.js` (a module-local export, not re-exported through the barrel), per
the plan.

## Files
- `packages/db/src/repositories/sessions.ts`: `ExportCursorSchema`/`ExportCursor`,
  `EXPORT_PAGE_MAX`, `ExportListOptions`, `SessionExportRow`, `sessionsRepo().listForStudent`.
- `packages/db/src/repositories/messages.ts`: `MessageExportRow`, `messagesRepo().listForStudent`
  (imports the cursor schema and `EXPORT_PAGE_MAX` from `sessions.ts`).
- `packages/db/test/repositories.int.test.ts`: two new `CASES` entries (isolation grid, one per
  method, `targeted: false`, own-pair-only); two dedicated paging tests (`sessions.listForStudent
  pages oldest first, stable across a created_at tie, and rejects bad input`, `messages
  .listForStudent pages every message of every own session, stable across a created_at tie`)
  covering the 5-row/page-size-2/tie-across-boundary case, `next === null` on the last page, the
  exact key set (no `helpState`), and invalid `limit`/`after`.
- `packages/db/test/leak.test.ts`: both new methods added to the scrubbed-driver-error list.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` — green (62 test files,
  1106 passed, 4 skipped; coverage 100% on `sessions.ts` and `messages.ts`, 100% overall for
  `src/repositories`).
- The packages/db int suite ran against a disposable Postgres container (`docker compose -f
  docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`, port 55432, started
  and stopped by this builder; the running `edmate-*` containers were untouched), not skipped.
- `python3 .githooks/secret-scan.py --all` — clean.

## Decisions

### 22 Oct 2026 · 9.6a export readers on the repositories path (no help_state, pair-scoped, keyset paged) · decided by builder · risk: high
- Decided: `sessions.listForStudent` and `messages.listForStudent` are new student-scope readers.
  They never select `help_state` (the only place the answer key is stored, ADR-0005), they are
  scoped by `(studentId, teacherId)` exactly like every other reader in these two files (and, for
  messages, joined through `sessions` the same way `ownSession` checks one session), and they page
  with a `(createdAt, id)` keyset cursor validated by a strict zod schema before any SQL runs (a
  malformed cursor is `invalid`, never a query). The isolation grid (`repositories.int.test.ts`)
  runs both methods through the full actor x target matrix and confirms another pair's rows never
  appear, even on a shared timestamp; `leak.test.ts` confirms a driver failure never leaks ids or
  text.
- Why: this is the risky `packages/db/src/repositories/**` path (access / money / data isolation
  group per `risk-paths.txt`), and it is the first reader of its kind (keyset-paged, no 200-row
  cap) — worth a high-risk entry on its own even though it adds no write path.
- risk: high

### 22 Oct 2026 · 9.6a cursor is a structured object, not an opaque token · decided by builder · risk: low
- Decided: `after` is the literal `{ createdAt, id }` object the plan's "Tests first" section
  names, validated by a strict zod schema (`ExportCursorSchema`), not a base64/opaque string.
- Why: the plan spelled out the exact cursor schema, and a caller (9.6b's `buildExport`) already
  has the previous page's last row to build the next `after` from — no encoding step earns its
  keep here, and a strict schema makes "malformed cursor" trivial to define and test.
- risk: low

### 22 Oct 2026 · 9.6a owner markers for the isolation grid come from row content, not scope columns · decided by builder · risk: low
- Decided: `sessions.listForStudent`'s isolation case derives its owner marker from `summary`
  (present on every pair's base seeded session) and `messages.listForStudent`'s from `text`
  (present on every message, seeded or appended) — neither return shape carries `studentId`/
  `teacherId`, unlike `sessions.get`'s full `SessionRow`. The grid's "greater than 0 markers, set
  equals exactly `{actor}`" check still holds: every row that does carry a marker must be the
  actor's own (a leaked row would contribute a different marker and fail), and at least one row
  in scope always does.
- Why: the plan deliberately strips the returned shape down for export (no scope columns, no
  `helpState`), so the grid's owner-detection has to use what content remains instead of a shape
  that doesn't exist for these two methods.
- risk: low

## Left to do
None — Phase A is complete per the plan's exit conditions.

Status: DONE
Tool calls used: 44

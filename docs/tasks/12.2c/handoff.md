# 12.2c: Report button in the chat and POST /api/sessions/[id]/reports

## Summary
Students can now report an agent or teacher reply directly in the chat. `ReportButton` (closed
"Report" button -> category radio group with Send/Cancel) posts to the new
`POST /api/sessions/:id/reports`, which builds the student's scope with `studentTurnScope`
(imported, not edited) from the body's `agentId`, then calls `reports.file` (12.2a) with the
URL's session id and the body's `messageId`/`category`. A report on an agent that is not live, a
session or message that isn't the student's own, or a non-reply message is `not_found`; a second
report on the same message is still `{ ok: true }` (12.2 design: idempotent, no error on a
duplicate). The button renders under any agent/teacher message that already has a server message
id (history items, and a turn once its `done` event carries `messageId`); it disables itself for
that message after a successful send and shows "Thanks, our team will review this."

## Files
- `apps/web/app/api/sessions/[id]/reports/handlers.ts` (new) — `createSessionReportsHandlers`:
  strict body `{ agentId, messageId, category }`, params `{ id }`, repository errors mapped to
  fixed codes (`not_found` 404, `invalid`/`integrity` 400, `scope` 403, else 500), `no-store`.
- `apps/web/app/api/sessions/[id]/reports/route.ts` (new) — wraps in `withRole(['student'])`
  (ROUTE_POLICY `/api/sessions/**` already covers it); wires `serverDatabase()`.
- `apps/web/app/api/sessions/[id]/reports/route.test.ts` (new) — memory agents+reports backend (no
  database); validation, not-own-session, not-a-reply, duplicate-is-ok, every `RepositoryError`
  kind's status code, malformed/oversize body, the real guard + ROUTE_POLICY (401/403/201, CSRF).
- `apps/web/src/chat/ReportButton.tsx` (new) — closed/open/busy/done states; renders nothing
  without a session id.
- `apps/web/src/chat/ReportButton.test.tsx` (new) — jest-axe clean closed and open; Send disabled
  until a category is chosen; busy disables the fieldset and Send; success shows "thanks" and
  removes the form for good; a repository error or a rejected promise shows fixed text and reopens
  the form; Cancel discards without sending.
- `apps/web/src/chat/reportMessage.ts` (new) — the browser POST; `REPORT_CATEGORIES` is duplicated
  here (not imported from `@edmate/db`) so this client bundle never pulls in the server-only db
  package; mirrors `sendTurn.ts`'s `FetchLike`/try-catch/safeParse shape.
- `apps/web/src/chat/reportMessage.test.ts` (new) — path/body/headers, 200 and 201 both `{ ok:
  true }`, non-2xx through `responseError`, network failure and bad-shape replies are
  `provider_error`, session id is URL-encoded.
- `apps/web/src/chat/ChatView.tsx` (edit) — imports `ReportButton`; a new `reportableId(message,
  turn?)` helper (null for a student message, the history item's own id, or the turn's
  `messageId`); renders the button after `SourcesList`/`TurnExtras` in thread items and after the
  current final turn's `TurnExtras`. No other change.
- `apps/web/app/learn/[agentId]/page.tsx` (edit) — one line: `messages={{ chat: messages.chat,
  report: messages.report }}`.
- `apps/web/messages/en.json` (shared, append-only) — one top-level `report` block (button,
  categoryLabel, categories.*, send, sending, cancel, thanks) appended after `liveClassesStudio`.
  Nothing else reformatted.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — green. 34/34 tasks
  successful; `@edmate/web:test` included the new suites (`route.test.ts` 29 tests, `ReportButton.test.tsx`
  7 tests, `reportMessage.test.ts` 7 tests) plus the full existing suite (`ChatView.test.tsx` 26
  tests still green, unaffected by the added button). Coverage thresholds (80% lines/branches
  globally) passed with the run; no threshold failure was reported.
- `python3 .githooks/secret-scan.py --all` — clean, no output.
- One unrelated flake seen on an earlier run of the same gate: `src/turn/runtime.test.ts`'s dev-model
  test timed out once; it passed cleanly on the next run included in the green evidence above (not
  a file this task touches).

## Decisions

### 22 Oct 2026 · 12.2c Report button renders on both the thread-pushed reply and the live final turn · decided by builder · risk: low
- Decided: `ReportButton` is shown both when a finished turn becomes a thread item (on the next
  submit) and on the still-current final turn shown separately before that (same `TurnExtras`
  block, lines ~256-262 of ChatView.tsx), each time the turn's `messageId` is not null.
- Why: the plan's "finished turns with a messageId" covers both states; without the second spot a
  student could not report the very last reply until they sent another message, which would make
  the "reaches staff fast" acceptance path depend on an unrelated user action.
- risk: low (chat/ChatView.tsx, not a risky path; no server behaviour change, UI only).

### 22 Oct 2026 · 12.2c REPORT_CATEGORIES is duplicated in the client bundle, not imported from @edmate/db · decided by builder · risk: low
- Decided: `apps/web/src/chat/reportMessage.ts` defines its own `REPORT_CATEGORIES` tuple
  (identical values to `packages/db/src/repositories/map.ts`) instead of importing the value from
  `@edmate/db`.
- Why: `ReportButton`/`reportMessage.ts` run in the browser (`'use client'` tree); `@edmate/db` is
  a server-only package (pg driver, schema). A type-only import is erased at build time and would
  be safe, but importing the actual array value risks pulling the whole db package into the client
  bundle. The server-side route (`handlers.ts`) still imports the real `ReportCategorySchema` from
  `@edmate/db` for validation, so the two lists can drift only if a category is added without
  updating this file; a future task should cross-check them (e.g. a shared-constant or contracts
  export) rather than leave the duplication silent.
- risk: low (apps/web/src/chat/**, not a risky path).

## Left to do
None for this phase. Follow-ups already tracked in the parent plan (12.2 Q7 teacher badge, 12.2f
trust-inbox paging) are unaffected by this slice.

Status: DONE

Tool calls used: 62

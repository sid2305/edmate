# 12.2e handoff: /staff/reports page

## Summary
Added the staff-only `/staff/reports` console: the open report queue (12.2a, via 12.2d's
`/api/staff/reports`) and the active-takedowns list (12.2b, via 12.2d's `/api/staff/takedowns`),
rendered in one page. Each report shows its category, when it was reported, the teacher's slug,
the reported reply (through `renderReply`, React text nodes only, same as the chat itself — never
the reporter's id, name or email, which 12.2a never sends) and its cited documents. Three actions
need a confirm step before they run: Dismiss, "take down this document" (one button per cited
document not already taken down) and "take down this agent" (hidden when the report has no
agent id); a takedown is linked to its report (`reportId`), so the server closes the report
`actioned` and the row drops out of the queue on success. The active-takedowns list has a plain
Lift button (no confirm — lifting restores material, it doesn't remove it). The console polls
every 60 s (`pollMs`, default `60_000`), paused while any action is in flight, and announces the
open-report count in an `aria-live="polite"` region, so an open console shows a new report well
under the 5-minute acceptance. Every action follows the "trust neither, reset everything" lesson:
try/catch around the body read (`client.ts` never rejects), a `finally` that clears the one busy
flag, and the initial server read is still `safeParse`d client-side (a wrong shape or a failed
server read is the fallback view, recoverable with Reload).

## Files
- `apps/web/app/staff/reports/client.ts` (new) — browser side of `/api/staff/reports` and
  `/api/staff/takedowns`; mirrors `REPORT_CATEGORIES`/`TAKEDOWN_KINDS` as local literals so this
  client never imports `@edmate/db` at runtime (only `@edmate/contracts`, already used client-side
  elsewhere for `ErrorCode`, `ChunkKindSchema`, `SourceRefSchema`).
- `apps/web/app/staff/reports/report-row.tsx` (new) — one report row: category, when, teacher
  slug, reported text, cited documents (each with its own take-down button/confirm, or a "Taken
  down" marker), Dismiss and "take down this agent" (each with its own confirm step).
- `apps/web/app/staff/reports/view.tsx` (new) — `StaffReportsView`: polling, aria-live count, one
  busy flag across reports and takedowns, the active-takedowns list with Lift.
- `apps/web/app/staff/reports/page.tsx` (new) — `requireRole(['staff'])` before any read; reads
  `reports.listOpenForStaff` and `takedowns.listActiveForStaff` for the session's own staff id;
  either failed read logs only the error's name and falls back to `null` (the view's fallback).
- `apps/web/app/staff/reports/client.test.ts`, `view.test.tsx`, `page.test.tsx` (new).
- `apps/web/app/staff/page.tsx` (shared, append-only): one nav entry to `/staff/reports`.
- `apps/web/messages/en.json` (shared, append-only): one top-level `staffReports` block appended
  at the end (verified the JSON diff is append-only, no reformatting of existing keys).

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — 34/34 tasks successful;
  `@edmate/web` test: 137 files passed (5 skipped, the gated int test, as expected without
  `TEST_DATABASE_URL`), 2041 tests passed (29 skipped). `apps/web/app/staff/reports` coverage:
  97.61% statements / 100% branches / 87.5% functions / 100% lines.
  - `client.test.ts` (25 tests): every call settles (network failure, unreadable JSON, wrong
    shape, non-2xx keeps the server's code); a reply naming a different report/takedown is
    `provider_error`; blank notes are omitted, real notes trimmed.
  - `view.test.tsx` (23 tests): lists a report with category/teacher/text; aria-live announces the
    open count; dismiss/document-takedown/agent-takedown each need a confirm step (cancel leaves
    the row, confirm commits and drops the row); an already-taken-down document shows a marker,
    not a button; no agent-takedown button when `agentId` is null; a gone message shows the
    fallback line; every error code maps to its message and re-enables the button; a thrown call
    still resets busy; Lift has no confirm and drops its row; manual reload recovers from an
    error and from a failed initial read; polling refreshes both lists on schedule, a poll failure
    after a good load is quiet, and polling pauses (no call lands) while an action is in flight;
    jest-axe clean across the full, fallback and empty views.
  - `page.test.tsx` (4 tests): guard runs first (no read when it refuses); reads both lists for
    the staff id; either failed read falls back to `null` and logs only the error name.
- `python3 .githooks/secret-scan.py --all` — clean (no output).

## Decisions

### 22 Oct 2026 · 12.2e staff reports page security review · decided by builder · risk: high
- Decided: `apps/web/app/staff/**` is treated as a risky path (the plan notes it is not yet a
  glob in merge-gate's risk-paths.txt, pending 12.1c); this PR needs `security-reviewer` to
  confirm the staff-only guard (`requireRole` before any read), that the reported text renders as
  React text nodes only (`renderReply`, never raw HTML), that every destructive action (Dismiss,
  both takedown kinds) requires its own confirm click before the network call, and that the
  reporter's identity (id, name, email) never reaches this page (12.2a's row shape already
  excludes it; this page and its tests never introduce a path that would add it back).
- Why: this is the console staff use to censor content and close reports; a missing confirm step
  or a guard regression would let a misclick or a non-staff session change live material, and a
  rendering mistake on the reported text would reopen the XSS surface the chat's own `renderReply`
  closed.
- risk: high

## Left to do
- None for Phase E's scope. The manual check from the plan (grant staff locally, file a report
  from the chat, open `/staff/reports`, take down the cited document, confirm a chat question on
  it now gets the "not covered" path) was not run here — it needs a running stack and is listed in
  the plan as the task's own closing check, not a Phase E file.
- Follow-ups already tracked as open questions, not Phase E gaps: paging the trust inbox on a new
  report (12.2f), a teacher-facing "Removed by Edmate staff" badge (12.2f).

Status: DONE
Tool calls used: 46

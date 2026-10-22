# 12.4d handoff: staff /staff/agents page and publish refusal text

## Summary

Phase D of task 12.4. Adds the `/staff/agents` console (subject select + Save, Approve/Revoke
with a confirm step, approved date shown) on top of the Phase C staff API (`handlers.ts`/`route.ts`,
already on main) and Phase B publish refusal (`publish.startRun`/`publish.goLive`, already on
main). Adds the `regulated_unapproved` key, using the plan's proposed teacher text verbatim, to
both publish error blocks in `en.json` and to `PublishView.tsx`'s error-key lists. Moves the
12.4b end-to-end assertion (an unapproved flagged agent refuses `publish.startRun`; after staff
approval it starts) from 12.4c into this task's `route.int.test.ts`, now that 12.4b is on main.

The page mirrors the `staff/alerts` (12.5c) and staff verification queue (12.1b) patterns:
server component (`page.tsx`) does `requireRole(['staff'])` before any database read, reads
`regulatedSubjects.listForStaff(principal.userId)`, maps rows with the existing `toAgentItem`
from the Phase C handlers, and renders the client view inside `AppShell` with only the
`staffAgents` message namespace passed to `NextIntlClientProvider`. The client view
(`view.tsx`) follows the "trust neither, reset everything" lesson: every server read and every
action is wrapped so a thrown call, a bad shape, or an error code always clears the busy flag
and shows a message, never leaves a button stuck.

No `packages/db`, `packages/contracts` or `policy.ts` edits were needed or made.

## Files

- `apps/web/app/staff/agents/client.ts` (new) — zod-validated fetch wrapper (`loadAgents`,
  `setSubject`, `setApproval`); every call settles, never rejects.
- `apps/web/app/staff/agents/client.test.ts` (new, 20 tests)
- `apps/web/app/staff/agents/agent-row.tsx` (new) — one agent row: subject select + Save,
  Approve/Revoke with a confirm step (`role="alert"` + Yes/Cancel).
- `apps/web/app/staff/agents/view.tsx` (new) — `StaffAgentsView`: list/empty/fallback states,
  optimistic local patch on success, manual Reload.
- `apps/web/app/staff/agents/view.test.tsx` (new, 18 tests incl. an axe check)
- `apps/web/app/staff/agents/page.tsx` (new) — server component, `requireRole`, `listForStaff`.
- `apps/web/app/staff/agents/page.test.tsx` (new, 3 tests)
- `apps/web/app/api/staff/agents/route.int.test.ts` (edited) — added the 12.4b end-to-end case
  (unapproved refusal → approve → starts); lifted course/style-card/package setup into `beforeAll`.
- `apps/web/app/teacher/publish/PublishView.tsx` (edited) — added `regulated_unapproved` to
  `RUN_ERROR_KEYS` and `START_ERROR_KEYS`.
- `apps/web/app/teacher/publish/PublishView.test.tsx` (edited) — one `it.each` case added to
  each of the run-error and start-refusal suites.
- `apps/web/messages/en.json` (edited, append-only) — new `staffAgents` block; `regulated_unapproved`
  key (plan's exact text, no contact/number/name) added to both `publish.runErrors` and
  `publish.startErrors`.
- `apps/web/app/staff/page.tsx` (edited, shared file, one nav entry appended) — added
  `{ href: '/staff/agents', label: staffAgents('nav') }`, sourcing the label from the new
  `staffAgents` namespace rather than adding a key to `staff`, to keep the shared `en.json` change
  scoped to exactly the brief's allowed blocks.

## Tests

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — 34/34 tasks green
  (first run hit 5 unrelated timeouts under concurrent-agent load, including the known-flaky
  `src/auth/index.test.ts`; a clean re-run passed all 1861 non-skipped tests).
- Int test against a disposable container (`db124d-pg2`, port 55513, started and removed by me;
  no `edmate-*` container touched): `route.int.test.ts` — 8/8 passed, including the new 12.4b
  end-to-end case.
- `python3 .githooks/secret-scan.py --all` — clean.

## Decisions

### 22 Oct 2026 · 12.4d risky paths touched · decided by builder · risk: high
- Decided: this PR touches `apps/web/app/staff/**` and `apps/web/app/api/staff/**` (new
  `staff/agents` page and client; `staff/page.tsx` nav edit). Per the plan, `security-reviewer`
  must review this PR before merge.
- Why: these paths gate who can see and change a regulated-subject flag/approval that controls
  whether a teacher's agent can publish — a staff-only privilege boundary.
- risk: high

### 22 Oct 2026 · 12.4d confirm-step design for Approve/Revoke · decided by builder · risk: low
- Decided: Approve/Revoke uses a local two-click confirm (click shows a `role="alert"` message
  with Yes/Cancel; Yes performs the call), not a browser `confirm()` or a modal dialog.
- Why: no existing precedent (`staff/alerts`, `staff` queue) has a destructive-confirm action;
  this keeps it in the row's own accessible DOM, consistent with the rest of the component style,
  and is simple to test without mocking `window.confirm`.
- risk: low

### 22 Oct 2026 · 12.4d nav label source · decided by builder · risk: low
- Decided: `apps/web/app/staff/page.tsx`'s new nav entry label is read from the `staffAgents`
  namespace (`staffAgents('nav')`), not a new key added to the `staff` namespace.
- Why: the brief scoped the shared `en.json` edit to "one `staffAgents` block plus one key per
  publish error block"; sourcing the label from the block I already own avoids adding a second,
  unlisted key to a namespace another builder may also be touching.
- risk: low

## Left to do

None for this task's scope. `security-reviewer` sign-off is required before merge (risky paths,
see Decisions).

Status: DONE

Tool calls used: 112

## Fix round (22 Oct 2026)

- Fixed code-reviewer HIGH (same root cause as typescript-reviewer MEDIUM): `AgentRow` was keyed
  in `view.tsx` by `agent.agentId` alone, so its local `subject` `useState` never resynced after a
  Reload picked up another staff member's change to `regulatedSubject`/`approvedAt` for the same
  agent — the select kept showing stale data and `dirty` was computed against the new prop, so
  Save could silently POST the stale value and clear the fresh approval.
- Fix: changed the `<AgentRow>` key in `apps/web/app/staff/agents/view.tsx` from `agent.agentId`
  to `` `${agent.agentId}:${agent.regulatedSubject ?? ''}:${agent.approvedAt ?? ''}` ``, so React
  remounts the row (and its local state) whenever the server's subject or approval changes,
  instead of reusing a stale component instance. No change to `agent-row.tsx` logic was needed.
- Test: added `reload resyncs a row to the fresh server subject/approval instead of keeping stale
  local state` in `apps/web/app/staff/agents/view.test.tsx` — load with subject `health`/unapproved,
  reload returns subject `law`/approved by another staff id for the same `agentId`; asserts the
  select now shows `law`, Save stays disabled (not dirty), and the row shows a Revoke action.
  Confirmed it fails on the unfixed key (`agent.agentId` alone, timeout waiting for value `law`)
  and passes with the fix.
- The focus MEDIUM and the LOWs (agent-row.tsx:72-86 focus-loss on confirm toggle; the `as
  SubjectOption` cast; optimistic `approvedBy` guess in view.tsx) are left as-is, per brief.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — 10/10 tasks green.
  `python3 .githooks/secret-scan.py --all` — clean.

Fix tool calls used: 15

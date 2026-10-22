# Task 12.4c handoff: staff API /api/staff/agents (12.4 Phase C)

Status: DONE
Branch: m12/12.4c-staff-agents-api (pushed from work-124c)
Worktree: .claude/worktrees/agent-a5205c9d40ff3b666
Tool calls used: 30

## Summary
New staff-only API over 12.4a's `regulatedSubjects` repository, copying the 12.1b verifications
pattern. `GET` lists every agent with its flag (`listForStaff(session id)`; ids, public slug,
status, live version, subject, approval time and approving staff id only). `POST` takes a strict
discriminated body: `{ action: 'subject', agentId, subject: 'investing'|'health'|'law'|null, note? }`
or `{ action: 'approval', agentId, approved, note? }`; note trimmed, 1 to 500 chars; any `by`,
`approvedBy` or other unknown key is 400 and never reaches the repository. Both methods are
`withRole(['staff'])` (the existing `/api/staff/**` ROUTE_POLICY row already covers the path, so
`src/auth/**` is untouched), `cache-control: no-store`, repository kinds map to fixed codes
(scope 403, not_found 404, invalid/integrity 400, else 500), and only the error's name is logged
(never its message or the note). Response: `{ agents: [...] }` and `{ agentId, changed }`.

## Files
- apps/web/app/api/staff/agents/route.ts (new)
- apps/web/app/api/staff/agents/handlers.ts (new)
- apps/web/app/api/staff/agents/route.test.ts (new, 47 tests, written first and seen red)
- apps/web/app/api/staff/agents/route.int.test.ts (new, 7 tests, gated on TEST_DATABASE_URL)
- docs/tasks/12.4c/handoff.md
No shared file, en.json, auth policy, packages/db, contracts or page edits.

## Tests
- `corepack pnpm vitest run app/api/staff/agents/route.test.ts --coverage.enabled` (red first: no
  handlers module) → `Tests 47 passed`; agents folder 97.9% statements, 96.3% branches, 100% lines.
- `TEST_DATABASE_URL=postgres://...@localhost:55741/t124c corepack pnpm vitest run app/api/staff/agents/route.int.test.ts`
  (own disposable pgvector container, removed afterwards) → `Tests 7 passed`.
  Covers: 401 signed-out, 403 teacher on GET and POST (no audit rows), list shape with no personal
  columns, approve-unflagged 400, body `by` 400, flag stored and audited with the trimmed note,
  approval stored with the session staff id and audited, repeat approval no-op, subject change
  clears approval.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → `Tasks: 10 successful,
  10 total`, `Tests 1686 passed | 17 skipped`.
- `python3 .githooks/secret-scan.py --all` → clean.

## Decisions
### 22 Oct 2026 · 12.4c Staff agents API boundary (staff-only, strict body, session id, note never logged) · decided by builder · risk: high
- Decided: `/api/staff/agents` GET and POST are `withRole(['staff'])` under the existing `/api/staff/**` policy row; the POST body is a strict discriminated union (unknown keys such as `by` are 400), the acting staff id comes only from the session, repository errors map to fixed codes, and only the error's name is logged, never its message or the note. Reviewer: security-reviewer (risky path `apps/web/app/api/staff/**`).
- Why: plan 12.4 Phase C and the 12.1b/12.5c staff pattern; the flag decides what regulated subject reaches the harness on the next publish, so only staff may set it and every change is audited by the repository.
- risk: high

### 22 Oct 2026 · 12.4c Approving an unflagged agent is 400 validation with its own message · decided by builder · risk: low
- Decided: the repository's `invalid` on `approval` (the body already passed the same schema, so it can only mean the agent has no subject) is a 400 `validation` with the text "Set a regulated subject on this agent before approving it." There is no `conflict` error code in contracts, and adding one needs an ADR.
- Why: gives the 12.4d page a clear message without a contracts change.
- risk: low

## Deviations
- The int test asserts only the stored flag, approval and audit rows, not `publish.startRun`: 12.4b (the publish block) is not merged yet, so per the plan the publish part moves to 12.4d's int test.
- The int test was written after the handlers (the unit test was the red-first test); it passed on first run.

## Left to do
- 12.4d: assert in its int test that a staff flag through this API makes `publish.startRun` refuse `regulated_unapproved` and that the approval POST lets it start (needs 12.4b merged); build the `/staff/agents` page and the teacher refusal text.

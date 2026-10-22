# 12.2d handoff: staff reports and takedowns API

## Summary
Added the staff-only `/api/staff/reports` and `/api/staff/takedowns` routes (ROUTE_POLICY
`/api/staff/**`, `withRole(['staff'], ...)`). Reports: GET lists the open queue
(12.2a's `listOpenForStaff`), POST reviews one report (`dismissed`/`actioned`, optional
note) via `review`. Takedowns: GET lists active takedowns (`listActiveForStaff`), POST is
a discriminated body — `create` takes a document or agent down (12.2b's `create`, which
also closes a linked open report), `lift` restores it. In both routes the staff id is
always `ctx.principal.userId` (the session), never read from the body — the zod schemas
are `strictObject`/`discriminatedUnion`, so an extra `by` key (or any unknown key) is a
400 before the handler runs. Repository errors map to fixed HTTP codes
(`scope`→403, `not_found`→404, `invalid`/`integrity`→400, `failed`→500); only
`error.name` is ever logged (`describeError`), never the message. All responses set
`cache-control: no-store`.

## Files
- `apps/web/app/api/staff/reports/handlers.ts`, `route.ts`, `route.test.ts` (new)
- `apps/web/app/api/staff/takedowns/handlers.ts`, `route.ts`, `route.test.ts` (new)
- `apps/web/app/api/staff/reports/route.int.test.ts` (new) — also exercises the
  takedowns routes and the 12.2c student report route end to end over a real Postgres

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — 10/10 tasks
  successful (typecheck, lint, unit/integration test suites all green; 1951+ tests).
- Integration test (`route.int.test.ts`) run against my own disposable container
  (never touched the running `edmate-*` containers):
  ```
  docker run -d --name db122d-pg -e POSTGRES_USER=edmate -e POSTGRES_PASSWORD=edmate-dev \
    -e POSTGRES_DB=edmate -p 127.0.0.1:55498:5432 \
    -v <worktree>/docker/postgres/init.sql:/docker-entrypoint-initdb.d/001-extensions.sql:ro \
    pgvector/pgvector:0.8.1-pg16
  TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55498/edmate \
    corepack pnpm vitest run app/api/staff/reports/route.int.test.ts
  # Test Files  1 passed (1)
  #      Tests  5 passed (5)
  docker rm -f db122d-pg
  ```
  Covers: student files a report through the real 12.2c route and the staff GET lists
  it with no reporter id, session id or email in the payload; staff dismiss removes it
  from the open queue; a document is found by `retrievalIndexFor` search before a
  takedown; a staff takedown removes it from search at once and a lift restores it;
  non-staff is 403 and signed-out is 401 on both staff GETs.
- `python3 .githooks/secret-scan.py --all` — clean (no output).

## Decisions

### 22 Oct 2026 · 12.2d staff reports/takedowns security review · decided by builder · risk: high
- Decided: `apps/web/app/api/staff/**` is a risky path (merge-gate risk-paths.txt);
  this PR needs `security-reviewer` to confirm the staff-only guard, the strict/
  discriminated zod bodies (no unknown keys, no client-supplied actor), the fixed
  error-code mapping (no raw error messages reach the client or logs), and
  `cache-control: no-store` on every response, before merge.
- Why: these routes let staff dismiss reports and take down documents/agents —
  getting the actor or the auth check wrong would let a non-staff user hide reports
  or censor content; getting the error mapping wrong could leak internal details.
- risk: high

## Left to do
- None for Phase D's scope. 12.2e (staff reports/takedowns pages) and 12.4d (staff
  agents page) build their UI against these routes next.

Status: DONE
Tool calls used: 14 (this resumed segment; see prior session summary for the full build)

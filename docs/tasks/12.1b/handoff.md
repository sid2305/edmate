# 12.1b handoff: staff console page and verification routes (apps/web, Phase B of 12.1)

Branch: `m12/12.1b-staff-console` (built locally as `work-121b`)
Worktree: `.claude/worktrees/agent-a68c72033bbf65e8e`

## Summary
Adds the staff verification console. `GET /api/staff/verifications` lists pending teachers
(12.1a's `listPendingForStaff`: slug, subject, declared name and email, oldest first) and
`POST /api/staff/verifications` approves or rejects one teacher through the existing
`teacherProfiles.setVerification` (8.1), which checks staff + not-self and writes the
`teacher.verify` audit row in the same transaction. Both are wrapped in `withRole(['staff'])`,
matching the existing `/api/staff/**` policy row (no `policy.ts` / `guard.ts` change). The staff id
comes only from the session; the POST body is a strict zod object
(`teacherId`, `status: 'verified'|'rejected'`, optional trimmed `reason` capped at 500, the repo's
own cap), so a body `by` or any unknown key is a 400. Repository errors map to fixed codes
(`scope` → 403 `forbidden`, which is how the not-self rule surfaces; `not_found` → 404;
`invalid`/`integrity` → 400 `validation`; anything else → 500 `provider_error`), raw error text is
never returned, and only the error's name is logged. Every response is `cache-control: no-store`
(the guard's own 401/403s already are).

`/staff` is a server page: `requireRole(['staff'])` before any read, then the queue for the
session's own id. A failed read logs the error name and renders the fallback view. The client view
safeParses the initial list and every server reply (wrong shape → fallback / fixed error), wraps
every body read in try/catch, runs each action under try/catch/finally around one busy flag (all
buttons disabled while one action is in flight, always reset), and removes a row once its decision
succeeds. A Reload button re-reads the queue. jest-axe passes on the list, fallback and empty views.

`.claude/skills/merge-gate/risk-paths.txt` gains one line, `apps/web/app/api/staff/**`, under the
existing `# reviewers: security-reviewer` group (lead answer Q4).

## Files
- `apps/web/app/api/staff/verifications/handlers.ts` (new): `createStaffVerificationHandlers`
  (list/decide over an injected backend), `toQueueItem`, `MAX_REASON_CHARS`. Kept next to
  `route.ts` (not in `src/`) so it sits under the new risk glob; Next route files can only export
  handlers, so the injectable factory needs its own module.
- `apps/web/app/api/staff/verifications/route.ts` (new): `GET`/`POST` = `withRole(['staff'], …)`.
- `apps/web/app/api/staff/verifications/route.test.ts` (new): memory repo with the real one's
  rules (staff-only, not-self, audit row per decision, publish only when verified).
- `apps/web/app/api/staff/verifications/route.int.test.ts` (new): the same handlers through the real
  guard over a real Postgres (real repositories, audit rows, `assertVerifiedForPublish`).
- `apps/web/app/staff/page.tsx`, `view.tsx`, `verification-row.tsx`, `client.ts` (new) and
  `page.test.tsx`, `view.test.tsx`, `client.test.ts` (new).
- `apps/web/messages/en.json`: one new top-level `staff` block appended; nothing else touched.
- `.claude/skills/merge-gate/risk-paths.txt`: one line added (see above).

## Tests
- Route (`route.test.ts`, 50 cases): signed-out 401, student 403, teacher 403 on GET and POST
  through the real `createGuard` + `ROUTE_POLICY`, with nothing read or written; a teacher can't
  approve themselves via the route; cross-site staff POST 403; staff POST calls `setVerification`
  with `by` = session id and writes exactly one `teacher.verify` audit row (reason trimmed into it);
  the approved teacher leaves the queue; a staff user can't verify their own profile (fixed 403
  `forbidden`, status unchanged, no audit row); pending and rejected teachers fail
  `assertVerifiedForPublish`, a verified one passes; body `by`/`userId`/`verificationStatus` keys,
  `pending`, missing/empty/non-string ids, blank or over-cap reasons, arrays and `null` are 400; a
  reason exactly at the cap is accepted; malformed JSON 400, oversize 413; every repository error
  kind maps to its fixed code with no raw text; unexpected throws log only the error name;
  `route.ts` exports are guarded for `['staff']` and `force-dynamic`.
- Real Postgres (`route.int.test.ts`, 6 cases; own disposable container, never the `edmate-*` ones):
  ```
  docker run -d --name db121b-pg -e POSTGRES_USER=edmate -e POSTGRES_PASSWORD=edmate-dev \
    -e POSTGRES_DB=edmate -p 127.0.0.1:55497:5432 \
    -v <worktree>/docker/postgres/init.sql:/docker-entrypoint-initdb.d/001-extensions.sql:ro \
    pgvector/pgvector:0.8.1-pg16
  cd apps/web && TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55497/edmate \
    corepack pnpm vitest run app/api/staff app/staff
  ```
  → `Tests 81 passed (81)` (unit + int). Container removed afterwards (`docker rm -f db121b-pg`).
  Without `TEST_DATABASE_URL` the int file prints a SKIPPED line to stderr and skips; with
  `CI=true` and no URL it throws instead (CI sets the URL for the whole job, and turbo passes it to
  `test`).
- Page (`page.test.tsx`): asks for `['staff']` first and reads nothing if the guard refuses; reads
  the queue for the session id; a failed read renders `initial: null` and logs only the error name.
- View (`view.test.tsx`, 15 cases) and client (`client.test.ts`, 13 cases): rows render with name,
  email or "No email on file"; approve/reject send the decision and remove the row with a status
  notice; while in flight every action is disabled and only the clicked button says "Saving…";
  each error code shows its message and re-enables the buttons; a thrown call resets the busy flag;
  the next action clears an old alert; a wrong-shape or `null` initial is the fallback with Reload;
  reload error/throw shows the load error, keeps the last good list and re-enables Reload; jest-axe
  clean on list, fallback and empty views. The client never rejects: network failure, non-2xx
  (server code kept), unreadable JSON, wrong shape, or a reply naming another teacher/status are
  fixed failures; a blank reason is omitted, a real one trimmed.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` →
  `Tasks: 34 successful, 34 total` (before and after `git merge origin/main`).
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

### Manual check ("How it will be shown")
Done at the DB + route level by `route.int.test.ts` against my own container (results above): a
staff user (granted via `identity.grantRole` by `operator`, the same call `db:grant-role` makes)
sees two new pending teachers with their declared name and email; a signed-out user is 401 and a
teacher 403 on both methods; a pending teacher's `assertVerifiedForPublish` fails; staff reject one
(audit row: actor = staff id, `actorRole: staff`, `teacher.verify`, reason, before `pending`, after
`rejected`), it stays unpublishable and leaves the queue; staff approve the other (audit row, after
`verified`) and only then does `assertVerifiedForPublish` pass; a teacher promoted to staff can't
change their own profile (403, no new audit row).

Browser walk-through for the try-it guide (not run here; needs the full app stack with sign-in):
```
corepack pnpm --filter @edmate/db db:grant-role -- --email <your-signed-in-email> --role staff --by operator
# sign in as that user, open http://localhost:8080/staff, approve or reject a pending teacher,
# then check the audit row:
docker compose -f docker/compose.yaml exec postgres psql -U edmate -d edmate \
  -c "select actor, action, target, reason, before, after from audit_log where action = 'teacher.verify' order by ts desc limit 5;"
```

## Decisions

### 22 Oct 2026 · 12.1b Staff role boundary for the verification API and the new risk-paths line · decided by builder · risk: high
- Decided: `/api/staff/verifications` GET/POST are `withRole(['staff'])` only (signed-out 401,
  student and teacher 403, cross-site POST 403); the acting staff id is only ever the session
  principal, the POST body is a strict object (a `by` or any unknown key is 400), and the existing
  `setVerification` stays the only write path (its staff re-check, not-self rule and
  `teacher.verify` audit row are unchanged; not-self surfaces as a fixed 403 `forbidden`).
  `apps/web/app/api/staff/**` is added to `risk-paths.txt` under `# reviewers: security-reviewer`
  (one line, lead answer Q4; no architect sign-off needed).
- Why: this is the first staff-auth route and it changes who may publish; the plan and lead
  treat the staff boundary and the `.claude/**` edit as risky.
- risk: high

### 22 Oct 2026 · 12.1b Handlers live next to route.ts, not in src/ · decided by builder · risk: low
- Decided: the injectable handler factory is `apps/web/app/api/staff/verifications/handlers.ts`
  (a file the plan didn't list), not `src/staff/…`.
- Why: Next route files may only export handlers, so the factory needs its own module; keeping it
  under `app/api/staff/` puts it under the new security-reviewer risk glob, which a `src/` file
  would escape.
- risk: low

### 22 Oct 2026 · 12.1b Real-Postgres route test gated on an explicit TEST_DATABASE_URL · decided by builder · risk: medium
- Decided: `route.int.test.ts` runs the real handlers, guard and repositories against
  `TEST_DATABASE_URL` only when it is set (no default URL, so a local run never touches the dev
  compose database); unset it logs a SKIPPED line, and under `CI=true` it fails instead. It migrates
  that database (idempotent, locked) and writes only fresh random ids/emails, leaving both test
  teachers `rejected` so nothing pending or discoverable is left for the e2e run sharing CI's
  database.
- Why: the acceptance needs proof that approve/reject is audited and unverified teachers stay
  unpublished, which a memory fake alone can't give; apps/web has no `pg` dependency to create a
  throwaway database, and adding one was out of scope.
- risk: medium

### 22 Oct 2026 · 12.1b GET maps invalid/not_found to 403 and the console runs one action at a time · decided by builder · risk: low
- Decided: on GET, a repository `invalid`/`not_found` (only possible when the session's own id is
  not a staff user) is 403 `forbidden`, like `scope`. In the console, any in-flight action disables
  every approve/reject/reload button until it settles.
- Why: neither case is the caller's input error; one action at a time avoids racing list updates.
- risk: low

## Left to do
- Browser walk-through of `/staff` with a real signed-in staff account (commands above) for the
  try-it guide; not run here (needs the full app stack with sign-in).
- No nav link to `/staff` from other pages (reached by direct URL, like 8.9's inbox before its link).

Status: DONE
Tool calls used: 78

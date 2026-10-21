# Task 6.5: Student view, reset and export of memory

Board: milestone M6 · deps `5.6`, `6.2`, `M3` (all done; 6.3 and 6.4 are done too) · branch
`m6/6.5-memory-reset` · **risky** (`packages/db/src/repositories/**`, `apps/web/src/auth/**`) ·
**two phases** (A: `packages/db`, B: `apps/web`), one builder per phase.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Student view, reset and export of memory"
Accept: "reset clears the profile and writes an audit row."

Build plan line 446: "**Student control:** view, reset and export what the agent remembers; every
change audited." PRD line 188: "Students can see and reset what the agent remembers."

### How it is shown (paste into handoff.md)
`packages/db/test/memory-reset.int.test.ts` seeds a pair with mastery, mistakes, a `lastSummary`
and evidence events, calls `learnerProfiles.reset(scope)`, then asserts:
- the profile row has `mastery = {}`, `mistakes = []`, `last_summary IS NULL` (`lang` is kept);
- the pair's `evidence_events` are gone, and `rebuildMastery` afterwards gives `{}` (no resurrection);
- exactly one new `audit_log` row: `action 'profile.reset'`, actor = the student, `actor_role
  'student'`, the pair's `teacher_id`/`student_id`, `target 'learner_profile:<row id>'`, with
  before/after **counts only** (no summary text, no tag names);
- every other pair (same student with another teacher, same teacher with another student) is
  unchanged: profile, evidence and audit rows.
Phase B adds the route test showing `DELETE /api/me/memory/:agentId` reaches that method with
the signed-in student's scope and nothing from the request body.

## State of the world (read, not assumed)

- **Memory** is `learner_profiles` (one row per student x teacher: `lang`, `mastery`, `mistakes`,
  `last_summary`) plus `evidence_events` (append-only, the input to `rebuildMastery`).
  `packages/db/src/repositories/learner.ts` has `get`, `save`, `applyMastery`, `applyMistakes`
  (6.3), `applyEvidenceMastery`, `rebuildMastery` (6.2), and `evidenceEvents.append` /
  `appendAndFold`. `sessions.end` (6.4, merged) writes `last_summary` in one transaction with
  ending the session. No method reads evidence back. No reset or export exists.
- **The audit pattern exists:** `packages/db/src/repositories/audit.ts`.
  `insertAuditEntry(tx, method, teacherId, studentId, input)` is the one write path (actor check,
  redaction, 10 000-char cap). Other repositories call it inside their own transaction
  (subscriptions' cost-alarm pause, `teacherProfiles.setVerification`). Its doc comment already
  names `profile.reset` as an example action. `audit.listForStudent` reads the pair's rows.
  **No new audit table or helper is needed.**
- **No deletes outside `chunks.ts`:** `packages/db/test/scope.test.ts` fails if any repository file
  other than `chunks.ts` contains `.delete(`, and README rule 7 says "memory reset 6.5" is the
  next planned delete. Removing evidence needs a narrow, test-pinned exception for `learner.ts`.
- **Lock order in use:** `appendAndFold`/`applyEvidenceMastery` lock `topics` (key share) and then
  the `learner_profiles` row (`FOR UPDATE`). `sessions.end` and `endOnPackageChange` update
  `sessions` first and then upsert `learner_profiles`. A reset that locks the profile first and
  then ends sessions would deadlock (40P01) against `sessions.end`.
- **Deleting the profile row is unsafe:** `appendAndFold`/`applyMistakes`/`rebuildMastery` insert a
  default row, then `SELECT … FOR UPDATE` it, and throw `scope` if it vanished. A reset that
  deletes the row while one of them waits would produce spurious errors. Clearing in place avoids
  that.
- **Web:** `ROUTE_POLICY` (`apps/web/src/auth/policy.ts`) already has `/api/me/**` GET (student)
  and `/api/me` DELETE. A route under `apps/web/app/api/me/memory/[agentId]/` gets GET for free
  but needs a new DELETE row. `withRole` enforces same-origin on unsafe methods (guard.ts:134).
  `route-coverage.test.ts` and the `guard.test.ts` matrix pick up a new row automatically.
  Student scope comes from `studentTurnScope(agents, principal, agentId)`
  (`apps/web/src/turn/scope.ts`): live agent only, student id from the principal.
  `apps/web/src/subscriptions/start.ts` is the handler pattern to copy (injected backend,
  `RepositoryError` mapped to fixed messages, `no-store`).
- **No live evidence producer yet** (6.2/6.3 shipped the storage only, and 6.4a holds the producer
  and the session-end trigger). So a stale queued job re-adding pre-reset evidence is theoretical
  today (see Q2).
- US-first, English only. 6.0b (India DPDP gate) is parked and not touched.

## Design

### Phase A: `packages/db`

**`learnerProfiles.reset(scope: StudentScope): Promise<{ reset: boolean }>`** (learner.ts). One
transaction, in this lock order (matches `sessions.end`: sessions, then profile):
1. `UPDATE sessions SET ended_at = now() WHERE teacher_id = $t AND student_id = $s AND ended_at IS
   NULL` (Q1). It writes no summary, so a later `sessions.end` on that session is `{ ended: false }`
   and can't re-seed `last_summary`.
2. `SELECT id, mastery, mistakes, last_summary FROM learner_profiles WHERE <pair> FOR UPDATE`. If
   there is no row, return `{ reset: false }`. Then nothing else is written: no audit row and no
   evidence delete (step 1 still ends the sessions; see the edge-case test).
3. `DELETE FROM evidence_events WHERE teacher_id = $t AND student_id = $s` (Drizzle
   `.delete(evidenceEvents).where(and(eq(evidenceEvents.teacherId, …), eq(evidenceEvents.studentId,
   …)))`, `.returning({ id })` for the count).
4. `UPDATE learner_profiles SET mastery = '{}', mistakes = '[]', last_summary = NULL, updated_at =
   now() WHERE <pair>`. `lang` is kept: it's a setting, not memory.
5. `insertAuditEntry(tx, method, teacherId, studentId, { actor: studentId, actorRole: 'student',
   action: 'profile.reset', target: 'learner_profile:<id>', before: { topics, mistakes,
   hadSummary, evidence, sessionsEnded }, after: { topics: 0, mistakes: 0, hadSummary: false,
   evidence: 0 } })`. These are counts and booleans only. The summary text and tag names never go
   into the audit row (the redactor doesn't catch free text).
The actor is always the scope's student (staff reset is the trust console's job, 12.x). Wrapped in
`translateWrite`, and `guarded` by `createRepositories` as usual.

**`evidenceEvents.list(scope, { limit }): Promise<{ events: EvidenceEvent[]; truncated: boolean }>`**
(learner.ts). It reads the pair's events ordered `ts ASC, id ASC`, with `limit` capped at
`EVIDENCE_LIST_MAX = 10_000` (exported). It fetches `limit + 1` rows to set `truncated`, so a cut
export says so and never looks complete (lesson "A check that silently skips looks like a pass").

**Tests that pin the exception** (`packages/db/test/scope.test.ts`): `learner.ts` may call
`.delete(` on `evidenceEvents` only, and that call's `.where(and(…))` must contain both
`eq(evidenceEvents.teacherId, …)` and `eq(evidenceEvents.studentId, …)`. Every other file keeps
the current rule. `chunks.ts` keeps its existing test unchanged.

**README** (`packages/db/src/repositories/README.md`): rule 7 and rule 8 name the new delete. Add
a short "Memory reset and export (task 6.5)" section covering the lock order, clearing in place,
counts-only audit, the evidence cap and `truncated`.

No contracts change, no migration, no harness change: `ProfileStore` is untouched, and
`buildContext` reads the profile every turn, so a reset takes effect on the next turn.

*State after Phase A:* the two methods exist with isolation cases, the integration test proves
the acceptance, and `@edmate/db` is green. Nothing calls them yet.

### Phase B: `apps/web`

- **Policy row** (`apps/web/src/auth/policy.ts`): `{ pattern: '/api/me/memory/*', methods:
  ['DELETE'], access: ['student'] }`. Clearance stays at the default `age`, not `agent`: a student
  waiting on consent can still see, export and reset their own data.
- **Route** `apps/web/app/api/me/memory/[agentId]/route.ts`: `GET = withRole(['student'],
  memoryHandlers.export)` and `DELETE = withRole(['student'], memoryHandlers.reset)`.
- **Handlers** `apps/web/src/memory/routes.ts` (`createMemoryHandlers(backend)`, same shape as
  `subscriptions/start.ts`). The `agentId` path param is parsed with
  `StartSessionSchema.shape.agentId`, and the scope comes from `studentTurnScope` (a non-live or
  malformed agent gives 404). The handlers ignore the request body.
  - GET returns `{ profile, evidence, truncated }` as JSON with `content-disposition: attachment;
    filename="edmate-memory.json"` and `cache-control: no-store`. A missing profile is
    `{ profile: null, evidence: [], truncated: false }` with 200.
  - DELETE calls `learnerProfiles.reset(scope)` and returns `{ reset }` with 200 and `no-store`.
  - `RepositoryError` kinds map to fixed messages (`not_found`/`scope` to 404, `failed` to 500).
    No raw error text leaves.
- **Page** `apps/web/app/learn/[agentId]/memory/page.tsx` (server component; `requireRole(['student'])`,
  then the same scope resolution, then `learnerProfiles.get`) renders `src/memory/MemoryView.tsx`:
  topics with mastery as a percent and the evidence count `n`, mistake tags with counts, the last
  summary, an empty state, an export link (`/api/me/memory/<agentId>`, `download`), and
  `ResetMemoryButton` (a client component: `window.confirm`, `fetch(…, { method: 'DELETE' })`,
  then `router.refresh()`; it shows a fixed error line on failure). Topics show as their ids. Topic
  titles need a topics read and are deferred.
- **Link**: one nav item on `apps/web/app/learn/[agentId]/page.tsx` ("What your tutor remembers")
  to the memory page.
- **Strings**: a `memory` block in `apps/web/messages/en.json` (English only).

*State after Phase B:* a student can open the memory page from the chat, download the JSON and
reset. The web suite is green.

## Files

**Phase A (packages/db)**
- Modify `packages/db/src/repositories/learner.ts`: add `reset` and `evidenceEvents.list`, and export
  `EVIDENCE_LIST_MAX`.
- Modify `packages/db/src/repositories/index.ts`: export `EVIDENCE_LIST_MAX`.
- Modify `packages/db/src/repositories/README.md`: rules 7 and 8, plus the new section.
- Create `packages/db/test/memory-reset.int.test.ts`.
- Modify `packages/db/test/repositories.int.test.ts`: `CASES` for `learnerProfiles.reset` and
  `evidenceEvents.list`.
- Modify `packages/db/test/scope.test.ts`: the pinned delete exception.

**Phase B (apps/web)**
- Modify `apps/web/src/auth/policy.ts` (one row) and `apps/web/src/auth/guard.test.ts` (explicit
  assertions for the row).
- Create `apps/web/app/api/me/memory/[agentId]/route.ts`.
- Create `apps/web/src/memory/routes.ts` and `apps/web/src/memory/routes.test.ts`.
- Create `apps/web/src/memory/MemoryView.tsx`, `apps/web/src/memory/ResetMemoryButton.tsx` and
  `apps/web/src/memory/MemoryView.test.tsx` (covers both components).
- Create `apps/web/app/learn/[agentId]/memory/page.tsx` and `page.test.tsx`.
- Modify `apps/web/app/learn/[agentId]/page.tsx` (nav link) and its `page.test.tsx` if it pins the nav.
- Modify `apps/web/messages/en.json`.
- `docs/tasks/6.5/handoff.md` (builder, per phase).

## Files out of bounds
- `packages/contracts/**`, `docs/adr/**`: no contracts change. Stop and report if one seems needed.
- `packages/harness/**`: the `ProfileStore` port and `buildContext` are unchanged.
- `packages/db/migrations/**` and `packages/db/src/schema/**`: no migration (the Q2 watermark is
  deferred).
- `packages/db/src/repositories/sessions.ts`, `audit.ts`, `chunks.ts`: call or read them, never edit.
- `content/locales/**`, `content/legal/**`, anything for 6.0b (India), and 13.4 (whole-account
  export, delete and retention).

## Tests first

**Phase A.** Write these and see them fail before any code:
1. `memory-reset.int.test.ts`:
   - Acceptance (above).
   - Two other pairs are untouched.
   - `rebuildMastery` after reset gives `{}`.
   - The pair's open session is ended, and another pair's open session isn't. A later
     `sessions.end(scope, thatSession, 'summary')` returns `{ ended: false }` and `lastSummary`
     stays null.
   - No profile row: `{ reset: false }`, no audit row, nothing deleted.
   - A second reset writes a second audit row with zero counts.
   - Concurrency: `Promise.all` of reset with `appendAndFold`, and reset with `sessions.end`, for
     the same pair, about 20 rounds. No error (no 40P01). The end state is consistent: evidence
     present implies mastery is folded from that evidence only.
   - `evidenceEvents.list`: own pair only, ordered by ts, `truncated` true at `limit` 2 with 3 rows,
     `limit` over the max is `invalid`.
2. `scope.test.ts`: the exception test (it passes only with the scoped delete in `learner.ts`).
3. `repositories.int.test.ts`: the two `CASES` (tsc fails until they exist).

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
with Postgres up (`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d
postgres`), then `python3 .githooks/secret-scan.py --all`.

**Phase B.**
1. `routes.test.ts` (injected backend, no database):
   - GET returns the attachment headers and `no-store` with the export shape.
   - DELETE calls `reset` with `{ studentId: principal.userId, teacherId: owner }`, even when the
     body names another student.
   - A non-live or malformed agent gives 404, and a `RepositoryError` gives a fixed response.
2. `guard.test.ts`: `policyFor('DELETE', '/api/me/memory/x')` is `['student']`;
   `policyFor('DELETE', '/api/me/progress')` stays null; a cross-origin DELETE gives 403.
3. `MemoryView.test.tsx`:
   - The view renders mastery, mistakes, summary, the empty state, and the export link.
   - The button: cancel sends no fetch; confirm sends one DELETE to the right URL and then
     refreshes.
4. `memory/page.test.tsx`: a non-student is redirected (the guard stub), and a non-live agent gives
   notFound.

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` (the full web suite,
including `route-coverage` and `age-flow`; lesson "Red CI from changes that passed locally"), then
the secret scan.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (`learner.ts`, `index.ts`, `README.md`) needs
  **security-reviewer**.
- `apps/web/src/auth/**` (`policy.ts`, `guard.test.ts`) needs **security-reviewer**.
- Not risky: `packages/db/test/**`, `apps/web/app/api/me/**` (only `api/webhooks/**` and
  `api/auth/**` are listed), `apps/web/app/learn/**`, `apps/web/src/memory/**` and `messages/en.json`.
  No contracts, ADR, harness guardrail or pedagogy file, and no migration.
- **Recommended, beyond the gate:** database-reviewer, for the first evidence delete, the lock
  order and the concurrency test. code-reviewer and typescript-reviewer run as usual.
- The handoff logs a `risk: high` decision (draft below).

## Open questions (each with a recommendation; none blocks the start)

- **Q1. Should reset also end the pair's open sessions?** Recommend **yes**. Otherwise the session
  that is open at reset time keeps its pre-reset chat in context, and when 6.4a's end trigger
  lands, its summary would re-seed `lastSummary`. This reuses 3.16's precedent (end the session,
  clear the summary) and costs one UPDATE. If the lead says no, drop step 1 and its tests.
- **Q2. A queued evidence or summary job from before the reset could land after it.** Recommend
  **defer** to a new board task **6.5a** (a `memory_reset_at` watermark: `append`/`appendAndFold`
  drop events with `ts` before it, and `sessions.end` skips sessions started before it). There is
  no live evidence producer yet (6.4a), so the race is theoretical today, and the fix needs a
  migration and edits to three methods. Land it with or before 6.4a.
- **Q3. Web page in this task, or API only?** Recommend the **minimal page** in Phase B. The title
  says "student view", and the page is about 3 small components. If the lead wants a smaller
  build, keep Phase B to the route and policy row and move the page to M13 (MVP-first precedent).
- **Q4. Key the routes by live `agentId` or by `teacherId`?** Recommend **agentId** through
  `studentTurnScope`. It's the same reviewed scope resolution the chat uses, and the student only
  knows agents. Memory with a suspended agent's teacher then reaches the student only through
  13.4's account export and delete; log that as deferred.

Deferred (say so in the handoff): topic titles on the page; staff-initiated reset (12.x); the
stale-job watermark (6.5a); whole-account export and delete, and past `sessions.summary` and
message history (13.4); India/DPDP (6.0b, parked).

## Lead answers (21 Oct 2026)

- **Q1:** yes. Reset ends the pair's open sessions (step 1 stays, with its tests).
- **Q2:** defer. New board task **6.5a** (M13, risky): a `memory_reset_at` watermark; lands with or before 6.4a.
- **Q3:** build the minimal page in Phase B.
- **Q4:** key the routes by live `agentId` through `studentTurnScope`; a suspended agent's memory is reachable through 13.4.

## Decisions (draft for the handoff)

### 6.5 reset clears learner memory in place, deletes the pair's evidence, and audits counts only · risk: high
Decided: `learnerProfiles.reset` ends the pair's open sessions, then locks the profile, deletes
the pair's `evidence_events` (the first delete outside `chunks.ts`, pinned by `scope.test.ts`),
and empties `mastery`, `mistakes` and `last_summary` (`lang` is kept). It writes one `profile.reset`
audit row (actor = student) with before/after counts only, all in one transaction, in
sessions-then-profile lock order.
Why: keeping the evidence would let `rebuildMastery` bring the memory back. Deleting the profile
row would race the insert-then-lock writers. The lock order matches `sessions.end`, so the two
can't deadlock.
risk: high (new write and delete path in `packages/db/src/repositories/**`).

### 6.5 memory routes: GET export under the existing `/api/me/**` row, new DELETE row, clearance `age` · risk: high
Decided: `GET` and `DELETE /api/me/memory/:agentId` (student only, scope from the principal and
the live agent's owner). The new policy row covers DELETE only.
Why: a student must be able to see and reset their own data even while consent is outstanding.
risk: high (`apps/web/src/auth/**`).

### 6.5 export says when it is cut · risk: low
Decided: `evidenceEvents.list` caps at 10 000 events and returns `truncated`.
Why: an export that silently drops rows would look complete.

### 6.5 deferrals · risk: low
Decided: topic titles, staff reset, the stale-job watermark (6.5a) and whole-account export and
delete (13.4) are out of this task.

## Budget
Budget: 90 tool calls (2 phases, packages/db + apps/web; Phase A 40, Phase B 50)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck, lint and test via corepack pnpm turbo; `docker compose … up -d postgres` for the
db integration tests; `python3 .githooks/secret-scan.py --all`). No network, model or payment calls.

## Exit conditions
- **Phase A, Status: DONE** when the Phase A tests pass, the db gate is green, `git diff origin/main
  -- packages/contracts packages/db/migrations` is empty, and the handoff has the phase note and the
  draft risk: high decision. **Phase B, Status: DONE** when the web gate is green (full suite) and
  the handoff is complete with `Tool calls used:`.
- **Status: PARTIAL** past about 40 calls in Phase A or about 50 in Phase B. Also PARTIAL if a file
  outside this plan needs changes (in particular `sessions.ts`, `audit.ts`, the schema or a
  migration), if the concurrency test shows a deadlock the stated lock order doesn't fix, or if the
  lead's answer to Q1–Q4 changes scope. Stop and report; don't widen the task.
- **Status: BLOCKED** if a contracts change turns out to be needed.

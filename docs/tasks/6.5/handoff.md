# 6.5 handoff

Status: DONE (Phase A and Phase B both built)

Branch: `m6/6.5-memory-reset`
Worktree (Phase A): `.claude/worktrees/agent-a4313e9f9e0e7afe1`
Worktree (Phase B): `.claude/worktrees/agent-a2907730984b7b789`
Commit (Phase A): `f5b12a4`
Commit (Phase B): `65568d5`
Tool calls used: 167 (harness counts: Phase A 60, Phase B 107)

## What was built (Phase A: packages/db)

- `learnerProfiles.reset(scope): Promise<{ reset: boolean }>` (`packages/db/src/repositories/learner.ts`). One
  transaction, lock order matching `sessions.end` (sessions first, then the profile row `FOR UPDATE`) to avoid
  deadlocking with `sessions.end` or `evidenceEvents.appendAndFold`:
  1. Ends any open session for the pair.
  2. Locks the profile row; no row → returns `{ reset: false }` with nothing else written (the session-end from
     step 1 still happened).
  3. Deletes the pair's `evidence_events`.
  4. Clears `mastery = {}`, `mistakes = []`, `last_summary = NULL` (keeps `lang`).
  5. Writes one `audit_log` row, `action: 'profile.reset'`, actor = student, `actor_role: 'student'`,
     `target: learner_profile:<id>`, before/after as **counts only** (topics, mistakes, hadSummary, evidence,
     sessionsEnded) — never the summary text or mistake tags.
- `evidenceEvents.list(scope, { limit }): Promise<{ events: EvidenceEvent[]; truncated: boolean }>` for export,
  ordered by `ts` then `id`, capped at `EVIDENCE_LIST_MAX = 10_000`, fetches `limit + 1` rows to detect truncation
  without ever returning more than `limit`.
- `EVIDENCE_LIST_MAX` exported from `packages/db/src/index.ts`.
- `packages/db/src/repositories/README.md` updated: rule 7 (ownership columns immutable) and rule 8 (no raw SQL,
  `.delete(` only in `chunks.ts` and now `learner.ts`) plus a new "Memory reset and export (task 6.5)" section.
- `packages/db/test/scope.test.ts`: the "no deletes outside chunks.ts" guard now also allows `learner.ts`, plus a
  new pinned test asserting `learner.ts` has exactly one `.delete(`, on `evidenceEvents` alone, scoped by both
  `teacherId` and `studentId` in the same statement.
- `packages/db/test/repositories.int.test.ts`: two new `CASES` entries, `learnerProfiles.reset` (write, owns every
  actor since there's no separate target id) and `evidenceEvents.list` (read, isolation-grid checked). The reset
  case's `verify` restores the mutated session/profile/evidence state afterward (same "put it back" idiom
  `sessions.end` / `sessions.endOnPackageChange` already use) so later cases in the same file are unaffected.
- `packages/db/test/memory-reset.int.test.ts` (new): standalone acceptance suite on its own throwaway Postgres
  database, covering: clearing + counts-only audit; every other pair unchanged; a later `sessions.end` can't
  re-seed the summary; no-profile-row path (`{ reset: false }`, open session still ends, no audit row); a second
  reset writes a second all-zero audit row; `reset` racing `appendAndFold` and racing `sessions.end` 10-20 rounds
  each with no deadlock and a consistent end state; `evidenceEvents.list` ordering, truncation, and limit
  validation (`EVIDENCE_LIST_MAX + 1` and `0` both reject with `kind: 'invalid'`).

## Test results

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`: all green.
  - `test`: 53 test files, 899 passed / 4 skipped (903 total), coverage 99.9% stmts / 97.72% branch / 99.81% funcs
    / 99.94% lines (new `learner.ts` lines: 100% stmts/funcs/lines, 97.61% branch).
  - `typecheck`, `lint`: pass.
- `python3 .githooks/secret-scan.py --all`: clean.
- `git diff origin/main -- packages/contracts packages/db/migrations`: empty (no schema/contract changes).

## What was built (Phase B: apps/web)

- **Policy row** (`apps/web/src/auth/policy.ts`): `{ pattern: '/api/me/memory/*', methods: ['DELETE'],
  access: ['student'] }`, clearance left at the default `age` (GET keeps falling under the existing
  `/api/me/**` row). `guard.test.ts` gets explicit assertions for both methods, the Origin check and
  the clearance.
- **Route** `apps/web/app/api/me/memory/[agentId]/route.ts`: `GET = withRole(['student'],
  memoryHandlers.export)`, `DELETE = withRole(['student'], memoryHandlers.reset)`.
- **Handlers** `apps/web/src/memory/routes.ts` (`createMemoryHandlers(backend)`, same shape as
  `subscriptions/start.ts`): the `agentId` path param is parsed with `StartSessionSchema.shape.agentId`,
  the scope comes from `studentTurnScope` (a non-live or malformed agent is 404), and the request body
  is never read at all (not just ignored) — the DELETE route reaches `learnerProfiles.reset` with only
  the principal's own scope even when the body names another student. GET returns
  `{ profile, evidence, truncated }` with `content-disposition: attachment` and `no-store`; a missing
  profile is `{ profile: null, evidence: [], truncated: false }` with 200. `RepositoryError` kinds map
  to fixed responses (`not_found`/`scope` → 404, else 500); no raw message leaves.
- **Page** `apps/web/app/learn/[agentId]/memory/page.tsx` (server component; `requireRole(['student'])`
  with the default clearance, then the agent's owner, then `learnerProfiles.get`) renders
  `src/memory/MemoryView.tsx`: topics (shown as their ids) with mastery as a percent and the evidence
  count, mistake tags with counts, the last summary, an empty state, an export link (`download`), and
  `src/memory/ResetMemoryButton.tsx` (a client component: `window.confirm`, one `fetch(…, { method:
  'DELETE' })`, then `router.refresh()`; a failed request shows a fixed error line).
- **Link**: `apps/web/app/learn/[agentId]/page.tsx`'s nav now has a second item, "What your tutor
  remembers", to `/learn/<agentId>/memory`; its `page.test.tsx` pins the link.
- **Strings**: a `memory` block in `apps/web/messages/en.json` (English only).

## Test results (Phase B)

- `src/memory/routes.test.ts` (10 tests): GET's shape, attachment headers and no-store; a missing
  profile; truncation passthrough; a non-live/malformed agent giving 404 with no repo call; a
  `RepositoryError` giving a fixed response with the method name scrubbed; DELETE calling `reset` with
  the principal's own scope even when the body names another student, and its own 404/500 paths.
- `src/auth/guard.test.ts` (87 tests, all passing): the new row's policy, clearance and Origin-check
  assertions, plus the generic "role x route matrix" (see Decisions below for the one fix it needed).
- `src/auth/route-coverage.test.ts` (13 tests): the new route file is picked up automatically.
- `src/memory/MemoryView.test.tsx` (7 tests): mastery/mistakes/summary rendering, the empty state (no
  profile and an empty profile), the export link's `href` and `download`, and the reset button's
  cancel/confirm/error paths.
- `app/learn/[agentId]/memory/page.test.tsx` (4 tests): the clearance call, a non-live agent giving
  `notFound`, no database read when the guard refuses, and the resolved scope reaching the view.
- `app/learn/[agentId]/page.test.tsx` (existing suite, +1 assertion): the new nav link.
- `src/chat/clearance-scan.test.ts`: updated to exclude the memory page (see Decisions).
- Full `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`: green (10/10 tasks).
  `@edmate/web:test` alone: 56 test files (1 skipped, no local Redis), 833 passed / 4 skipped.
  `@edmate/web:typecheck` and `@edmate/web:lint`: pass. (`@edmate/queue#test` fails in this sandbox on
  its own, unrelated `turnLimits.int.test.ts` Redis-only coverage gap — not touched by this task, and
  not a dependency of anything Phase B changed.)
- `python3 .githooks/secret-scan.py --all`: clean.
- `git diff origin/main -- packages/contracts packages/db/migrations`: empty.

## Decisions

### 21 Oct 2026 · 6.5 merge: student memory view, reset and export · decided by lead · risk: high
- Decided: merge 6.5. `learnerProfiles.reset(scope)` ends the pair's open sessions, deletes its evidence and clears mastery, mistakes and the last summary in one transaction, and writes a counts-only audit row. `evidenceEvents.list` is capped at 10,000 rows on the server. GET and DELETE `/api/me/memory/:agentId` resolve the scope through `studentTurnScope` and never read the request body. A minimal `/learn/[agentId]/memory` page shows the memory, downloads the JSON and resets it.
- Why: security-reviewer, database-reviewer and typescript-reviewer (all sonnet) approve with no CRITICAL or HIGH. Two MEDIUMs are deferred: the profile lock on plain `append` to 6.5a, and the `(teacher_id, student_id, ts, id)` index to 6.2a. Three LOWs go to 6.5b.
- risk: high (`packages/db/src/repositories/**`, `apps/web/src/auth/**`).

### 21 Oct 2026 · 6.5 budget overrun: 167 tool calls against 90 · decided by lead · risk: low
- Decided: accept the overrun. The handoff's estimates are corrected to the harness counts (60 + 107).
- Why: Phase B needed two test-harness fixes the plan didn't foresee (the guard matrix and the clearance scan). The work is complete and approved, so a re-run would cost more than it saves.
- risk: low

### `reset` on a pair with no profile row still ends the open session
Decided: The plan's step 1 (end open sessions) runs before the profile-row check in step 2, so a pair with an open session
but no profile row (e.g. a brand-new session before the first turn populates a profile) still gets its session
ended even though the method returns `{ reset: false }` and writes no audit row. This matches "session end" being
a straightforward idempotent action independent of whether a profile exists yet, and avoids leaving an open
session dangling just because the profile hasn't been created. Tested explicitly in `memory-reset.int.test.ts`.

### CASES entry restoration idiom for `learnerProfiles.reset`
Decided: `repositories.int.test.ts` drives a single shared seeded fixture through many write cases in sequence. The new
`learnerProfiles.reset` case's `verify` step restores the acted-on pair's session/profile/evidence to the seed's
original values afterward (raw SQL), following the existing `sessions.end` / `sessions.endOnPackageChange`
pattern, so later cases and tests in the same file keep seeing the original fixture. Placed the new CASES entries
(`learnerProfiles.reset`, `evidenceEvents.list`) directly before `evidenceEvents.append` in object literal order,
which is also execution order for `it(...)` blocks generated from the CASES object.

### Raw test inserts into `evidence_events` must supply an explicit `id`
Decided: `evidence_events.id` uses Drizzle's `id()` column helper, which applies `randomUUID()` as a **client-side**
default only when inserting through Drizzle's query builder — not a Postgres column default. Raw `pg` driver
inserts used in test setup/restoration (both in `repositories.int.test.ts`'s restore step and
`memory-reset.int.test.ts`'s session-race test) must supply `id: gen_random_uuid()::text` explicitly or the
insert violates the `NOT NULL` constraint.

### Standalone throwaway database for `memory-reset.int.test.ts`
Decided: Followed the `cost-alarm.int.test.ts` template: its own `createDatabase`/`migrateDatabase`/`dropDatabase` via
`test/pg.ts`, reusing `isolation-seed.ts`'s `seed()` for the base fixture, rather than sharing the large mutable
fixture in `repositories.int.test.ts`. This keeps the acceptance-depth tests (races, audit content, no-profile
edge case) independent of the isolation grid's shared mutable state.

### The generic "role x route matrix" test needed a small, general fix for the new overlapping row
Decided: `/api/me/memory/*` (DELETE) nests inside the already-listed `/api/me/**` (GET): the same sample path
(`/api/me/memory/item_1`) matches both rows. `guard.test.ts`'s matrix loop previously derived each
row's "is this method listed" flag from that row's own `methods` array only, so it expected GET at
that path to be refused under the new DELETE-only row — which is wrong: the real `ruleFor` serves GET
there via the broader `/api/me/**` row with the same `['student']` access, so it actually returns 200.
Fixed by deriving `listed` from the real routed rule (`ruleFor(method, path)`, same access as the row
under test) in addition to the row's own `methods` list, which is correct for every pre-existing row
too (no overlap there, so behaviour is unchanged) and now also correct for this one. No other test
file needed this kind of change.

### `clearance-scan.test.ts` gets one named exception for the memory page
Decided: The scan enforces `clearance: 'agent'` on every guarded file under `app/learn/**`, written for the
chat page before this task. The memory page's design is deliberately `age` (the default): a student
waiting on a parent's consent can still see, export and reset their own memory (plan's Phase B design
section, and the lead's Q3/Q4 answers). Rather than weaken the scan generally, it now excludes exactly
`app/learn/[agentId]/memory/page.tsx` by name, with a comment explaining why, so a *different* future
page under `app/learn/**` that should ask for `agent` clearance still fails the scan if it doesn't.

### The DELETE route reads no request body at all
Decided: The plan's acceptance says the route must reach `reset` "with the signed-in student's scope and
nothing from the request body." Rather than parsing and discarding a body, `createMemoryHandlers`
never calls `req.json()` (or any body reader) for either handler — the scope always comes from
`ctx.principal` and `studentTurnScope`. This is strictly stronger than "ignores the body": a
malformed or oversized body can't even be parsed to fail the request.

### `EvidenceEvent`/`LearnerProfile` import from `@edmate/contracts`, not `@edmate/db`
Decided: `@edmate/db`'s `index.ts` doesn't re-export the contract types (only runtime values/schemas it
defines itself); `apps/web` already depends on `@edmate/contracts` directly, so the memory route and
view types import from there, matching how other value types that cross the API boundary are typed
elsewhere in `apps/web`.

## Left out of this task (per the plan's "Deferred" list)
Topic titles on the page (shown as topic ids); staff-initiated reset (12.x); the stale-job watermark
(6.5a, new board task per the lead's Q2 answer, M13); whole-account export/delete and past
`sessions.summary`/message history (13.4); India/DPDP (6.0b, parked).

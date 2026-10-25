# 9.3h plan — the staff verification queue and lookup row show active takedowns and the last decision

Status: READY

## Acceptance (verbatim from the board)

> a staff view test shows active takedowns and the last decision on a queue row and a lookup row;
> web typecheck, lint and test green.

How it will be shown:
- `apps/web/app/staff/view.test.tsx` (new cases): a pending-queue row and a lookup-found row each
  show (a) how many active takedowns the teacher currently has (or "None"), and (b) the most
  recent verify/reject decision on record for that teacher, if any (status + date), or "No
  previous decision". This is exactly the Q4 motivation from 9.3f: a teacher who was safety-
  rejected and later edited their subject back to `pending` reappears in the queue — staff now see
  that history instead of a blank row.
- `apps/web/app/api/staff/verifications/route.test.ts` / `route.int.test.ts` (new cases): `list`
  and `lookup` both return the new fields per teacher, sourced from existing tables with no new
  write.

## Context (read before building)

- 9.3f (`docs/tasks/9.3f/{plan,handoff}.md`) built `findBySlugForStaff` and the `lookup` route this
  task extends; its left-to-do opened this task verbatim (plan Q4).
- `packages/db/src/repositories/takedowns.ts` already has a staff-only, system-wide read,
  `listActiveForStaff(by)`, returning `StaffTakedownRow[]` (`{id, kind, targetId, teacherId,
  teacherSlug, category, createdAt}`, capped at `TAKEDOWNS_ACTIVE_MAX_LIMIT` = 200). This task
  calls it as-is and groups by `teacherId` in `apps/web` — **no change to `takedowns.ts`**.
- `packages/db/src/repositories/audit.ts` has no staff-facing read today: `listForTeacher` /
  `listForStudent` take a `TeacherScope`/`StudentScope` with no actor check of their own (the
  caller's own session is the scope, checked one layer up) — not safe to call with an arbitrary
  `teacherId` from a staff console. `setVerification` (`teacher-profiles.ts`, untouched by this
  task) writes a `teacher.verify` audit row, target `teacher:<teacherId>`, `before`/`after` carry
  `{verificationStatus, ...}`, on every decision. This task adds **one new read**,
  `audit.findLastVerifyForStaff(by, teacherId)`, with its own staff check (same precedent as
  `takedowns.listActiveForStaff` and `teacherProfiles.listPendingForStaff`: a plain, unlocked read
  of `users.role`, not a lock — this never writes).
- **Scope note (read before touching anything in `packages/db`):** `packages/db/src/repositories/
  teacher-profiles.ts`, `packages/db/src/cli.ts` and `packages/db/src/repositories/redact-json.ts`
  are under review on another branch (task 8.1b) right now. **Do not touch any of them.** This
  plan is designed so it never needs to: the new data is composed in `apps/web`'s handlers from
  two existing/new **reads** (`takedowns.listActiveForStaff`, the new `audit.findLastVerifyForStaff`),
  not from a change to `TeacherVerificationQueueRow` or `toTeacherVerificationQueueRow`.
  `teacherProfiles.findBySlugForStaff` and `.listPendingForStaff` are called exactly as 9.3f left
  them.
- **Scope note (parallel task 9.3i):** task 9.3i (pause/cancel for a subscription whose agent is
  suspended) is being planned in parallel. It touches `packages/db/src/repositories/
  subscriptions.ts` (and maybe `agents.ts`), `apps/web/app/home/**` and `apps/web/app/learn/**`.
  This task touches none of those — it is entirely inside the staff verification console and
  `packages/db/src/repositories/audit.ts`. The only files this task's plan shares with *either*
  8.1b or 9.3i are two repo-wide shared test fixtures that virtually every `packages/db` task
  touches (`packages/db/test/repositories.int.test.ts`, `packages/db/test/scope.test.ts`) and
  `apps/web/messages/en.json` (shared by nearly every `apps/web` task) — all three are additive,
  non-overlapping edits (a new grid entry / exclusion line / new keys), not a shared method or
  shared logic. Every other file below is unique to this task.

## Design (one sentence each)

1. `audit.findLastVerifyForStaff(by: unknown, teacherId: unknown): Promise<{status: 'verified' |
   'rejected'; reason: string | null; ts: string} | null>` (new, `packages/db/src/repositories/
   audit.ts`): staff-only (role check, no lock), reads the newest `auditLog` row where `teacherId
   = teacherId` and `action = 'teacher.verify'`, returns its decided status (from `after.
   verificationStatus`), `reason` and `ts`, or `null` if the teacher has never been decided.
2. `apps/web/app/api/staff/verifications/handlers.ts` gains one helper, `enrichQueueRows(repos,
   by, rows)`: calls `takedowns.listActiveForStaff(by)` once (not per row), groups by `teacherId`,
   then for each row looks up its group and calls the new `audit.findLastVerifyForStaff(by,
   teacherId)` (one call per row — the queue is capped at 50, the lookup is always one row; no
   batched audit read exists or is needed at this scale). Both `list` and the single-row `lookup`
   call this same helper, so the two callers (and `page.tsx`'s server-rendered first paint) can
   never drift from each other.
3. `QueueItem`/`LookupItem` gain `activeTakedowns: {kind: 'document' | 'agent'; category: string;
   createdAt: string}[]` and `lastDecision: {status: 'verified' | 'rejected'; reason: string |
   null; ts: string} | null`. `apps/web/app/staff/client.ts`'s zod schemas mirror this (so a
   malformed reply is still a fixed failure, never trusted).
4. `VerificationRow` renders two more `dt`/`dd` pairs, always (not gated by `currentStatus`): how
   many active takedowns (or "None") and the last decision (status + date, or "No previous
   decision") — shown on every row, pending-queue or lookup-found, per the acceptance line.
5. `apps/web/app/staff/page.tsx`'s server-rendered first paint calls the same `enrichQueueRows`
   helper (not just `toQueueItem`), so the very first render already shows this (no stale/empty
   flash until a manual reload).

## Files to create / modify (one phase)

### `packages/db` (risky: `packages/db/src/repositories/**`)

No migration: one new read over the existing `audit_log` table, no new column.

1. `packages/db/src/repositories/audit.ts` — add `findLastVerifyForStaff` (design #1). Import
   `users` from `../schema/index.js` (for the role check, same precedent as `teacherProfiles.
   listPendingForStaff`) and `iso` from `./map.js` (already used elsewhere in this file's sibling
   modules for a `Date` → ISO string). A malformed `by`/`teacherId` is `invalid` before any SQL; a
   well-formed `by` who is not staff right now is `scope`.
2. Tests (tests first):
   - `packages/db/test/audit.test.ts` (new file, unit, `noDb` proxy pattern — mirrors `teacher-
     profiles.test.ts`'s header comment and style): a malformed `by` or `teacherId` is `invalid`
     before any SQL touch.
   - `packages/db/test/repositories.int.test.ts`: one new grid entry, `'audit.
     findLastVerifyForStaff'` (same shape as the neighbouring `'takedowns.listActiveForStaff'`
     entry just above `takedowns.countUpheld`): a non-staff `by` is `scope` for a few ids; staff
     finds `null` for a teacher never decided; staff finds the latest decision's `status` for a
     teacher this file's existing fixtures already reject-then-reopen (reuses an existing fixture
     teacher rather than adding a new one, if the file already has one at the point this runs —
     otherwise decide one verified/rejected teacher inline, same style as the neighbouring entry).
   - `packages/db/test/scope.test.ts`: one new exclusion line, next to the `teacherProfiles.
     listPendingForStaff` / `.findBySlugForStaff` / `reports.listOpenForStaff` cluster — `audit.
     findLastVerifyForStaff` takes a bare staff id and a bare teacher id, not a `TeacherScope` or
     `StudentScope` object, so it cannot run through this grid (same reasoning comment style as
     its neighbours).
   - Coverage: `src/repositories/**` stays at 100% statements/functions/lines.
   - Run: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`; secret scan.

### `apps/web` (risky: `apps/web/app/api/staff/**`)

3. `apps/web/app/api/staff/verifications/handlers.ts` — widen `StaffVerificationBackend.repos()`'s
   return type to `Pick<Repositories, 'teacherProfiles' | 'takedowns' | 'audit'>`; add the
   `TakedownSummary` / `LastDecision` types (design #3), the `enrichQueueRows` helper (design #2),
   and export it (`page.tsx` needs it too); `list` calls `listPendingForStaff` then
   `enrichQueueRows` inside the **same** try/catch (one more read failing is the same "queue read
   failed" case, not a new error path — same lessons-driven choice 9.3f Phase C made for
   `unavailable`); `lookup` calls `findBySlugForStaff`, and when non-null, `enrichQueueRows(repos,
   by, [row])` for the single row, then `toLookupItem`. `decide` is byte-for-byte unchanged.
4. `apps/web/app/staff/client.ts` — `QueueItemSchema` gains `activeTakedowns` (array of `{kind:
   z.enum(['document','agent']), category: z.string(), createdAt: z.string()}`) and `lastDecision`
   (nullable `{status: z.enum(['verified','rejected']), reason: z.string().nullable(), ts:
   z.string()}`); `LookupItemSchema` (which extends it) needs no separate edit.
5. `apps/web/app/staff/verification-row.tsx` — two more `dt`/`dd` pairs (design #4), always shown.
6. `apps/web/app/staff/page.tsx` — replace `rows.map(toQueueItem)` with `await enrichQueueRows(
   serverDatabase().repos, principal.userId, rows)`, inside the same existing try/catch.
7. `apps/web/messages/en.json` (`staff`): `activeTakedownsLabel: "Active takedowns"`,
   `activeTakedownsNone: "None"`, `activeTakedownsCount: "{count, plural, one {1 active takedown}
   other {{count} active takedowns}}"` (same ICU plural syntax already used for `liveClasses` in
   this file), `lastDecisionLabel: "Last decision"`, `lastDecisionNone: "No previous decision"`,
   `lastDecisionLine: "{status} on {date}"`.
8. Tests (tests first):
   - `apps/web/app/api/staff/verifications/route.test.ts`: widen the `memory()` fixture with
     `takedowns.listActiveForStaff` and `audit.findLastVerifyForStaff` mocks (defaulting to `[]`
     and `null`); update every existing exact-body (`toEqual`) assertion for `list`/`lookup` to
     include the two new fields with their default empty values; add new cases: a teacher with an
     active takedown shows it in `list` and `lookup`; a teacher with a prior `teacher.verify`
     decision shows it in both; the mock throwing from either new call maps through the same
     `RepositoryError` → status switch already covered by the existing `it.each` (no new switch
     branch needed — assert it still works, don't duplicate the whole table).
   - `apps/web/app/api/staff/verifications/route.int.test.ts`: one real round trip — safety-reject
     a teacher (writes the `teacher.verify` audit row and a `takedowns` row via 9.3e/9.3f's
     existing path), then `list`/`lookup` a *different*, still-pending teacher shows `lastDecision:
     null` and `activeTakedowns: []` (own-rows-only, not leaking the rejected teacher's history);
     looking the rejected teacher up by slug afterwards (any status, per 9.3f) shows its own
     `lastDecision.status === 'rejected'` and one active takedown.
   - `apps/web/app/staff/client.test.ts`: `loadQueue`/`findTeacherBySlug` parse replies that
     include the new fields; a reply missing them (an old-shaped server, or a malformed one) is
     the existing fixed-failure path (schema mismatch), proving the client never half-trusts a
     reply.
   - `apps/web/app/staff/view.test.tsx`: a queue row and a lookup-found row each show "None" / the
     active-takedown count and "No previous decision" / the last-decision line, with the right
     plural copy for 2+ active takedowns; axe clean with both populated.
   - `apps/web/app/staff/page.test.tsx`: widen the `serverDatabase()` mock's `repos` with
     `takedowns.listActiveForStaff` / `audit.findLastVerifyForStaff` stubs (default `[]` / `null`,
     so every existing case keeps passing unchanged); one new case proves the SSR `initial` prop
     carries the two new fields from a non-default stub, matching 9.3f Phase C's precedent for
     `home/page.test.tsx` and `unavailable`.
   - Run: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`; secret scan.

## Files out of bounds

`packages/db/src/repositories/teacher-profiles.ts`, `packages/db/src/cli.ts`, `packages/db/src/
repositories/redact-json.ts` (8.1b, in review right now — do not touch). `packages/db/src/
repositories/{subscriptions,agents,ports,publish}.ts`, `apps/web/app/home/**`, `apps/web/app/
learn/**` (9.3i's territory, being planned in parallel — no change needed here). `packages/db/src/
repositories/takedowns.ts` (reused as-is, `listActiveForStaff` needs no change). `apps/web/app/
staff/agents/**`, `apps/web/app/staff/reports/**`, `apps/web/app/api/staff/{agents,takedowns,
reports,alerts}/**` (unrelated consoles). `packages/contracts/**` (no new error code or port — the
existing `RepositoryError` kinds cover this). Any migration (none needed).

## Risky paths touched (checked against risk-paths.txt)

- `packages/db/src/repositories/audit.ts` — group "access filter / money / data isolation"
  (`packages/db/src/repositories/**`): required reviewer `security-reviewer`. Recommended as well:
  `database-reviewer` (a new cross-teacher-safe read over `audit_log`), `code-reviewer`,
  `typescript-reviewer`.
- `apps/web/app/api/staff/verifications/handlers.ts` (no new route file — `lookup`'s route.ts from
  9.3f is unchanged) — group `apps/web/app/api/staff/**`: required `security-reviewer`; plus
  `code-reviewer`.
- Not risky by path: `apps/web/app/staff/**` (console UI), `apps/web/messages/en.json`, `packages/
  db/test/**`, this plan. No contracts, ADR, harness, locale or migration change.
- This task's handoff logs a `risk: high` decision (below) for the one `packages/db` change and
  the one `apps/web/app/api/staff/**` change.

## Decisions to log (handoff `## Decisions`, risk: high)

1. "A new staff-only, read-only `audit.findLastVerifyForStaff` (own role check, no lock) and the
   existing `takedowns.listActiveForStaff` (9.3f's own precedent for reuse without change) feed a
   new `enrichQueueRows` helper in `apps/web`'s staff verification handlers, so the pending queue
   and the slug lookup both show a teacher's active takedowns and last verify/reject decision —
   closing 9.3f's Q4 gap (a safety-rejected teacher who edits their subject back to `pending` no
   longer reappears in the queue with no history). `teacher-profiles.ts`, `cli.ts` and `redact-
   json.ts` (8.1b, in review in parallel) and `subscriptions.ts`/`agents.ts`/`apps/web/app/
   {home,learn}/**` (9.3i, planned in parallel) are untouched."

## Open questions (all non-blocking; recommendations are what the plan builds)

- Q1 Count vs. detail for active takedowns: recommended count by default, with the per-takedown
  `kind`/`category`/`createdAt` list available in the API reply (already built, cheap) in case a
  later task wants to show it — the UI text itself only needs the count for this acceptance line.
- Q2 Should `lastDecision` show which staff member decided? Recommended **no** — the audit row's
  `actor` is not surfaced here; it adds another staff identity to a console that doesn't need it
  for this acceptance line, and the full history is still in `audit_log` for anyone who needs it.
- Q3 Per-row audit lookups (one `findLastVerifyForStaff` call per queue row, up to 50) vs. a single
  batched query: recommended per-row for this task — the queue is small and staff-only, and a
  batched "latest decision per teacher" read is a reasonable follow-up if the queue ever grows,
  not a blocker now.

## Budget

Budget: 60 tool calls (1 phase, packages/db + apps/web)

One Sonnet builder, one branch, one PR (`m13/9.3h-staff-takedowns-last-decision`).

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for `@edmate/db` and `@edmate/web`,
the secret scan, git add/commit/push on the task branch only).

## Exit conditions

- `Status: DONE`: the tests above exist and pass (tests first), both packages' typecheck, lint and
  test are green with the db coverage threshold met, secret scan clean, handoff written with
  `Tool calls used:` and the `risk: high` decision.
- Stop at `Status: PARTIAL` when past ~60 calls, when a file outside this plan needs a change
  (name it — especially if it turns out `teacher-profiles.ts`, `cli.ts`, `redact-json.ts`, or any
  9.3i-territory file is unavoidable), or when `repositories.int.test.ts`'s grid entry needs a
  different fixture shape than described above.

## Lead answers (24 Oct 2026)

Approved as written.
- Q1: count in the UI; the detail list stays in the API reply.
- Q2: no staff identity on the row.
- Q3: one lookup per row is fine, but run the row lookups in parallel (`Promise.all`), not one after another.
- The board title's "subject-edit history" is not in this acceptance line; it moves to new board task 9.3k. Log that as a `decided by lead · risk: low` decision in the handoff.
Reviewers on the PR: security-reviewer (required for both risky groups), database-reviewer, code-reviewer, typescript-reviewer.

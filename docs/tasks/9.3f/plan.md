# 9.3f plan — staff can safety-reject a *verified* teacher; students stop seeing a vanished chat

Status: READY

## Acceptance (verbatim from the board)

> a verified teacher with live subscribers can be safety-rejected from the staff console and
> their students lose access; web and db typecheck, lint and test green; security-reviewer
> re-checks.

How it will be shown:
- `packages/db/test/teacher-profiles.int.test.ts` (new case): a fixture teacher is **verified**
  (not pending) with a live agent and a subscribed student; `teacherProfiles.findBySlugForStaff`
  finds it by slug regardless of status; `setVerification({status:'rejected', safety:true})`
  (already built in 9.3e, unchanged) takes the agent down exactly as it does from `pending` — this
  closes the loop proving the repository never needed a change, only a way to reach the row.
- `apps/web/app/api/staff/verifications/route.int.test.ts` (new case): staff look up a **verified**
  teacher's slug through the new `lookup` route, then POST a safety rejection for that
  `teacherId` — 200, the agent is suspended, the student's entitlement resolves null (same
  Postgres proof 9.3e already has for a pending-start rejection, now run from `verified`).
- `apps/web/app/staff/view.test.tsx` (new cases): a "find a teacher" search box, given a slug,
  shows a verified teacher's row with Approve/Reject (+ safety checkbox); Reject with the box
  ticked sends `safety: true` and shows the existing `rejectedSafety` notice; the row then clears.
- `apps/web/app/home/view.test.tsx` + `apps/web/src/chat/liveChats.test.ts` (new cases, B-49): a
  student whose subscription's agent is no longer `live` (safety-suspended or draft) no longer
  silently vanishes from `/home` (today's bug — see Context) — a plain, blame-free line appears
  instead, naming no teacher detail, same precedent as the existing takedown texts (12.2 Q6).

## Context (read before building)

- 9.3e (`docs/tasks/9.3e/{plan,handoff,review}.md`) built `setVerification({safety:true})`: it
  already works from **any** starting `verificationStatus` (`pending`, `verified` or `rejected`)
  — nothing in the repository method requires the teacher to be pending today; its own
  `teacher-profiles.int.test.ts` fixture already starts **verified** and safety-rejects it. The
  security review's MEDIUM (deferred here) is **not** a repository gap: `listPendingForStaff`
  filters to `verificationStatus = 'pending'`, so a verified teacher never appears as a
  `QueueItem` the console can act on, and the client only ever POSTs a `teacherId` taken from that
  list. Staff have no way today to even name a verified teacher to `/api/staff/verifications`.
  **Fix: a new staff-only lookup by slug, independent of status**, feeding the same existing
  `decide` call. No change to `setVerification`, `takeDownAgentInTx` or any lock order.
- Separately (B-49 follow-up, 9.3e's left-to-do and Q3): once an agent is suspended,
  `subscriptions.listLiveForStudent` (`apps/web/src/chat/liveChats.ts` → `/home`) inner-joins on
  `agents.status = 'live'`, so that subscription **disappears from `/home` with no trace** — not
  even a 404, just gone. That is the real "B-49 student line / home card" gap: a chat the student
  was using quietly stops being listed. The plain-text fix is a second, narrow, read-only query
  that finds exactly those not-ended subscriptions whose agent is no longer live, so `/home` can
  show one blame-free line instead of nothing. This task does **not** touch `listLiveForStudent`
  itself (it also feeds `/api/live-classes/[id]/questions`, out of scope here) or `agents.owner`
  (the thing that 404s `/learn` and `/learn/.../plan` — touching it risks widening turn access).
- MVP-first (lead note on this task): payments are not live (M10), so a suspended agent costs
  nobody money today; reaching pause/cancel from a 404'd plan page is **not** pilot-blocking and
  is deferred (Q5). The pilot-blocking core is only: (1) the acceptance line above, and (2) the
  student not losing their chat link with zero explanation.
- `docs/lessons.md` "UI state and server replies: trust neither, reset everything" — the new
  search box and the new home block follow the same try/catch/finally, reset-on-every-action
  pattern as `StaffQueueView` and the existing paused/startable lists.

## Design (one sentence each)

1. `teacherProfiles.findBySlugForStaff(by, slug)`: the same staff-only, `TeacherVerificationQueueRow`
   shape as `listPendingForStaff`, but keyed by slug with **no status filter** — a read, no lock,
   no write.
2. `subscriptions.listUnavailableForStudent(studentId)`: the same bare-id-exception shape as
   `listLiveForStudent`, but the mirror query — not-ended subscriptions whose current package's
   agent is **not** `live` — returned as `{agentId, teacherId}` rows, read-only.
3. A new `/api/staff/verifications/lookup` GET route (same handlers file, same backend) wires (1)
   into the console; the console's existing search result reuses `VerificationRow` and the
   existing `decide` call unchanged — rejecting a teacher that happens to be `verified` was always
   a valid call, it just had no caller.
4. `/home`'s `homeLinks` gains a third bucket, `unavailable`, sourced from (2); `HomeView` shows
   one new paragraph when it is non-empty, no link, no teacher name (same precedent as the
   existing takedown texts, 12.2 Q6).

## Files to create / modify

### Phase A — packages/db (risky: `packages/db/src/repositories/**`)

No migration: both new methods are plain reads over existing columns.

1. `packages/db/src/repositories/teacher-profiles.ts` — `findBySlugForStaff(by: unknown, slug:
   unknown): Promise<TeacherVerificationQueueRow | null>`: `parseArg(IdSchema, by, ...)`, role
   read via `users.role` (same precedent as `listPendingForStaff`, not `lockRole` — this is a
   read, not a write), `scope` if not staff; `parseArg(Slug, slug, ...)`; select + join `users` on
   `teacherProfiles.slug = s` with **no** `verificationStatus` filter; `toTeacherVerificationQueueRow`
   or `null`. Export nothing new from `index.ts` beyond what already re-exports
   `TeacherVerificationQueueRow` (unchanged).
2. `packages/db/src/repositories/subscriptions.ts` — `listUnavailableForStudent(studentId: string):
   Promise<Array<{agentId: string; teacherId: string}>>`: same bare-id shape and `IdSchema.safeParse`
   guard as `listLiveForStudent` right above it; same four-table join, but the `agents` join
   condition is `ne(agents.status, 'live')` instead of `eq(..., 'live')`, and the `where` keeps
   `ne(subscriptions.status, 'ended')`. Reuses the file's existing imports (`ne` is already
   imported). Doc comment cross-references `listLiveForStudent` and says why this is a *different*
   method rather than a flag on it: the live-classes question route's candidate list
   (`apps/web/app/api/live-classes/[id]/questions/handlers.ts`, out of bounds) must keep today's
   behaviour unchanged.
3. Tests (tests first):
   - `packages/db/test/teacher-profiles.test.ts` (unit): `findBySlugForStaff` with a malformed
     `by` or `slug` is `invalid`/`scope` before any SQL (mirrors the file's existing unit cases).
   - `packages/db/test/teacher-profiles.int.test.ts`: finds a `pending`, a `verified` and a
     `rejected` teacher by slug; an unknown slug is `null`; a non-staff `by` is `scope`; **the
     acceptance case**: a verified-teacher fixture found by slug, then safety-rejected exactly as
     9.3e's existing pending-fixture case, same assertions (agent suspended, takedown row,
     `agents.owner` null).
   - `packages/db/test/scope.test.ts`: `listUnavailableForStudent` gets the same bare-id exception
     entry as `listLiveForStudent` (same file, right next to it) plus its own "rejects a malformed
     student id before any SQL" case.
   - `packages/db/test/repositories.int.test.ts`: one grid case each for `findBySlugForStaff` and
     `listUnavailableForStudent`, same shape as the neighbouring `listPendingForStaff` /
     `listLiveForStudent` entries (own-rows-only, cross-teacher isolation).
   - Coverage: `src/repositories/**` stays at 100% statements/functions/lines.
   - Run: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`; secret scan.
   State after Phase A: both reads exist and are proven over Postgres; nothing user-facing changes
   yet (no caller exists until Phases B and C).

### Phase B — apps/web: staff console reaches a verified teacher (risky: `apps/web/app/api/staff/**`)

4. `apps/web/app/api/staff/verifications/handlers.ts` — add `lookup: Handler`: reads
   `req.nextUrl.searchParams.get('slug')`, 400 if missing/empty; calls
   `backend.repos().teacherProfiles.findBySlugForStaff(ctx.principal.userId, slug)`; `200
   {teacher: LookupItem | null}` (add `LookupItem` = `QueueItem & {verificationStatus:
   'pending'|'verified'|'rejected'}`, add `toLookupItem`); same `RepositoryError` → `scope`/`invalid`
   → 403/400 mapping as `list`/`decide`. `decide` and `list` are unchanged — rejecting a
   `teacherId` that is not currently pending was already a valid call before this task.
5. `apps/web/app/api/staff/verifications/lookup/route.ts` (new file) — `export const GET =
   withRole(['staff'], handlers.lookup)`, same shape as the existing `route.ts`.
6. `apps/web/app/staff/client.ts` — `LookupItemSchema`/`LookupItem` type; `findTeacherBySlug(slug,
   fetchImpl?)` hitting the new route, same settle-never-reject shape as `loadQueue`/`decide`.
7. `apps/web/app/staff/view.tsx` — a search box (slug text input + "Find" button) above the queue
   list: own busy/error/found state, same try/catch/finally pattern as `onDecide`/`onReload`. A
   found teacher renders through the existing `VerificationRow` (item has no row-specific changes
   needed beyond what it already renders); `onDecide` for it reuses the same `decide` call as the
   queue, and on success clears `found` and shows the existing `notice` (approved/rejected/
   rejectedSafety) — no new notice copy. `VerificationRow`'s heading gains the current status
   (e.g. a `dt`/`dd` pair) **only when rendered from a lookup result** (an optional prop,
   `currentStatus?: 'pending'|'verified'|'rejected'`), so staff see what they are about to change;
   the pending-queue list passes nothing (always `pending`, as today).
8. `apps/web/messages/en.json` (`staff`): `lookupLabel: "Find a teacher by their profile URL"`,
   `lookupPlaceholder: "profile-url-slug"`, `lookupButton: "Find"`, `lookupBusy: "Looking…"`,
   `lookupNotFound: "No teacher has that profile URL."`, `currentStatusLabel: "Current status"`,
   `status.pending`/`status.verified`/`status.rejected` (reuse `staffAgents.status.*` wording
   style if convenient, but these are a new key family under `staff`).
9. Tests (tests first): `route.test.ts` (`lookup`: finds pending/verified/rejected by slug, 200
   `{teacher: null}` for unknown, 400 for a missing/blank slug param); `route.int.test.ts` (one
   real round trip: find a **verified** teacher by slug, then POST a safety rejection for that
   `teacherId` — 200, audit `after` carries `safety: true`); `client.test.ts` (found/not-found/
   400/network-failure shapes); `view.test.tsx` (type a slug, Find, see the row with its current
   status; tick the safety box, Reject, see `safety: true` sent and the `rejectedSafety` notice;
   Find again after an unknown slug shows `lookupNotFound`; axe clean).
   Run: `corepack pnpm turbo run turbo run typecheck lint test --filter=@edmate/web...`; secret scan.

### Phase C — apps/web: `/home` stops silently dropping a chat (B-49, not risky by path)

10. `apps/web/src/chat/liveChats.ts` — `LiveChatDeps` gains `subscriptions.listUnavailableForStudent
    (studentId: string): Promise<readonly {agentId: string; teacherId: string}[]>`; `homeLinks`
    calls it alongside `listLiveForStudent`, dedupes agent ids, and returns a new `unavailable:
    string[]` field on `HomeLinks` (and `EMPTY`). A failure here follows the function's existing
    single catch-and-log-and-return-EMPTY shape — it does not get its own try/catch (one extra
    failure mode for one more field is not worth splitting the function's error handling).
11. `apps/web/app/home/page.tsx` — thread `unavailable` from `homeLinks` into `<HomeView
    unavailable={unavailable} ... />`.
12. `apps/web/app/home/view.tsx` — `unavailable?: readonly string[]` prop; when non-empty, one
    paragraph (not a per-agent list — no teacher detail, same precedent as the takedown texts,
    12.2 Q6): `t('unavailableLine', {count: unavailable.length})`. Placed after the existing
    chats/startable/paused block, so a student who has both an active chat and an unavailable one
    sees both.
13. `apps/web/messages/en.json` (`home`): `unavailableLine: "{count, plural, one {One of your
    teachers' agents isn't available right now.} other {{count} of your teachers' agents aren't
    available right now.}}"` (matches the ICU plural shape already used elsewhere in this file —
    confirm the exact syntax `next-intl` expects before writing it, from a sibling key).
14. Tests (tests first): `apps/web/src/chat/liveChats.test.ts` (a subscription whose agent is
    `suspended` appears in `unavailable`, not `chats`; a `draft` agent too; `ended` subscriptions
    stay excluded from everything; the failure-returns-EMPTY case still returns `unavailable: []`);
    `apps/web/app/home/view.test.tsx` (the new paragraph renders for 1 and for 2+, with the right
    plural copy; absent when `unavailable` is empty or omitted); `apps/web/app/home/page.test.tsx`
    if it stubs `homeLinks`'s shape (update the stub to include `unavailable`).
    Run: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`; secret scan.

## Files out of bounds

Given for this task: `packages/db/src/repositories/sessions.ts`, `packages/db/migrations/0028*`,
`packages/db/src/migrate.ts`, `packages/db/src/schema/learning.ts`, `apps/web/src/turn/**`,
`apps/web/src/auth/**`, `packages/harness/**`.

Also out of bounds for this plan (no change needed, and some are actively risky to touch):
`packages/contracts/**` (no new error code or port), `packages/db/src/repositories/{agents,ports,
publish}.ts` (no change to what counts as a live/ownable agent — that is exactly the mechanism
that keeps a suspended agent refused everywhere; widening it is the Q5 follow-up, not this task),
`apps/web/app/learn/**` (the chat and plan pages keep 404ing on a suspended agent, as 12.2/9.3e
decided — Q5), `apps/web/app/api/live-classes/**` (its candidate-teacher list stays
`listLiveForStudent`, unchanged), `apps/web/app/staff/agents/**`, `apps/web/app/staff/reports/**`,
`apps/web/app/api/staff/{agents,takedowns,reports,alerts}/**` (unrelated consoles), any migration
(none needed).

## Risky paths touched (checked against risk-paths.txt)

- `packages/db/src/repositories/teacher-profiles.ts`, `packages/db/src/repositories/subscriptions.ts`
  (Phase A) — group "access filter / money / data isolation" (`packages/db/src/repositories/**`):
  required reviewer `security-reviewer`. Recommended as well: `database-reviewer` (new joins over
  student/subscription/agent data — no new locks, but it is exactly the access-filter surface),
  `code-reviewer`, `typescript-reviewer`.
- `apps/web/app/api/staff/verifications/handlers.ts` + the new `lookup/route.ts` (Phase B) — same
  group (`apps/web/app/api/staff/**`): required `security-reviewer`; plus `code-reviewer`.
- Not risky by path: `apps/web/app/staff/**` (console UI), `apps/web/app/home/**`,
  `apps/web/src/chat/liveChats.ts`, `apps/web/messages/en.json`, `packages/db/test/**`, this plan.
  No contracts, ADR, harness, locale or migration change.
- Each of Phase A and Phase B's handoff logs a `risk: high` decision (below); Phase C is not risky
  by path and does not need one (though a short decision note is still good practice).

## Decisions to log (handoff `## Decisions`, risk: high on Phases A and B)

1. "`setVerification({safety:true})` already worked from any starting `verificationStatus`
   (9.3e); the security review's MEDIUM was a console gap, not a repository one. Fixed with a new
   staff-only `findBySlugForStaff` (status-independent) and a `lookup` route, both read-only, so a
   verified teacher can now be found and safety-rejected through the existing, unchanged `decide`
   call."
2. "B-49: a subscription whose agent stopped being `live` no longer silently disappears from
   `/home` with zero trace. A new read-only `listUnavailableForStudent` (deliberately separate
   from `listLiveForStudent`, which also feeds the live-classes question route unchanged) surfaces
   it as one blame-free line, no teacher name, no link — pause/cancel while suspended and the
   chat/plan pages' 404 are unchanged (Q5, deferred: no payment is live yet, so nobody is billed
   for an agent they can't reach)."

## Open questions (all non-blocking; recommendations are what the plan builds)

- Q1 Should the slug lookup also find an already-`rejected` teacher (not just verified)? Recommended
  yes — uniform, and lets staff add a safety flag to a teacher who was already plainly rejected.
- Q2 A separate `lookup` route vs. a `?slug=` query param on the existing queue GET? Recommended
  separate route (built above) — it can never change the existing queue GET's reply shape for any
  current caller.
- Q3 Home-card wording: one aggregate line (built above) vs. a per-agent list? Recommended
  aggregate — matches 12.2 Q6's "blame-free, no teacher detail", and needs no teacher slug lookup
  on `/home`.
- Q4 Two items from this board task's own title are deferred, not built here: the staff queue/
  lookup row showing a teacher's active takedowns and last decision (so staff aren't surprised by
  reopening a safety-rejected teacher who edited their subject back to `pending`), and keeping a
  subject-edit history. Recommended: open a new board task (e.g. `9.3h`) for both after this
  merges — neither blocks the acceptance line, and 9.3e's lift rule (verified-only) already
  prevents a *routine* lift from reopening access even without this visibility.
- Q5 Pause/cancel for a subscription whose agent is suspended (today's `/learn/.../plan` 404s,
  same as chat): recommended **defer** to a follow-up task. Reaching it safely needs a careful,
  separate look at how `agents.owner`/the plan page decide "live enough to manage, not live enough
  to chat" — that is exactly the kind of change 9.3e kept out of its own scope, and no payment is
  live yet, so no student is being billed for access they can't reach. Not pilot-blocking per the
  lead's MVP-first instruction for this task.

## Budget

Budget: 230 tool calls (3 phases, packages/db + apps/web)

Phase A: 70. Phase B: 90. Phase C: 70. Each phase is a fresh builder reading this plan and the
previous phase's handoff; each ends with a green commit on its own branch/PR
(`m13/9.3f-a-staff-slug-lookup-db`, `m13/9.3f-b-staff-console-lookup`, `m13/9.3f-c-home-unavailable`).
No phase waits on another builder outside this task.

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for the touched package, the secret
scan, git add/commit/push on the task branch only).

## Exit conditions

- `Status: DONE` for a phase: its tests above exist and pass (tests first), the touched package's
  typecheck, lint and test are green with the db coverage threshold met (Phase A), secret scan
  clean, handoff written with `Tool calls used:` and (Phases A/B) the `risk: high` decision.
- Stop at `Status: PARTIAL` when past ~90 calls in a phase, when a file outside this plan needs a
  change (name it), when the grid tests (`repositories.int.test.ts`, `scope.test.ts`) turn out to
  need a different shape than described, or when coverage cannot reach the threshold without
  touching an out-of-bounds file.

## Lead answers (24 Oct 2026)
1. Q1: yes, the lookup also finds `rejected` teachers.
2. Q2: separate `lookup` route, as planned.
3. Q3: one aggregate line, no teacher detail, as planned.
4. Q4: deferred. The lead opens board task 9.3h (queue/lookup row shows active takedowns and the last decision; subject-edit history) after this merges.
5. Q5: deferred. The lead opens board task 9.3i (pause/cancel for a subscription whose agent is suspended).
6. One task, one branch, one PR: all three phases build in order on `m13/9.3f-staff-verified-reject` (not three branches). Each phase is a fresh Sonnet builder that reads this plan and the handoff so far. Phase budgets 70 / 90 / 70; stop PARTIAL at 90 / 110 / 90.
7. Reviewers at the end: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer.

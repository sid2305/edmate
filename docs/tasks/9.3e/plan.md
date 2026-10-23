# 9.3e plan — a safety-reason rejection cuts the teacher's students' access at once

Status: READY

## Acceptance (verbatim from the board)

> after a staff rejection with a safety reason, the rejected teacher's agents refuse new turns for
> every student, and a test proves it; other rejection reasons still block only new starts.

How it will be shown:
- `packages/db/test/entitlement-store.int.test.ts` (new cases): with `stu_1` actively subscribed to
  `tch_a`'s live agent `agt_a`, a **plain** rejection leaves `entitlementStoreFor(...).resolve({source:
  'subscription'})` returning the entitlement (existing subscriber keeps access) while
  `subscriptions.start` for a new student refuses (9.3c, unchanged); a **safety** rejection makes
  `resolve` return `null` for the same subscribed student (the harness `entitle` step then answers
  `no_access`), `agents.owner({agentId})` return `null` (every web turn route 404s), and leaves the
  subscription row untouched.
- `packages/db/test/teacher-profiles.int.test.ts` (new cases): the safety rejection suspends every
  live agent of that teacher with one `takedowns` row each and audit rows; a plain rejection writes
  no takedown; `safety: true` with `status: 'verified'` is `invalid` with nothing written.
- `apps/web/app/api/staff/verifications/route.test.ts` + `app/staff/view.test.tsx`: the staff
  console's "safety concern" checkbox reaches `setVerification` as `safety: true` on Reject only.

## Context (read before building)

- B-46 (human, 22 Oct 2026): closed pilot keeps (a); before strangers, (c): "cut access at once for
  a safety-reason rejection". This task builds (c) behind GATE; a paperwork rejection stays (a).
- 9.3c (`docs/tasks/9.3c/handoff.md`): `packageVersions.liveForAgent` and `subscriptions.start`
  already refuse a non-verified teacher (new starts blocked). The turn path reads
  `agents.owner`, which **already returns null for a `suspended` agent** (`agents.ts:68-82`), and
  `studentTurnScope` (apps/web/src/turn/scope.ts) 404s on null. 12.2b's agent takedown sets
  `suspended`, and the 12.2 plan (Q6) accepted "students simply can't start turns while it is
  suspended". So the rejection state read at turn time is the agent's status: no migration, no
  change to `ports.ts`, `agents.ts`, `subscriptions.ts` or the harness.
- The rejection `reason` is free text in `audit_log` only. "Safety reason" needs a structured
  signal: a new input flag `safety: true` on `setVerification`, acted on inside its transaction.

## Design (one sentence)

`teacherProfiles.setVerification({status: 'rejected', safety: true})` rejects the profile **and, in
the same transaction, takes down every one of the teacher's live agents** (a `takedowns` row per
agent, category `harmful`, note = the rejection reason, agent set `suspended`, `takedown.create`
audit rows), reusing 12.2b's exact agent-takedown write; everything downstream already refuses a
suspended agent.

Why this over a column/migration: migration 0026 is taken by 11.1d (numbering race), the lead
prefers reading state at turn time, and the takedown row gives staff an audit trail and an
existing lift path (`/api/staff/takedowns`, listed on /staff/reports) for a later reinstatement.

## Files to create / modify

### Phase A — packages/db (risky: `packages/db/src/repositories/**`)

1. `packages/db/src/repositories/takedowns.ts` — extract the agent branch of `create` into an
   exported helper (module-internal; **not** re-exported from `index.ts`, so no grid case):
   `takeDownAgentInTx(tx, { staff, agent: { id, teacherId, status, liveVersion }, category, note })`
   → inserts the `agent:<id>` row (`active`, first staff action `create`), sets the agent
   `suspended`, writes the `takedown.create` audit row (same `before`/`after` shape as today,
   `reportId: null` when none), returns `{ id }`. `create` calls it after its own checks (report
   handling stays in `create`); behaviour and existing tests unchanged. Add one line to the file's
   lock-order header: "`teacherProfiles.setVerification` (9.3e) also calls `takeDownAgentInTx`,
   after locking role → profile → agents (ascending id): profile before agent, as publish does."
2. `packages/db/src/repositories/teacher-profiles.ts`
   - `VerificationInput` gains `safety: z.boolean().optional()` and a `.refine(v => v.safety !== true
     || v.status === 'rejected')` (a `safety: true` approve is `invalid` before any SQL).
   - `setVerification`: after the profile UPDATE and the `teacher.verify` audit row (its `after`
     gains `safety: true` when set), when `v.safety`: `select id, teacher_id, status, live_version
     from agents where teacher_id = $teacher and status = 'live' order by id for update`, then for
     each row `takeDownAgentInTx(tx, { staff: v.by, agent, category: 'harmful', note: v.reason ??
     null })`. Zero live agents is fine (rejection only). Return value unchanged.
   - Doc comment: lock order role (share) → profile (update) → agents asc id (update) → takedown
     rows; why it cannot cycle with `publish` (advisory, profile, agent, run) or `takedowns.create`
     (role, agent, takedown, report): profile always before agent, agent before takedown.
   - Callers unchanged: `cli.ts` verify-teacher, the staff handler (Phase B adds the flag), tests.
3. Tests (tests first):
   - `packages/db/test/teacher-profiles.test.ts` (no-DB unit): `safety: true` + `verified` →
     `invalid`; `safety: 'yes'` → `invalid`; both before any SQL.
   - `packages/db/test/teacher-profiles.int.test.ts`: a fixture teacher (raw SQL like
     `takedowns.int.test.ts`'s `makeTeacher`, verified, two live agents + one draft); safety
     rejection → profile `rejected`, both live agents `suspended`, draft untouched, two
     `takedowns` rows (`agent:<id>`, `reason = 'harmful'`, `status = 'active'`, staff action note =
     reason), audit rows = 1 `teacher.verify` (after `{verificationStatus:'rejected', safety:true}`)
     + 2 `takedown.create`; plain rejection → agents stay `live`, no takedown row, audit `after` has
     no `safety` key; safety rejection with no live agent → rejection only; a non-staff `by` with
     `safety: true` → `scope`, nothing written (count rows before/after).
   - `packages/db/test/entitlement-store.int.test.ts`: insert a staff user and a verified
     `teacher_profiles` row for `tch_a` in the test (access-seed has none); the acceptance cases
     listed under "How it will be shown"; restore the agent/profile state afterwards (other cases
     in the file reuse `agt_a`), or put the cases last in the file.
   - Coverage: `src/repositories/**` must stay at 100% statements/functions/lines; every new
     branch (refine fail, zero agents, N agents) has a case.
   - Run: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`; secret scan.
   State after Phase A: a safety rejection through the repository cuts access end to end; the
   staff API still cannot send the flag (a strict body refuses it), so nothing user-facing changes.

### Phase B — apps/web (risky: `apps/web/app/api/staff/**`)

4. `apps/web/app/api/staff/verifications/handlers.ts` — `DecisionBody` gains `safety:
   z.boolean().optional()` with the same refine (→ 400 validation); pass `safety` through to
   `setVerification` only when `true`. Reply shape unchanged.
5. `apps/web/app/staff/client.ts` — `DecideInput.safety?: boolean`; body carries `safety: true`
   only when set (never `false`, never on approve).
6. `apps/web/app/staff/verification-row.tsx` — a checkbox under the reason: label
   `t('safetyLabel')`; `onDecide(status, reason, safety)`; Approve always passes `false`.
7. `apps/web/app/staff/view.tsx` — thread `safety` to `decide`; notice `t('rejectedSafety', {slug})`
   when the request carried `safety`.
8. `apps/web/messages/en.json` (`staff`): `safetyLabel: "Safety concern: also stop every student's
   access to this teacher's agent now"`, `safetyHint: "Use this only for a safety reason. Students
   who already subscribed lose access at once; a paperwork rejection leaves them until their plan
   ends."`, `rejectedSafety: "{slug} was rejected and their agent is no longer available to
   students."`.
9. Tests (tests first): `route.test.ts` (memory repo records `safety`; `safety: true` + `verified`
   → 400; `safety: 1` → 400; approve never carries it), `client.test.ts` (body with and without the
   flag), `view.test.tsx` (checkbox + Reject sends `safety: true`; Approve sends `false`; the
   safety notice text; axe clean), `verification-row` is covered through the view tests.
   `route.int.test.ts`: one safety rejection over Postgres (its teachers have no agents, so it
   proves only "rejected + no error"; the agent proof lives in Phase A).
   Run: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`; secret scan.

## How the student sees the refusal (no code change in this task)

Identical to a 12.2 agent takedown today, all plain and blame-free, naming no teacher detail:
- In an open chat, the next send gets a 404 from `POST /api/sessions/:id/turns` and the chat shows
  `chat.errors.not_found`: "This chat is not available any more. Start a new one." A new session
  (`POST /api/sessions`) 404s too and shows the same line.
- `/learn/<agentId>` and its memory/progress/plan sub-pages render the app's not-found page
  (Next's default; the repo has no `app/not-found.tsx`).
- `/packages/<agentId>` is not found (9.3c). `/home` still lists the subscription (home/page.tsx is
  out of bounds for this task; see Q3).

## Files out of bounds

`packages/db/src/repositories/subscriptions.ts`, `packages/db/test/repositories.int.test.ts`,
`apps/web/src/chat/liveChats.ts`, `apps/web/app/home/page.tsx` (9.4a Phase C);
`packages/db/src/repositories/live-classes.ts`, `packages/db/src/schema/operations.ts`, any
migration (11.1d owns 0026); `packages/contracts/**` (no new error code: `not_found` is reused);
`packages/db/src/repositories/{ports,agents,publish}.ts`, `packages/db/src/schema/**`,
`packages/db/src/repositories/index.ts` (no new repository method: the grid test that lists every
method is in the off-limits file); `packages/harness/**`; `apps/web/src/turn/**`;
`apps/web/src/chat/**`; `packages/db/src/cli.ts` (Q4). Neither phase waits on the other builders.

## Risky paths touched (checked against risk-paths.txt)

- `packages/db/src/repositories/teacher-profiles.ts`, `packages/db/src/repositories/takedowns.ts`
  (Phase A) — group "access filter / money / data isolation": required reviewer
  `security-reviewer`. Recommended as well: `database-reviewer` (a new multi-row locking write;
  lessons "Two writers that lock the same rows in different orders deadlock"), `code-reviewer`,
  `typescript-reviewer`.
- `apps/web/app/api/staff/verifications/handlers.ts` (+ its tests) (Phase B) — same group:
  required `security-reviewer`; plus `code-reviewer`.
- Not risky by path: `packages/db/test/**`, `apps/web/app/staff/**`, `apps/web/messages/en.json`,
  this plan. No contracts, ADR, harness, locale or migration change.
- Each phase's handoff logs a `risk: high` decision (below).

## Decisions to log (handoff `## Decisions`, risk: high)

1. "A safety-reason rejection takes down every live agent of the teacher inside
   `setVerification`'s transaction (takedown rows, category `harmful`), so the existing
   suspended-agent refusal cuts access at once; a plain rejection is unchanged (B-46 (c))."
2. "Re-verifying a safety-rejected teacher does not lift the takedowns; staff lift them on
   /staff/reports, and the teacher cannot publish until then (publish refuses suspended)."
3. "No new error code or student string: the student sees the takedown texts (12.2 Q6)."

## Open questions (all non-blocking; recommendations are what the plan builds)

- Q1 Category for the takedown rows: `harmful` (recommended; `other` is the alternative). Staff
  can still write the real reason in the note.
- Q2 Should a later `verified` auto-lift the takedowns? Recommended no (an explicit lift is an
  explicit decision; mirrors 12.2 lift). Needs no work either way now.
- Q3 Student wording: keep the existing takedown texts (recommended). A dedicated "this teacher is
  no longer available" line needs either a new `ErrorCode` (contracts, ADR) or a home-page card
  change (`home/page.tsx`, out of bounds); fold it into the B-49 follow-up (takedown pauses the
  subscription), which owns both the home card and the pause.
- Q4 `db:verify-teacher` CLI `--safety` flag: out of scope (staff use the console); add a board
  follow-up if ops want it.

## Budget

Budget: 150 tool calls (2 phases, packages/db + apps/web)

Phase A: 80. Phase B: 70. Each phase is a fresh builder reading this plan and the previous
handoff; each ends with a green commit on its own branch/PR (`m13/9.3e-a-safety-rejection-db`,
`m13/9.3e-b-safety-rejection-web`).

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for the touched package, the secret
scan, git add/commit/push on the task branch only).

## Exit conditions

- `Status: DONE` for a phase: its tests above exist and pass (tests first), the touched package's
  typecheck, lint and test are green with the db coverage threshold met, secret scan clean, handoff
  written with `Tool calls used:` and the `risk: high` decision.
- Stop at `Status: PARTIAL` when past ~80 calls in a phase, when a file outside this plan needs a
  change (name it), when the grid test (`repositories.int.test.ts`) turns out to need a case, or
  when coverage cannot reach the threshold without touching an out-of-bounds file.

## Lead answers (22 Oct 2026)
Plan review (security-reviewer, PLAN OK, 1 MEDIUM, 4 LOW) folded in:
1. Q1–Q4: accepted as recommended (category `harmful`; re-verification does not lift takedowns; existing student strings, with a dedicated line and the /home card folded into the B-49 follow-up; no CLI `--safety` flag).
2. MEDIUM, Phase A: `takedowns.lift` (takedowns.ts, around line 305) restores an agent to `live` only when the teacher's profile is `verified`; otherwise the agent goes to `draft` (or the lift returns `invalid`, whichever the code makes simpler; say which in the decision). Add a test: lifting a safety-rejection takedown while the teacher is still rejected does not reopen access. Record it in the Phase A `risk: high` decision.
3. LOW, Phase A: the verification audit row for a safety rejection names the takedown ids (write it after the takedown loop, or add a second audit row), so these takedowns are distinguishable from content takedowns.
4. LOW, Phase A: use translateWrite (and the active-row guard pattern) in the enlarged transaction if setVerification's siblings already do; otherwise note it in the handoff.
5. LOW, deferred: a student cannot pause or cancel via the 404'd plan page (goes into the B-49 follow-up); a subject edit returning a safety-rejected teacher to the queue keeps no history (board follow-up after merge).

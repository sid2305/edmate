# 9.3e handoff — a safety-reason rejection cuts the teacher's students' access at once

**Status:** DONE
**Branch:** `m13/9.3e-safety-rejection` (built on `work-93e-A`)
**Worktree:** `.claude/worktrees/agent-acf26a62ac51c6250`

## Phase A

### Summary
`teacherProfiles.setVerification({ status: 'rejected', safety: true })` now rejects the profile
and, in the same transaction, takes down every one of the teacher's `live` agents through
`takeDownAgentInTx` (a new helper in takedowns.ts, shared with `takedowns.create`): one `harmful`
takedown row per agent (note = the rejection reason, first staff action carries
`source: 'teacher.verify'`), agent set `suspended`, a `takedown.create` audit row each. The
`teacher.verify` audit row is now written after the loop; for a safety rejection its `after` is
`{ verificationStatus, safety: true, takedowns: [ids] }`. `agents.owner` is null for a suspended
agent, so the entitlement store resolves null for an existing subscriber and every turn route
404s. A plain rejection is unchanged (subscribers keep access; new starts already refused, 9.3c).
`safety: true` with `verified` is `invalid` before any SQL (zod refine).

`takedowns.lift` of an agent target now reads the owner's profile `FOR SHARE` before locking the
agent and returns the agent to `live` only when the teacher is `verified`, else `draft` (lead
answer 2; Phase A built "not `rejected`", Phase A2 tightened it to verified-only).

### Files
- `packages/db/src/repositories/takedowns.ts`: `takeDownAgentInTx` (exported, not re-exported
  from index.ts), `create` uses it for agents (report is now locked and checked before the
  takedown row is inserted; same writes, same rows), `lift` profile check, lock-order header.
- `packages/db/src/repositories/teacher-profiles.ts`: `safety` flag + refine, the takedown loop,
  `translateWrite` around the transaction, lock-order doc comment.
- Tests: `test/teacher-profiles.test.ts` (3 unit cases), `test/teacher-profiles.int.test.ts`
  (7 cases: safety rejection with 2 live + 1 draft, plain rejection, no live agent, an agent
  already taken down / stale active row, non-staff and self `scope` with nothing written,
  `safety` on approval `invalid`, re-verify lifts nothing), `test/entitlement-store.int.test.ts`
  (acceptance: plain keeps stu_1's entitlement and refuses a new start; safety makes `resolve`
  null and `agents.owner` null with the subscription row untouched; a lift while still rejected
  leaves the agent `draft` and access closed), `test/takedowns.int.test.ts` (fixture profiles A/B
  now `verified`; lift while rejected → draft, while pending → live).

### Acceptance evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --force --continue` →
  `@edmate/db:test:  Test Files  74 passed (74)` /
  `Tests  1461 passed | 4 skipped (1465)` (no file skipped for "no Postgres"; the 4 are
  per-test skips in retrieval-hnsw, recall, video-ingest) /
  `src/repositories  |  100 | 98.36 | 100 | 100` / `takedowns.ts | 100 | 100 | 100 | 100` /
  `Tasks:    26 successful, 26 total`.
- The first `--force` run without `--continue` failed on timing tests in untouched packages under
  machine load (`packages/harness`: "runs in linear time on long hostile input", "a soft hit
  never escalates through the raw-text check alone"; `packages/content`: "the timing probe ...
  catches `a?` x25 then `a` x25, anchored"); they passed on the re-run above.
- `python3 .githooks/secret-scan.py --all` → clean.

### Deviations
- **Lift rule narrowed (lead answer 2).** The lead asked for "restore `live` only when the
  profile is `verified`". That breaks two cases in `packages/db/test/repositories.int.test.ts`
  (the grid, out of bounds: `takedowns.create`/`takedowns.lift` lines ~3854-3875 expect a lift to
  bring back `live` for seed teachers that have no profile). Built instead: `draft` when the
  teacher is `rejected`, `live` otherwise. That closes the reviewer's scenario (lift while still
  rejected), but not the path "safety-rejected teacher edits subject → `pending` → staff lift →
  `live`". Superseded by Phase A2 (verified-only, built below).
- Audit LOW (lead answer 3): built as "teacher.verify written after the loop, naming the takedown
  ids" plus a `source: 'teacher.verify'` key on the takedown's first staff action.
- translateWrite LOW (lead answer 4): `setVerification` now runs inside `translateWrite`, like its
  siblings `create` and `takedowns.create`. The active-row guard: a live agent that already has
  an active takedown row (stale state) is set `suspended` and its existing id reported; no second
  active row is written.

## Phase A2 (lead decision: verified-only lift)

### Changes
- `packages/db/src/repositories/takedowns.ts`: `lift` sets `unverified = profile?.status !==
  'verified'` (was `=== 'rejected'`); an agent goes back to `live` only for a verified teacher,
  otherwise (no profile, pending, rejected) `draft`. Same FOR SHARE profile read before the agent
  lock; header and doc comments updated.
- `packages/db/test/takedowns.int.test.ts` (tests first, red then green): the lift `it.each`
  `pending` row now expects `draft` and `agents.owner` null; new case "a safety-rejected teacher
  who edits their subject (pending) stays off after a lift": `setVerification({safety: true})`,
  `teacherProfiles.update({subject})` → `pending`, staff lift → agent `draft`, owner null.
- `packages/db/test/repositories.int.test.ts` (cleared by the lead): a `withVerifiedProfile(t, fn)`
  helper upserts a verified profile for isolation teacher A/B around the lift in the grid's
  `takedowns.create` / `takedowns.lift` cases and restores the previous state afterwards (deleted
  when there was none), since A/B's profile churns across the grid. Assertions unchanged.

### Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force` → see Gate below
  (takedowns.int.test.ts was red on the two flipped/new cases before the change: `expected
  { status: 'live' } to deeply equal { status: 'draft' }`).

## Phase B (apps/web: staff safety flag)

### Changes
- `apps/web/app/api/staff/verifications/handlers.ts`: `DecisionBody` gains `safety:
  z.boolean().optional()` with `.refine(safety !== true || status === 'rejected')` (400
  `validation`); `safety: true` is passed to `setVerification` only when `true`. Reply unchanged.
- `apps/web/app/staff/client.ts`: `DecideInput.safety?: boolean`; the body carries `safety: true`
  only on a rejection that sets it (never `false`, never on approve).
- `apps/web/app/staff/verification-row.tsx`: a "safety concern" checkbox (row state) under the
  reason, described by a hint line (`aria-describedby`); Reject passes it, Approve always `false`.
- `apps/web/app/staff/view.tsx`: threads `safety` to `decide`; a safety rejection shows
  `rejectedSafety`.
- `apps/web/messages/en.json` (`staff`): `safetyLabel`, `safetyHint`, `rejectedSafety` (plan
  wording).
- Tests (written first): `route.test.ts` (safety passed and audited; `safety: false` not passed;
  `safety` on approval, numeric, string, null → 400), `client.test.ts` (body with/without the
  flag, approve never carries it), `view.test.tsx` (checkbox + hint; Reject sends `safety: true`
  and shows the safety notice; Approve with the box ticked sends `false`; tick+untick is plain;
  existing calls now include `safety: false`; axe case unchanged and clean), `route.int.test.ts`
  (one safety rejection over Postgres: 200, audit `after` `{verificationStatus: 'rejected',
  safety: true, takedowns: []}`). The int test was run once against a throwaway database
  (`TEST_DATABASE_URL=.../edmate_93e_web`, dropped afterwards): `Tests 7 passed (7)`.

## Gate (Phase A2 + B)
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force` →
  `Test Files  74 passed (74)` / `Tests  1463 passed | 4 skipped (1467)` (no file skipped; the 4
  are the existing per-test skips) / `src/repositories | 100 | 98.36 | 100 | 100` /
  `takedowns.ts | 100 | 100 | 100 | 100` / `Tasks: 8 successful, 8 total`.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force` →
  `Test Files  143 passed | 4 skipped (147)` / `Tests  2173 passed | 26 skipped (2199)` /
  `Tasks: 10 successful, 10 total`. The 4 skipped files are the staff int tests that need
  `TEST_DATABASE_URL` (unset locally, set in CI); the verifications one was run separately above.
- `python3 .githooks/secret-scan.py --all` → clean (exit 0).

## Left to do (board follow-ups)
- B-49 follow-up (lead answers 1 and 5): a dedicated student line / home card for a teacher whose
  agent is taken down, and pause/cancel reachable for a suspended agent's subscription.
- Queue row shows a teacher's active takedowns / last decision, so a safety-rejected teacher who
  edits their subject back to `pending` is not approved unaware (security review LOW).

## Decisions

### 22 Oct 2026 · 9.3e Phase A: safety rejection takes down live agents in packages/db/src/repositories · decided by builder · risk: high
- Decided: `setVerification` takes a `safety: true` flag (rejections only; refine makes it `invalid` on approval) and, in its transaction, takes down every live agent of the teacher via the new module-internal `takeDownAgentInTx` (category `harmful`, note = reason, agent `suspended`, audited; lock order role → profile → agents asc id → takedown rows). The `teacher.verify` audit row names the takedown ids. A re-verification lifts nothing. `takedowns.lift` returns an agent to `live` only when its teacher's profile is `verified`; with no profile, `pending`, `rejected` or any other state it returns it to `draft` (profile read FOR SHARE before the agent lock). Phase A first built "not `rejected`"; the lead kept verified-only and Phase A2 built it, so a safety-rejected teacher who edits their subject (back to `pending`) can't be reopened by a routine lift. A plain rejection is unchanged. The student sees the existing takedown texts; no new error code.
- Why: B-46 (c): a safety rejection must cut existing subscribers off at once; every student path already refuses a non-live agent, so reusing 12.2b's takedown write needs no migration, contract or harness change and gives staff an audit trail and lift path. The lift rule closes the security review's MEDIUM (a routine lift reopening a rejected teacher).
- risk: high

### 22 Oct 2026 · 9.3e Phase A: takedowns.create checks a linked report before inserting the takedown row · decided by builder · risk: low
- Decided: to share the agent write with setVerification, `create` now locks and checks the linked report before inserting the takedown row (it used to insert first). Same rows and audit rows are written; a bad report still writes nothing (the transaction rolls back either way).
- Why: the helper writes the takedown row and its audit row together; the new row is invisible to other transactions, so the contended lock order (role → target → report) is unchanged.
- risk: low

### 22 Oct 2026 · 9.3e Phase B: staff safety flag in apps/web/app/api/staff/verifications · decided by builder · risk: high
- Decided: the staff verification API accepts an optional `safety` boolean on a decision; `safety: true` is valid only with `status: 'rejected'` (else 400 `validation`) and is passed to `setVerification` only when `true`, so `false` and an absent key are the same plain rejection. The staff console adds a "safety concern" checkbox per row (with a hint saying existing subscribers lose access at once); Reject sends it, Approve always sends `false`, the client only puts `safety: true` in the body on a rejection, and a safety rejection shows its own notice. The body stays strict and `by` is still the session's principal.
- Why: B-46 (c) needs staff to mark a rejection as safety-related; the refine mirrors the repository's own so a bad combination never reaches SQL, and dropping `false` keeps a plain rejection's call and audit row exactly as before.
- risk: high

Tool calls used: 33
Phase A2+B tool calls: 52

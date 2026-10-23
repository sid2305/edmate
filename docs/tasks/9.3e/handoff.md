# 9.3e handoff — a safety-reason rejection cuts the teacher's students' access at once

**Status:** DONE (Phase A; Phase B left to do)
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
agent and returns the agent to `draft` (not `live`) while the teacher is `rejected` (lead answer 2,
narrowed: see Deviations).

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
  `live`". See Left to do.
- Audit LOW (lead answer 3): built as "teacher.verify written after the loop, naming the takedown
  ids" plus a `source: 'teacher.verify'` key on the takedown's first staff action.
- translateWrite LOW (lead answer 4): `setVerification` now runs inside `translateWrite`, like its
  siblings `create` and `takedowns.create`. The active-row guard: a live agent that already has
  an active takedown row (stale state) is set `suspended` and its existing id reported; no second
  active row is written.

## Left to do
- Phase B (apps/web: staff API flag, client, checkbox, notice, messages) per plan.
- Tighten the lift rule to verified-only: change `rejected = profile?.status === 'rejected'` to
  `profile?.status !== 'verified'` in `takedowns.lift`, give the isolation teachers in the grid's
  `takedowns.create`/`takedowns.lift` cases a verified profile (repositories.int.test.ts), and
  flip the `pending` row of the lift `it.each` in takedowns.int.test.ts to `draft`/`null`. Needs
  the lead to clear the out-of-bounds file (9.4a Phase C owns it).

## Decisions

### 22 Oct 2026 · 9.3e Phase A: safety rejection takes down live agents in packages/db/src/repositories · decided by builder · risk: high
- Decided: `setVerification` takes a `safety: true` flag (rejections only; refine makes it `invalid` on approval) and, in its transaction, takes down every live agent of the teacher via the new module-internal `takeDownAgentInTx` (category `harmful`, note = reason, agent `suspended`, audited; lock order role → profile → agents asc id → takedown rows). The `teacher.verify` audit row names the takedown ids. A re-verification lifts nothing. `takedowns.lift` returns an agent to `draft`, not `live`, while its teacher is `rejected` (profile read FOR SHARE before the agent lock); verified-only is left to do because the grid test is out of bounds. A plain rejection is unchanged. The student sees the existing takedown texts; no new error code.
- Why: B-46 (c): a safety rejection must cut existing subscribers off at once; every student path already refuses a non-live agent, so reusing 12.2b's takedown write needs no migration, contract or harness change and gives staff an audit trail and lift path. The lift rule closes the security review's MEDIUM (a routine lift reopening a rejected teacher).
- risk: high

### 22 Oct 2026 · 9.3e Phase A: takedowns.create checks a linked report before inserting the takedown row · decided by builder · risk: low
- Decided: to share the agent write with setVerification, `create` now locks and checks the linked report before inserting the takedown row (it used to insert first). Same rows and audit rows are written; a bad report still writes nothing (the transaction rolls back either way).
- Why: the helper writes the takedown row and its audit row together; the new row is invisible to other transactions, so the contended lock order (role → target → report) is unchanged.
- risk: low

Tool calls used: 33

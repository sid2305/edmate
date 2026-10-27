# Handoff: 9.3g

Status: PARTIAL (Phase A done, Phase B left)

## Phase A

`packages/db` changes for the three db-side review LOWs plus the `agentStatus` / `agentsTakenDown`
fields Phase B needs.

- `packages/db/src/repositories/takedowns.ts`
  - Exported the module-local `staffAction` helper (`export const staffAction = ...`), no
    behaviour change.
  - `lift`'s resolved value now carries `agentStatus: 'draft' | 'live'` when the target was an
    `agent` (never for a `document`): `{ id, status: 'lifted', agentStatus? }`.
  - Red: `packages/db/test/takedowns.int.test.ts`'s existing lift test expected `{ id, status:
    'lifted' }` only -- failed once I added `agentStatus: 'live'` to the expectation, before the
    code change.
  - Green: same test now passes with `agentStatus: 'live'`; new tests below cover `'draft'`.

- `packages/db/src/repositories/teacher-profiles.ts`
  - `setVerification`'s stale-active-row branch (inside the `safety: true` loop, `if (active) {
    ... continue; }`) now, before `continue`: appends one staff-action entry to the *existing*
    takedown row via the exported `staffAction` helper (`actor: v.by, action: 'create', note: v.reason
    ?? null, source: 'teacher.verify'`), and writes one `insertAuditEntry` row (`action:
    'takedown.create'`, `target: agent:<id>`, `before: { status: agent.status, takedown: active.id
    }`, `after: { takedown: active.id, status: 'active', agentStatus: 'suspended', source:
    'teacher.verify' }`), mirroring `takeDownAgentInTx`'s own shape.
  - `setVerification`'s resolved value now carries `agentsTakenDown: number` (`= takenDown.length`),
    via a new exported `VerificationResultRow extends TeacherProfileRow` interface local to this
    file (`toTeacherProfile`/`TeacherProfileRowSchema` in `map.ts` untouched; every other caller of
    `toTeacherProfile` still returns the plain `TeacherProfileRow` shape).
  - Red: extended `packages/db/test/teacher-profiles.int.test.ts`'s three tests (`suspends every
    live agent...`, `a safety rejection with no live agent...`, `an agent already taken down is not
    taken down twice`) to assert `row.agentsTakenDown`, the stale row's `staff_actions`, and a new
    `takedown.create` audit row for the stale agent -- all failed (undefined / missing) before the
    code change.
  - Green: all three now pass. Note: in the "already taken down" test, `t.live[0]` already got
    suspended by the earlier direct `repos.takedowns.create` call, so `setVerification`'s own
    `status = 'live'` filter only picks up `t.live[1]` (the stale one) -- `agentsTakenDown` is `1`,
    not `2` (adjusted the test's expectation after seeing the real count, matching the code's
    documented behaviour, not a bug).

- `packages/db/src/repositories/README.md` ("Takedowns" section): added a sentence that `lift`'s
  resolved value now carries the restored `agentStatus` for an agent target, a note that the
  stale-active-row branch writes its own `takedown.create` audit row and staff action on the
  existing takedown, and a cross-reference that `setVerification`'s safety rejection shares the
  agent row in the same lock order as `publish` and `takedowns`, proven against both `goLive` and
  `create` (see tests below).

- `packages/db/test/takedowns.int.test.ts`:
  - Updated the exact-equality assertion on the first agent-lift test to add `agentStatus: 'live'`.
  - New test: an agent whose target has no `teacher_profiles` row at all (raw-inserted user +
    live agent, no profile row) restores to `draft` on lift, resolved value carries `agentStatus:
    'draft'`.
  - New `makeLiveTeacher()` helper (`makeTeacher` + raw `update agents set status='live',
    live_version=1`), since `setVerification(safety)` only locks agents already `status = 'live'`
    for that teacher.
  - New two-connection forced-order tests, reusing `lockWaiters`/`settle`:
    - `setVerification(safety)` vs `publish.goLive`: when `goLive` goes first it succeeds
      (`agentVersion: 2`) and the rejection then suspends the republished agent
      (`agentsTakenDown: 1`); when the rejection goes first, `goLive`'s own `lockVerified` (profile
      `FOR SHARE`, taken before the agent) blocks on the rejection's still-uncommitted profile
      update, and once it unblocks the teacher is no longer verified, so `goLive` is refused with
      `kind: 'scope'` *before* it ever reaches the agent-suspended check (not `PublishRefusedError`
      -- confirmed by running it red first with the wrong expectation, then fixing the assertion to
      match the real lock interaction, not the code).
    - `setVerification(safety)` vs `takedowns.create` (agent kind): when `create` goes first it
      makes its own takedown and suspends the agent, so the rejection's `status = 'live'` filter
      never selects it (`agentsTakenDown: 0`, no stale-row branch at all); when the rejection goes
      first it makes the takedown itself (`agentsTakenDown: 1`), and the direct `create` call then
      sees an already-active takedown on the same target and is `RepositoryError('invalid')`.
    - Both pairs proven in both queue orders, no deadlock, agent ends `suspended` either way.

- `packages/db/test/repositories.int.test.ts` and `packages/db/test/verify-teacher-cli.test.ts`:
  minimal knock-on fixes so the gate stays green now that `lift` and `setVerification` return
  additive fields -- not in the plan's file list, but required by the type change (see Decisions).

## Left to do

Phase B (apps/web), per the plan's Phase B section:
- `packages/db`'s `takedownsRepo.lift` resolves `{ id: string; status: 'lifted'; agentStatus?:
  'draft' | 'live' }` -- `agentStatus` present only for an agent-kind lift.
- `teacherProfilesRepo.setVerification` resolves a `VerificationResultRow` (plain
  `TeacherProfileRow` fields plus `agentsTakenDown: number`, always present, `0` when nothing was
  taken down or the decision was not a safety rejection).
- Phase B threads these into `apps/web/app/api/staff/takedowns/handlers.ts`,
  `apps/web/app/staff/reports/{client.ts,view.tsx}`, `apps/web/messages/en.json`,
  `apps/web/app/api/staff/verifications/handlers.ts`, `apps/web/app/staff/{client.ts,view.tsx}`,
  and their tests, exactly as the plan's Phase B file list describes. No `apps/web` file was
  touched in this phase.

## Decisions

### 27 Oct 2026 · 9.3g export VerificationResultRow · decided by builder · risk: low
- Decided: exported the new `VerificationResultRow` interface from `teacher-profiles.ts` (the plan
  only said "define a local interface").
- Why: `packages/db`'s declaration build (`tsc -p tsconfig.build.json`) fails with TS4058 if an
  exported function's inferred return type uses an unexported type name (`createRepositories`'s
  return type includes it). Exporting the interface is the minimal fix; it does not change
  `map.ts`'s shared `TeacherProfileRowSchema`/`toTeacherProfile`, and no other caller's return type
  changed.

### 27 Oct 2026 · 9.3g knock-on test fixes outside the plan's file list · decided by builder · risk: low
- Decided: updated `packages/db/test/repositories.int.test.ts` (one `toEqual` on `takedowns.lift`)
  and `packages/db/test/verify-teacher-cli.test.ts` (the fake `setVerification`'s return type/value)
  to match the new additive fields, instead of leaving the gate red.
- Why: both files assert the exact resolved-value shape of `lift`/`setVerification` and fail to
  typecheck or pass once those shapes gained fields; the plan's file list did not anticipate every
  caller, but fixing the assertions (not the behaviour) is the only way to keep
  `--filter=...@edmate/db` green, and both changes were adding a field to an expectation, not
  changing what was being tested.

### 27 Oct 2026 · 9.3g lock-order test outcomes decided from the real code, not assumed · decided by builder · risk: low
- Decided: the `setVerification(safety)` vs `publish.goLive` two-connection test's "rejection
  queued first" branch asserts `goLive` fails with `RepositoryError('scope')`, not
  `PublishRefusedError('suspended')`; the `agentsTakenDown` count in the "already taken down twice"
  teacher-profiles test is `1`, not `2`.
- Why: both are `publish.ts`'s own lock order (`lockVerified` reads the profile `FOR SHARE` before
  the agent) and `setVerification`'s own `status = 'live'` filter (an agent already suspended by an
  earlier call is no longer selected) -- not open questions, confirmed by running the test red
  first with the plan-writer's natural guess and reading the actual failure.

## Gate

- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` --
  green except `apps/cli`'s `test/chatDbRetrieval.int.test.ts`, which failed twice under the shared
  Postgres load from this same run (`error: terminating connection due to administrator command` /
  `Connection terminated unexpectedly`), per the brief's known flake. Re-run alone, twice:
  ```
  corepack pnpm --filter @edmate/cli exec vitest run test/chatDbRetrieval.int.test.ts
  Test Files  1 passed (1)
       Tests  1 passed | 1 skipped (2)
  ```
  (confirmed flaky, not a regression -- both standalone runs green).
  `@edmate/db`'s own `test`/`typecheck`/`lint`/`build` all green in every run, including the one
  where only `@edmate/cli#test` failed.
- `corepack pnpm exec prettier --check` on the 7 changed files: one file needed `--write`
  (`packages/db/test/takedowns.int.test.ts`); re-checked clean afterwards, and the affected test
  file re-run green after the format fix.
- `python3 .githooks/secret-scan.py --all`: clean, no output.

## Budget

Phase A tool calls used: 44

# 9.3g plan: 9.3e review LOWs

## Acceptance (verbatim, from the board)
"9.3e review LOWs: the stale-active-row branch in teacher-profiles.ts setVerification writes an
audit row for the agent it suspends and a staff action on the existing takedown; a test for lift
with no teacher profile (draft); a two-connection forced-order test for setVerification(safety)
against goLive and create; lift returns the agent status so the staff reports page can say a
content-takedown lift left the agent in draft (and the README notes it); the rejectedSafety
notice says an agent was taken off only when one was"

Accept: db and web typecheck, lint and test green with the new tests.

Source: docs/tasks/9.3e/review.md LOWs at teacher-profiles.ts:226 (now setVerification's stale
branch, ~`teacher-profiles.ts:360-364`), takedowns.ts:397 (`lift`'s return), takedowns.ts:379
(lift's no-profile branch), takedowns.int.test.ts:748 (no two-connection test for
`setVerification(safety)`), and `apps/web/app/staff/view.tsx:66` (the `rejectedSafety` text).

## How it will be shown
`corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` and
`--filter=@edmate/web...` green, with new/extended tests proving each of the five LOWs (not just
"no regression"): an audit row + staff action on the stale-takedown branch, a no-profile lift
test, a two-connection lock-order test for `setVerification(safety)` vs `goLive` and vs `create`,
`lift`'s resolved value carrying `agentStatus`, and a `StaffQueueView` test showing the plain
`rejected` notice (not `rejectedSafety`) when a safety rejection took down zero agents.

## Two packages, two phases (budget guard)
Item 1-3 are `packages/db` only; items 4-5 need a field threaded db -> API route -> client ->
view in **two different consoles** (`apps/web/app/staff` verifications, `apps/web/app/staff/reports`
takedowns). That is 2 packages and well over 8 files once tests are counted, so this splits into
two phases, each its own builder, green commit and short handoff note.

### Phase A — packages/db (items 1, 2, 3, and the production fields items 4-5 need)
Files:
- `packages/db/src/repositories/takedowns.ts` — export the existing module-local `staffAction`
  helper (no behaviour change, just `export` on its `const`); add an optional `agentStatus:
  'draft' | 'live'` to `lift`'s resolved value (`{ id, status: 'lifted', agentStatus? }`), set
  only when the target was `agent` (never for a `document` lift). Source: the `restored` value
  already computed at `takedowns.ts:397`.
- `packages/db/src/repositories/teacher-profiles.ts` — in `setVerification`'s stale-active-row
  branch (the `if (active) { ... continue; }` block, currently `teacher-profiles.ts:360-364`):
  before `continue`, (a) append one staff-action entry to the *existing* takedown row
  (`takedowns.id = active.id`) via the now-exported `staffAction` helper, mirroring
  `takeDownAgentInTx`'s own shape (`actor: v.by, action: 'create', note: v.reason ?? null,
  source: 'teacher.verify'`), and (b) write one `insertAuditEntry` row for the agent, action
  `'takedown.create'`, target `` `agent:${agent.id}` ``, `before: { status: agent.status,
  takedown: active.id }`, `after: { takedown: active.id, status: 'active', agentStatus:
  'suspended', source: 'teacher.verify' }` (mirror `takeDownAgentInTx`'s own audit shape as
  closely as sensible; exact extra fields are your call, proven by the test below). Also add
  `agentsTakenDown: number` (`= takenDown.length`) to `setVerification`'s resolved value — define
  a local `interface` extending `TeacherProfileRow` in this file (do not touch the shared
  `TeacherProfileRowSchema`/`toTeacherProfile` in `map.ts`; every other caller of `toTeacherProfile`
  must keep returning the plain `TeacherProfileRow` shape).
- `packages/db/src/repositories/README.md` — in the "Takedowns (task 12.2b)" section (around
  line 641, "An agent takedown sets the agent `suspended`... A lift sets `live`..."), add a
  sentence that `lift`'s resolved value now carries the restored `agentStatus` for an agent
  target. Also add a line near the file's `setVerification` note (search "Lock order" /
  "teacher.verify" in this README) that the stale-active-row branch now writes its own
  `takedown.create` audit row and staff action on the existing takedown.
- `packages/db/test/teacher-profiles.int.test.ts` — extend the existing test "an agent already
  taken down is not taken down twice" (currently ~line 463-493): assert the `td_sr_stale` row's
  `staff_actions` now has one entry (actor `STAFF`, `source: 'teacher.verify'`) and that
  `auditFor(t.tid)` now also has a `'takedown.create'` row targeting `` `agent:${t.live[1]}` ``
  (in addition to the one from the real `repos.takedowns.create` call on `t.live[0]`). Also check
  `row.agentsTakenDown` on this and the two sibling tests just above it ("suspends every live
  agent..." and "a safety rejection with no live agent is a rejection only") now that
  `setVerification` returns it (expect `2`, `1`/whatever matches `takenDown.length`, and `0`).
- `packages/db/test/takedowns.int.test.ts`:
  - Update the exact-equality assertion at line ~338 (`resolves.toEqual({ id, status: 'lifted'
    })`) to add `agentStatus: 'live'` (the teacher there is verified).
  - New test: an agent whose target has **no** `teacher_profiles` row at all (not just
    unverified) restores to `draft` on lift and the resolved value carries
    `agentStatus: 'draft'`. Insert a user + a `live` agent via raw SQL with no matching
    `teacher_profiles` insert (same pattern as this file's own `makeTeacher`, minus the profile
    insert), `create` a takedown on it, `lift` it, assert both the DB row and the resolved value.
  - New two-connection forced-order tests for `setVerification(safety)` against `goLive` and
    against `create`, next to the existing `describe('lock order: takedown and publish.goLive on
    one agent never deadlock', ...)` block (~line 748), reusing its `lockWaiters`/`settle`
    helpers and the same "hold the agent row with `raw`, start writer A, wait for 1 lock waiter,
    start writer B, wait for 2, commit, `Promise.all`" shape. `setVerification` only locks agents
    whose `status = 'live'` for that teacher, so the fixture needs a teacher whose agent is
    already `live` *before* the race starts (raw-insert it live, as `teacher-profiles.int.test.ts`'s
    `makeTeacher` does, or call `publish.startRun`/`markRunning`/`goLive` once first) — a brand
    new `draft` agent never gets locked by `setVerification` at all, so it would not actually
    test the lock order. Prove both queue orders finish with no deadlock for each pair
    (`setVerification` vs `goLive`, `setVerification` vs `create`); exact resulting state
    assertions follow the existing sibling test's pattern.

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db`

State after Phase A: `packages/db` exposes `agentStatus` on `lift` and `agentsTakenDown` on
`setVerification`; nothing in `apps/web` reads either field yet (both additive, so Phase A alone
cannot break `apps/web`'s typecheck — it destructures named fields off these return values, never
the whole object).

### Phase B — apps/web (items 4 and 5's console-facing half)
Files:
- `apps/web/app/api/staff/takedowns/handlers.ts` — in `act`'s `lift` branch, include
  `agentStatus` in the JSON reply only when the repo returned it:
  `ok({ id: row.id, status: row.status, ...(row.agentStatus === undefined ? {} : { agentStatus:
  row.agentStatus }) })`.
- `apps/web/app/staff/reports/client.ts` — `ActReply` gets an optional
  `agentStatus: z.enum(['draft', 'live']).optional()`; `liftTakedown`'s resolved value carries it
  through (`{ ok: true, id, agentStatus? }`).
- `apps/web/app/staff/reports/view.tsx` — `onLift` keeps the lifted takedown's kind/agentStatus
  around long enough to pick the notice text: when the takedown was `kind: 'agent'` and the reply's
  `agentStatus === 'draft'`, show a distinct message (new key below) instead of the generic
  `done`; otherwise keep today's `done` text. `notice` likely needs to become a small typed value
  (not just `boolean`) to carry this, same shape idea as `StaffQueueView`'s `Notice` type.
- `apps/web/messages/en.json` — add one new `staffReports` key (e.g. `liftedAgentDraft`) saying
  the agent is back in draft, not yet visible to students, next to the existing `done` key (line
  849).
- `apps/web/app/staff/reports/view.test.tsx` — update the existing lift test(s) and add one proving
  the new draft-specific notice text appears only when `agentStatus: 'draft'` comes back, and that
  the old plain `done` text still appears for a document lift or an agent lift that returns `live`.
- `apps/web/app/api/staff/verifications/handlers.ts` — in `decide`, include `agentsTakenDown` in
  the JSON reply only when the request was a safety rejection (`safety === true`, which the
  existing `DecisionBody.refine` already ties to `status === 'rejected'`):
  `...(safety === true ? { agentsTakenDown: row.agentsTakenDown } : {})`. This keeps every
  existing non-safety `decide` response (approve, plain reject) byte-for-byte unchanged.
- `apps/web/app/staff/client.ts` — `DecisionReply` gets an optional
  `agentsTakenDown: z.number().int().min(0).optional()`; `decide`'s resolved value carries it
  through (`{ ok: true, verificationStatus, agentsTakenDown? }`).
- `apps/web/app/staff/view.tsx` — `Notice` gains the real signal instead of trusting the
  `safety` flag the client *sent*: `notice.safety` (or an added field) is true only when
  `result.verificationStatus === 'rejected' && (result.agentsTakenDown ?? 0) > 0`, fixing the bug
  at `apps/web/app/staff/view.tsx:66` (currently `notice.safety` is just the `safety` argument
  echoed back).
- `apps/web/app/staff/view.test.tsx` — update the existing "safety concern + Reject ... shows
  rejectedSafety" test's mocked `decide` to return `agentsTakenDown: 1` (keeping that assertion
  meaningful), and add a new test: a safety rejection where `decide` returns `agentsTakenDown: 0`
  (or omits it) shows the plain `rejected` text, not `rejectedSafety`.
- `apps/web/app/api/staff/verifications/route.test.ts` — the mocked `setVerification` doesn't
  model agents; add `agentsTakenDown: 0` to its returned row so the type lines up, and add
  `agentsTakenDown: 0` to the one safety-rejection test's `toEqual` (currently ~line 644). Every
  other `toEqual` in this file is a non-safety decision and stays unchanged (handler omits the
  field).
- `apps/web/app/api/staff/verifications/route.int.test.ts` — the two safety-rejection tests
  (currently ~line 218 and ~line 260) add `agentsTakenDown: <N>` to their `toEqual` once you've
  run them and seen the real count (expected `0`: neither fixture teacher in this file has a live
  agent). The plain-rejection test (~line 186) is untouched (no `safety` sent, so the field is
  never in the reply).

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web...`

State after Phase B: both consoles show an accurate notice; `lift`'s agent status and
`setVerification`'s agent count are no longer silent fields.

## Files out of bounds
Per the lead's note: `packages/db/src/repositories/index.ts`, `learner.ts`, `ingestSweep.ts`,
`chunks.ts`, `reports.ts`, the `evidence_events` schema, `migrate.ts`, `apps/worker/**`, and
`apps/web/app/api/sessions/[id]/reports/**` (a different route tree from the
`apps/web/app/staff/reports/**` / `apps/web/app/api/staff/reports/**` this task touches — not the
same files, double-checked by path). This task needs none of them: no new files, no touch to
`map.ts`'s shared `TeacherProfileRowSchema`.

## Risky paths touched (`.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (incl. `README.md`) -> reviewers: security-reviewer
- `apps/web/app/api/staff/**` -> reviewers: security-reviewer
- `apps/web/app/staff/**` -> reviewers: security-reviewer
- `apps/web/messages/en.json` is not a risky path.

Required by the gate: **security-reviewer** (covers every group above). Recommended in addition,
matching 9.3e's own review (same lock-order-sensitive code, same consoles):
**database-reviewer**, **code-reviewer**, **typescript-reviewer**. No contracts change, no ADR.
This is a `risk: high` decision at handoff (risky paths touched).

## Decisions already made (not open questions)
- Field design is additive everywhere: `agentStatus` only appears for an agent-kind `lift`;
  `agentsTakenDown` only appears in the API JSON on a safety rejection. This keeps every existing
  non-safety / document-kind test passing unchanged — only the specific safety/agent scenarios
  need new assertions.
- The stale-active-row branch's new audit row/staff action mirrors `takeDownAgentInTx`'s own
  shapes (action names, `source: 'teacher.verify'`) rather than inventing new vocabulary.
- The two-connection test for `setVerification(safety)` needs the target agent already `live`
  before the race starts, since `setVerification` only locks `status = 'live'` rows for that
  teacher — otherwise the test would not exercise any lock contention at all.

## Open questions
None: the board title and the 9.3e review fully specify the five LOWs, and the lead's note already
answers the file-ownership boundary.

## Budget
Budget: 140 tool calls (2 phases: Phase A ~65 calls on packages/db, Phase B ~75 calls on apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test and the secret scan only)

## Exit conditions
Status: DONE once both phases' gate commands are green and every one of the five acceptance
items has a new or extended test proving it (not just "no regression"). Status: PARTIAL if either
phase passes ~75 tool calls without a green gate, or if the two-connection test needs a fixture
helper that would touch a file outside this plan's list (stop and hand back rather than guess).

## Lead answers (27 Oct 2026)
- Gate: Phase A runs `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` (dependents too, since `lift`'s return type changes); Phase B runs `--filter=@edmate/web...`.
- Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer. The lead logs the `risk: high` decision at finalise; the builder does not.
- Budget: 140 tool calls across both phases, as planned; each phase is a fresh builder.

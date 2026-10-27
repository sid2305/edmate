# Task 6.5b: 6.5 review LOWs (memory page scope sharing, wiring test, reset documentation)

Board: milestone M13 · deps `6.5` (done) · marked `risk: risky` on the board, but (see "Risky
paths touched" below) none of this task's files actually match `risk-paths.txt` · **one phase**
(`apps/web` only, no `packages/db` changes).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "6.5 review LOWs: the memory page resolves its scope through studentTurnScope like the
route; a test for the server-database memoryHandlers wiring; document on DELETE
/api/me/memory that a reset with no profile row still ends the open session."

Accept: "The page and the route share one scope resolution, and the wiring test passes."

### How it is shown (paste into handoff.md)
1. `apps/web/app/learn/[agentId]/memory/page.tsx` calls the same `studentTurnScope` helper
   `apps/web/src/memory/routes.ts` already uses, instead of hand-building
   `{ studentId, teacherId }` from a separate `repos.agents.owner()` call.
2. A new test in `apps/web/src/memory/routes.test.ts` exercises the real wired `memoryHandlers`
   export (not just the `createMemoryHandlers(backend)` factory already under test) against a
   mocked `serverDatabase()`, for both `export` and `reset`, and passes.
3. A code comment on the DELETE route documents that `learnerProfiles.reset` ends any open
   session before it checks whether a profile row exists, so `{ reset: false }` means "nothing to
   clear", not "nothing happened."

## Source context already read
- `docs/tasks/6.5/handoff.md`, `docs/tasks/6.5/review.md` (the three LOW findings this task
  closes).
- `docs/tasks/6.5a/plan.md` (about to merge): adds `memory_reset_at` to `learner_profiles`,
  `reset`'s behaviour this task documents is otherwise unchanged by it. 6.5a touches
  `packages/db/**` only — no overlap with this task's files.
- `apps/web/app/learn/[agentId]/memory/page.tsx`, `apps/web/src/memory/routes.ts`,
  `apps/web/src/turn/scope.ts` (`studentTurnScope`), `apps/web/app/api/me/memory/[agentId]/route.ts`,
  `apps/web/src/memory/routes.test.ts`, `apps/web/app/learn/[agentId]/memory/page.test.tsx`,
  `apps/web/src/subscriptions/start.ts` (the "same pattern" the review cites — also untested for
  its own wired export, so there is no existing wiring-test template to copy; one is written
  here), `apps/web/src/studio/runtime.test.ts` (the repo's existing `vi.mock('../auth', () => ({
  serverDatabase: ... }))` pattern, reused for the new wiring test).
- `packages/db/src/repositories/scope.ts` (`studentScope`): pure zod validation, no database
  call — safe to let run for real inside `page.tsx`'s and the new wiring test's render path with
  no extra mocking.
- Other work in flight: 12.2f (apps/web reports/staff, packages/db reports/map/chunks) and 8.2i
  (apps/worker ingest, packages/db chunks) touch neither file this task edits. 6.5a touches only
  `packages/db/**`. No shared-file conflict.

## Design

1. **`page.tsx`**: import `studentTurnScope` from `../../../../src/turn/scope` (the same helper
   `routes.ts`'s `resolveScope` calls). Replace the current `repos.agents.owner({ agentId })` +
   hand-built `{ studentId: principal.userId, teacherId: owner.teacherId }` with
   `const scope = await studentTurnScope(repos.agents, principal, agentId); if (scope === null)
   return notFound();`. `repos.agents` already structurally satisfies `AgentOwners` (same object
   `routes.ts`'s wired `memoryHandlers` passes); no new type needed. The existing
   `IdSchema.safeParse` step (parsing the path param before any repository call) is unchanged —
   it runs before `studentTurnScope`, same as `routes.ts`'s own `paramsAgentId` step runs before
   its call.
2. **Wiring test**: add a new `describe` block to the existing `apps/web/src/memory/routes.test.ts`
   (not a new file — it already has the `STUDENT`/`PROFILE`/`EVIDENCE`/`ctxFor`/`req` fixtures this
   reuses) that `vi.mock('../auth', () => ({ serverDatabase: () => ({ repos: { agents: { owner:
   shared.owner }, learnerProfiles: { get: shared.get, reset: shared.reset }, evidenceEvents: {
   list: shared.list } } }) }))` (via `vi.hoisted`, following `studio/runtime.test.ts`'s existing
   pattern) and imports `memoryHandlers` (the module's wired singleton, alongside the
   already-imported `createMemoryHandlers`). Asserts: `export` calls `serverDatabase().repos`'s
   `agents.owner`, `learnerProfiles.get` and `evidenceEvents.list` with the resolved scope and
   `{ limit: EVIDENCE_LIST_MAX }`, and returns 200 with the right shape; `reset` calls
   `learnerProfiles.reset` with the resolved scope and returns 200. This is new coverage, not a
   duplicate of the existing factory-level tests (those never exercise the `serverDatabase()`
   wiring itself).
3. **Reset documentation**: expand the file-top comment in `apps/web/app/api/me/memory/[agentId]
   /route.ts` (and/or the `reset` handler's local comment in `routes.ts` — whichever reads more
   naturally in context) with one sentence: a reset on a pair with no profile row still ends any
   open session first (6.5's own precedent, `packages/db`'s `learnerProfiles.reset` step 1 runs
   before the profile-row check), so a `{ reset: false }` response means there was no
   mastery/evidence to clear, not that nothing happened. Comment only — no response-shape change,
   no `packages/db` change.

No contracts change, no `packages/db` change, no `packages/harness` change, no new route, no new
page, no new UI copy (the finding asks to document the behaviour, not surface it to the student).

## Files

**Modify**
- `apps/web/app/learn/[agentId]/memory/page.tsx` — scope via `studentTurnScope`.
- `apps/web/src/memory/routes.ts` — reset documentation comment (and/or the route file, see Design
  §3); no behaviour change.
- `apps/web/app/api/me/memory/[agentId]/route.ts` — same documentation comment, if it lands here
  instead of/as well as `routes.ts`.
- `apps/web/src/memory/routes.test.ts` — new wiring-test `describe` block.
- `apps/web/app/learn/[agentId]/memory/page.test.tsx` — touch only if an assertion needs updating
  to match the refactor (see Tests first; expect no behavioural change, so likely untouched
  besides perhaps the file-top comment).

**Create:** none.

## Files out of bounds
- `packages/db/**` (including `packages/db/src/repositories/learner.ts`, `README.md`,
  `repositories.int.test.ts`): no reset behaviour changes here, and 6.5a/13.regate are mid-flight
  there. This task only documents existing `packages/db` behaviour in `apps/web` comments.
- `packages/contracts/**`, `docs/adr/**`: no contracts change.
- `apps/web/src/auth/**`, `apps/web/src/memory/MemoryView.tsx`,
  `apps/web/src/memory/ResetMemoryButton.tsx`: no policy, guard or UI change — the finding is
  about scope-resolution code sharing and test coverage, not behaviour or copy.
- `apps/web/messages/en.json`: no new user-facing string.
- `content/**`: not touched.

## Tests first

Write/extend these and see the new one fail before the `page.tsx`/comment changes:
1. New `describe` block in `routes.test.ts` (wiring test) — write it against the *current*
   `routes.ts` first; it should already pass today (the wiring itself isn't broken, only
   untested) — confirms the test is meaningful before any other edit lands.
2. Re-run `page.test.tsx` unmodified after the `page.tsx` refactor: `owner` is still called with
   `{ agentId }`, `get` is still called with `{ studentId: 'std_amy', teacherId: 'tch_asha' }`, the
   non-live-agent case still gives `notFound`, and the guard-refusal case still calls no
   repository — all four existing assertions should stay green with no edits, since
   `studentTurnScope` reaches the same two calls in the same order. If any of them needs an edit to
   keep passing, that is a signal the refactor changed behaviour, not just where the scope is
   built — stop and re-check the design before editing the test to match.
3. Full gate (below) green, including the existing `routes.test.ts` factory-level tests and
   `page.test.tsx`, with no regression.

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`,
then `python3 .githooks/secret-scan.py --all`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- None of this task's files match a glob in `risk-paths.txt`: `apps/web/app/learn/**` and
  `apps/web/src/memory/**` are not listed (the listed `apps/web/**` groups are `app/api/webhooks/**`,
  `app/api/auth/**`, `app/api/staff/**`, `app/staff/**` and `src/auth/**` — none of which this task
  touches or edits). The board's `risk: risky` tag reflects that this task closes out review LOWs
  on 6.5 (itself `risk: high` for touching `src/auth/**`/`packages/db/src/repositories/**`), not a
  new risky-path touch here.
- **Recommended, beyond the gate (precautionary, not required by the gate):** typescript-reviewer
  for the refactor's type shape; security-reviewer only if the lead wants a second look at scope
  resolution given 6.5's own history, since it is security-adjacent even though not glob-matched.
  code-reviewer runs as usual.
- No `risk: high` decision is required (no risky-path match, no contracts change). The handoff
  should still note the board's `risk: risky` tag and this section's reasoning so the lead can
  confirm at merge time.

## Open questions (each with a recommendation; none blocks the start)

- **Q1. Does the documentation comment belong in `routes.ts`'s `reset` handler, the route file's
  top comment, or both?** Recommend **both, briefly**: a one-line addition to the route file's
  existing top comment (which already explains GET vs. DELETE) for anyone reading the route first,
  plus the fuller sentence on `routes.ts`'s `reset` handler where the behaviour is actually
  exercised. No response-shape or client-facing change either way.
- **Q2. Should the new wiring test live in `routes.test.ts` (one more `describe` block) or a new
  file (e.g. `routes.wiring.test.ts`)?** Recommend **the same file**: it already owns the
  `STUDENT`/`PROFILE`/`EVIDENCE`/`ctxFor`/`req` fixtures this reuses, and the repo has no existing
  `*.wiring.test.ts` naming convention to match instead (checked: no such file exists today).
- **Q3. Does `page.test.tsx` need any new test case, or only pass unchanged?** Recommend **no new
  case**: the acceptance is "the page and the route share one scope resolution" — the existing
  four assertions already pin exactly the behaviour that sharing must preserve (owner called with
  `{ agentId }`, `get` called with the resolved `{ studentId, teacherId }`, non-live gives
  `notFound`, guard refusal reads no database). Adding a test that mocks `studentTurnScope` itself
  would prove the page *calls* the helper, not that the helper's real behaviour is what runs — the
  unmocked integration through the real `studentTurnScope`/`studentScope` is the stronger check
  and is what the four existing tests already exercise end to end.

No deferred items: this task is scoped to exactly the three 6.5 review LOWs.

## Decisions (draft for the handoff)

### 6.5b closes the three 6.5 review LOWs · risk: low
Decided: the memory page now resolves its scope through the same `studentTurnScope` helper the
route uses, instead of a second hand-built scope object; a new test exercises the real wired
`memoryHandlers` export (not just the factory) against a mocked `serverDatabase()`; a code comment
documents that a reset with no profile row still ends any open session.
Why: closes three LOW findings from the 6.5 review with no behaviour change — same scope values,
same responses, same `packages/db` contract.
risk: low (no risky-path match per `risk-paths.txt`; no contracts change).

## Budget
Budget: 35 tool calls (1 phase, apps/web only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck, lint and test via corepack pnpm turbo; `python3
.githooks/secret-scan.py --all`). No network, model, payment or database calls (no Postgres needed
— `apps/web`'s unit tests use fakes/mocks, not an integration database).

## Exit conditions
- **Status: DONE** when: the new wiring test passes against the real `memoryHandlers` export; the
  existing `page.test.tsx` and `routes.test.ts` factory-level tests stay green unmodified; the full
  web gate (`typecheck lint test --filter=@edmate/web...`) is green; `git diff origin/main --
  packages/contracts packages/db` is empty; the documentation comment lands; and the handoff has
  the draft decision plus `Tool calls used:`.
- **Status: PARTIAL** past about 35 calls, or if `page.test.tsx` needs a behavioural (not just
  cosmetic) change to stay green, or if a file outside this plan needs changes (in particular
  anything under `packages/db/**`, `packages/contracts/**` or `apps/web/src/auth/**`). Stop and
  report; don't widen the task.
- **Status: BLOCKED** if a contracts change or a `packages/db` behaviour change turns out to be
  needed to satisfy the acceptance.

## Lead answers (27 Oct 2026)
- Q1: both, briefly, as recommended. The comment must match 6.5a (merging now): a reset with no profile row still ends the pair's open sessions and writes nothing else.
- Q2: the same file.
- Q3: no new case.
- Risk: no risk-paths match, so no `risk: high` decision is needed; reviewers are code-reviewer and typescript-reviewer, plus security-reviewer because the page's scope resolution is an access check.

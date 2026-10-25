# 9.3i plan — a student can pause or cancel a subscription whose agent is suspended

Status: READY

## Acceptance (verbatim from the board)

> a test pauses and cancels a subscription whose agent is suspended; web typecheck, lint and test
> green.

(Board title, for context: "9.3f plan Q5 (deferred): a student can pause or cancel a subscription
whose agent is suspended (today the /home line has no actions and the chat and plan pages 404);
land before payments go live.")

How it will be shown:
- `apps/web/src/subscriptions/change.test.ts` (new cases, fake backend, same style as every other
  case in this file — no Postgres needed, nothing here touches `packages/db`): with the agent's
  `owner` lookup returning `null` (not live) but `listUnavailableForStudent` returning a matching
  `{agentId, teacherId}` row, `PATCH /api/subscriptions/:id` with `action: 'pause'` and `action:
  'cancel'` both succeed (200), calling `subscriptions.pause`/`cancel` with the scope built from
  that row; `action: 'change'` in the same situation still 404s (unchanged — there is nothing to
  change to when the agent isn't live, since `liveForAgent` already returns `[]` for it); an
  `agentId` that matches neither `owner` nor the unavailable list still 404s for every action.
- `apps/web/app/learn/[agentId]/plan/page.test.tsx` (new cases): a suspended agent's plan page no
  longer gives `notFound` when the student has a subscription for it (found through
  `listUnavailableForStudent`, the same read Phase C of 9.3f already ships); it renders `PlanView`
  with `agentAvailable: false`. An agent that is neither live nor in the student's own unavailable
  list still gives `notFound` (no new enumeration).
- `apps/web/src/subscriptions/PlanView.test.tsx` (new case): `agentAvailable={false}` shows one
  blame-free notice line (no teacher name), and the Pause/Cancel controls still render and are not
  disabled by it.

## Context (read before building)

- 9.3f (`docs/tasks/9.3f/{plan,handoff}.md`) built `subscriptions.listUnavailableForStudent
  (studentId): Promise<Array<{agentId: string; teacherId: string}>>` (already shipped, read-only,
  "same bare-id exception as `listLiveForStudent`"): the signed-in student's own not-ended
  subscriptions whose current package's agent is **not** `live`. It already powers `/home`'s one
  blame-free line (B-49). **This task reuses that exact method as the missing piece for Q5** — no
  new repository method, no migration, no change to `packages/db` at all.
- Why today's pause/cancel 404s (9.3f's own Context, carried over): `PATCH
  /api/subscriptions/[id]` (`apps/web/src/subscriptions/change.ts`) resolves its `StudentScope` via
  `studentTurnScope(backend.agents, ctx.principal, agentId)`, which calls `agents.owner` —
  live-only by design (the same mechanism that keeps a suspended agent refused for turns, chat,
  memory and export everywhere else). When the agent is suspended, `owner` is `null`, so the route
  404s before it ever reaches `subscriptions.pause`/`resume`/`cancel` — repository methods that
  never needed the agent to be live in the first place (they act on `{studentId, teacherId}`, and
  `subscriptions.teacherId` is a column on the row, not derived from the agent). Separately,
  `/learn/<agentId>/plan/page.tsx` does its own `agents.owner` lookup before it will render
  anything, so it 404s for the same reason, before `PlanView` is ever reached.
- The fix is additive, not a change to the live-only check anywhere it matters: `agents.owner` and
  `studentTurnScope` stay byte-for-byte unchanged (still used, unchanged, by `turn/routes.ts`,
  `chat/loadChat.ts`, `memory/routes.ts`, `export/routes.ts`, `sessions/[id]/reports/handlers.ts`
  and `change.ts`'s own `change` action). A **second, independent** lookup —
  `listUnavailableForStudent`, already scoped to the signed-in student's own rows — is tried only
  as a fallback, and only for `pause`/`resume`/`cancel` (never `change`, and never anywhere turn
  access is decided).
- MVP-first: no payment is live (M10), so pausing or cancelling a subscription whose agent is
  suspended changes no money today; the chat and plan-page-body behaviour for a *live* agent is
  unchanged. The student still cannot chat with a suspended agent (12.2/9.3e, unchanged) — this
  task only lets them manage (see, pause, cancel) the subscription itself instead of it looking
  like it vanished with no controls at all.
- `docs/lessons.md` "UI state and server replies: trust neither, reset everything" — no new
  try/catch shape is needed here: `PlanView`'s existing per-action try/catch/finally already
  covers the new code path (the fallback is entirely server-side, inside the existing handler's
  one try block).

## Design (one sentence each)

1. `apps/web/src/subscriptions/change.ts`: when `studentTurnScope` returns `null` and the action is
   `pause`, `resume` or `cancel` (not `change`), look up
   `backend.subscriptions.listUnavailableForStudent(ctx.principal.userId)` and, if a row's
   `agentId` matches the body's `agentId`, build the scope from that row's `teacherId` instead
   (same `{studentId, teacherId}` object shape `start.ts` already builds by hand); otherwise (no
   match either way) the route 404s exactly as today.
2. `apps/web/app/learn/[agentId]/plan/page.tsx`: when `agents.owner` is `null`, the same fallback
   lookup (scoped to the signed-in principal) finds the owning teacher for a suspended/draft agent
   the student already has a subscription with; the page renders instead of 404ing, with
   `agentAvailable={false}` passed to `PlanView` (default `true` otherwise — no behaviour change
   for a live agent). An agent in neither list is still `notFound` (no new enumeration: the
   fallback list is the student's own rows only).
3. `apps/web/src/subscriptions/PlanView.tsx`: a new optional `agentAvailable?: boolean` prop
   (default `true`); when explicitly `false`, one blame-free paragraph (`t('agentUnavailable')`,
   no teacher name, same precedent as `/home`'s `unavailableLine`, 9.3f Q3) renders near the top,
   alongside the existing `noPaymentNotice`. Pause/Resume/Cancel buttons are unchanged by this prop
   — they already render purely from `subscription`/`isPaused`, with no agent-liveness check of
   their own, which is exactly why they already work once the route stops 404ing.

## Files to create / modify

Single phase — no new files, no risky paths (see below), everything in `apps/web`; nothing in
`packages/db`.

1. `apps/web/src/subscriptions/change.ts`
   - `PlanBackend.subscriptions`'s `Pick<Repositories['subscriptions'], ...>` gains
     `'listUnavailableForStudent'`.
   - In `patch`: `let scope = await studentTurnScope(backend.agents, ctx.principal,
     body.data.agentId);` then, only `if (scope === null && body.data.action !== 'change')`, call
     the fallback and set `scope` from the matching row if found. `if (scope === null) return
     notFound();` unchanged below it. No change to any other branch, to `fromError`, to
     `INVALID_MSG`, or to the `change` action's behaviour.
   - `planHandlers`'s wiring at the bottom gains `listUnavailableForStudent: (studentId) =>
     serverDatabase().repos.subscriptions.listUnavailableForStudent(studentId)`.
2. `apps/web/src/subscriptions/change.test.ts`
   - `fakeBackend`'s `Overrides` and the returned `backend.subscriptions` gain
     `listUnavailableForStudent` (default `async () => []`, overridable, and recorded in `calls`
     like every other method here).
   - New cases (tests first): pause succeeds via the fallback (asserts the `pause` call's scope);
     cancel succeeds via the fallback; resume succeeds via the fallback; `change` still 404s in the
     same situation (asserts `changePackage` was never called); an `agentId` matching neither
     `owner` nor the fallback list still 404s for `pause` (one representative action is enough —
     the code path is identical for all three); the fallback is **not** called when `owner`
     resolves (the common/live path costs no extra query).
3. `apps/web/app/learn/[agentId]/plan/page.tsx`
   - Add `listUnavailableForStudent` to the destructured/used `repos.subscriptions` calls; the
     `owner`-null branch tries the fallback before `notFound()`, as described in Design #2; thread
     `agentAvailable` (boolean) into `<PlanView agentAvailable={...} .../>`.
4. `apps/web/app/learn/[agentId]/plan/page.test.tsx`
   - `vi.mock('../../../../src/auth', ...)`'s stubbed `repos.subscriptions` gains
     `listUnavailableForStudent: state.listUnavailableForStudent` (new `vi.fn()` in `state`, reset
     in `beforeEach`).
   - Update the existing "a non-live or malformed agent gives notFound" case: it must still pass
     with `state.listUnavailableForStudent` resolving `[]` (no match) — add that stub so the test
     keeps asserting the true not-found case, not an accidental fallback match.
   - New cases: a suspended agent with a matching `listUnavailableForStudent` row renders
     `PlanView` with `agentAvailable: false` (and does *not* call `owner` again or loop); when
     `owner` resolves normally, `listUnavailableForStudent` is never called and `agentAvailable` is
     `true` (or omitted, whichever the page code makes simplest — say which in the handoff).
5. `apps/web/src/subscriptions/PlanView.tsx`
   - `PlanViewProps` gains `agentAvailable?: boolean`; render `{agentAvailable === false ? <p>
     {t('agentUnavailable')}</p> : null}` right after `noPaymentNotice`. No other change — the
     manage/cancel sections and their buttons are untouched.
6. `apps/web/src/subscriptions/PlanView.test.tsx`
   - New case: `agentAvailable={false}` with a live subscription shows the notice text and the
     Pause button is present and not disabled.
   - Extend the existing combined axe test ("has no axe violations, with or without a live
     subscription") with a third render, `agentAvailable={false}`, asserting no violations.
7. `apps/web/messages/en.json` (`plan`): `"agentUnavailable": "This teacher's agent isn't available
   right now. You can still pause or cancel below."` (one line, no teacher name, blame-free, same
   tone as `home.unavailableLine` and the existing `pausedByEdmate`/`noSubscription` lines in this
   same `plan` block).

Run (once, at the end): `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`;
`python3 .githooks/secret-scan.py --all`.

## Files out of bounds

`packages/db/**` (no repository, schema or migration change — the fallback reuses
`listUnavailableForStudent`, already shipped in 9.3f; this also means the files under review in
task 8.1b — `teacher-profiles.ts`, `cli.ts`, `redact-json.ts` — are never touched). `agents.owner`,
`studentTurnScope` (`apps/web/src/turn/scope.ts`) and every other caller of either
(`turn/routes.ts`, `chat/loadChat.ts`, `memory/routes.ts`, `export/routes.ts`,
`sessions/[id]/reports/handlers.ts`) — unchanged; this is exactly the enforcement this task must
not widen. `apps/web/app/learn/[agentId]/page.tsx` and `.../memory`, `.../progress` (chat stays
404'd for a suspended agent, 12.2/9.3e, unchanged). `apps/web/app/home/**`,
`apps/web/src/chat/liveChats.ts` (9.3f's own surface; not reopened here). `apps/web/app/api/staff/
**`, `apps/web/src/auth/**` (no auth change: the route is still `withRole(['student'],
planHandlers.patch)`, unchanged). `packages/contracts/**` (no new error code — `not_found` is
reused, same as today). Any migration (none needed).

## Risky paths touched (checked against risk-paths.txt)

None. Every touched path (`apps/web/src/subscriptions/**`, `apps/web/app/learn/[agentId]/plan/**`,
`apps/web/messages/en.json`) is outside every group in `.claude/skills/merge-gate/risk-paths.txt`
(the risky web groups are `apps/web/app/api/staff/**`, `apps/web/src/auth/**`,
`apps/web/app/api/auth/**`, `apps/web/app/api/webhooks/**`; `packages/db/src/repositories/**` is
risky but is not touched by this plan at all). No contracts, ADR, harness, locale or migration
change. code-reviewer and typescript-reviewer still review, as they do on every PR; no reviewer is
*required* by this gate.

A short decision note is still logged in the handoff (risk: low, following 9.3f Phase C's own
precedent for its similarly not-risky-by-path B-49 fix), naming that `agents.owner`/
`studentTurnScope` were deliberately left unchanged and why the fallback cannot widen turn access.

## Open questions (all non-blocking; recommendations are what the plan builds)

- Q1 Should `resume` also use the fallback, or only `pause`/`cancel` (the two the board's `accept`
  line names)? Recommended: all three (`pause`/`resume`/`cancel`, never `change`) — same risk, same
  code path, and splitting it out buys nothing; the acceptance test still proves pause and cancel
  explicitly, resume is covered as a side effect of the same `!== 'change'` condition.
- Q2 Notice wording on the plan page: a short blame-free line (built above) vs. something that also
  explains chat is still unavailable. Recommended: keep it short, matching `/home`'s precedent
  (12.2 Q6) — the student already learned this from `/home`'s own line before clicking through.
- Q3 `PlanView`'s post-action redirects (`onResume`/`onCancel`/`onChange` all push to
  `/learn/<agentId>`, which 404s for a suspended agent) are unchanged by this plan — a student who
  cancels from an unavailable-agent plan page lands on the 404 page instead of `/home`. Recommended
  defer: this is a UX rough edge, not a access or correctness bug (the cancel itself already
  succeeded), and redirect targets are easy to revisit later without any data-shape change.

## Budget

Budget: 60 tool calls (1 phase, apps/web only)

One phase, one builder, one branch/PR (`m13/9.3i-pause-cancel-suspended-agent`). No db package
involved, no other builder to wait on.

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for `@edmate/web`, the secret scan,
git add/commit/push on the task branch only).

## Exit conditions

- `Status: DONE`: the tests above exist and pass (tests first), `apps/web` typecheck, lint and
  test are green, secret scan clean, handoff written with `Tool calls used:` and the risk: low
  decision.
- Stop at `Status: PARTIAL` when past ~70 calls, when a file outside this plan needs a change (name
  it — in particular, if `listUnavailableForStudent`'s existing shape turns out not to carry enough
  information for the fallback, or if `PlanBackend`'s narrowed `Pick` type needs a wider import
  than expected), or when the existing "non-live agent gives notFound" page test cannot be kept
  green alongside the new fallback without a shape this plan didn't anticipate.

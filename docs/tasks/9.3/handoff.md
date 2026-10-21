# Handoff: 9.3 — Package compare and start

## Status
DONE. Phases A, B and C all on this one branch/PR (lead decision: one task, one branch, one PR —
the plan's "depends on Phase B merged" sequencing between phases does not apply here).

## Phase C — apps/web: `/home` "start a package" link

### Files
- `apps/web/src/chat/liveChats.ts` — new `startableAgents(deps, principal, candidates)`: for each
  live agent candidate, pushes the agent id when `subscriptions.findLive` is `null` (never
  subscribed) or its row's `status === 'ended'` (the explicit `ended` check covers a stub/test
  double that still returns the row; the real repository already excludes `ended` rows, so `null`
  is the normal production signal). A `paused` subscription is neither a chat link nor a start
  link (resuming it is 9.6, out of scope). New `homeStartLinks(open, principal, candidates, log)`
  mirrors `homeChatLinks`: a database failure or a thrown error shows no links and logs only the
  error name (`home.start_links_failed`), same as `homeChatLinks`'s `home.chat_links_failed`.
- `apps/web/src/chat/liveChats.test.ts` — new `describe` blocks for `startableAgents` (never
  subscribed and ended both qualify; trial/active/past_due/paused all excluded) and
  `homeStartLinks` (repository error shows nothing and logs only the error name, like
  `homeChatLinks`'s own case; no candidates opens nothing; returns the startable ones).
- `apps/web/app/home/page.tsx` — calls `homeStartLinks` alongside the existing `homeChatLinks`,
  from the same `chatAgentCandidates(process.env)` list and the same opened repos (`open = () =>
  serverDatabase().repos`, hoisted out so both calls share it); passes both lists to `HomeView`.
- `apps/web/app/home/page.test.tsx` (new — none existed for this page before; plan said "add if
  not") — mocks `../../src/auth`, `../../src/chat/liveChats` and `../../src/turn/runtime`
  (`consoleLog`), stubs `./view` to a small marker component, and asserts both `homeChatLinks` and
  `homeStartLinks` are called with the same candidate list and principal, and that `HomeView`
  receives both lists. `.tsx` (not `.ts`) because the `HomeView` mock needs JSX.
- `apps/web/app/home/view.tsx` — new optional `startable` prop; renders a second list, "packages
  you can start", each item linking to `/packages/[agentId]` (not straight to chat); the single
  placeholder now shows only when *both* `chats` and `startable` are empty.
- `apps/web/app/home/view.test.tsx` — new cases: a startable-only list renders the heading and
  link with no axe violations; chats and startable together render both lists with no placeholder;
  both empty still shows the placeholder, with no "Packages you can start" heading.
- `apps/web/messages/en.json` — new `home.startableTitle` ("Packages you can start") and
  `home.startLink` ("Start a package").

### Tests
- `corepack pnpm vitest run src/chat/liveChats.test.ts` → 18 passed (10 new).
- `corepack pnpm vitest run app/home` → 2 files, 8 passed (6 new: 4 in `view.test.tsx`, 1 new
  `page.test.tsx` file, plus the pre-existing suites).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → 34 tasks successful;
  coverage: `src/chat/liveChats.ts` 100%/100%/100%/100% (stmt/branch/func/line).
- `python3 .githooks/secret-scan.py --all` → clean.

### Decisions

### 21 Oct 2026 · a paused subscription shows neither a chat nor a start link · decided by tdd-guide · risk: low
- Decided: `startableAgents` only includes an agent when the student has never subscribed or that
  subscription ended; a `paused` subscription (handled already by `liveChatAgents`'s own
  `NOT_LIVE` exclusion for the chat list) is likewise excluded here, so `/home` shows the student
  nothing for a paused pair — no chat link, no start link.
- Why: resuming a paused subscription is 9.6 (upgrade/downgrade/pause), explicitly out of scope
  for this task per the plan's own Context section; showing a start link there would let a student
  open a second, conflicting subscription attempt against the one-live-row-per-pair unique index
  instead of the real resume flow 9.6 will add.
- risk: low

### 21 Oct 2026 · a repository error shows nothing on the new start-link list · decided by tdd-guide · risk: low
- Decided: `homeStartLinks` follows `homeChatLinks`'s exact failure shape — any thrown error
  (including a repository error) returns an empty list and logs only the error's constructor name
  (`home.start_links_failed`), never the error's message or any row content.
- Why: matches the plan's explicit instruction ("A repository error shows nothing, like
  `homeChatLinks`") and the existing silent-failure convention in this file, so a flaky or failing
  read never breaks the whole `/home` page, only hides that one list.
- risk: low

### 21 Oct 2026 · `home/page.test.tsx` added, as a new file, in `.tsx` not `.ts` · decided by tdd-guide · risk: low
- Decided: no test file existed yet for `app/home/page.tsx`, so one was added per the plan's "if
  one exists — check; add if not"; it is `.test.tsx` because its `./view` mock renders JSX.
- Why: keeps the new page wiring (both link lists passed through from the same candidate list and
  opened repos) under test, consistent with every other route's page test in this app.
- risk: low

## Phase B — apps/web: the compare-and-start page and route

### Files
- `apps/web/app/api/subscriptions/route.ts` (new) — `POST = withRole(['student'],
  subscriptionHandlers.start)`. `policy.ts`'s existing `/api/subscriptions` row (`access:
  ['student'], clearance: 'agent'`) is untouched, per the plan.
- `apps/web/src/subscriptions/start.ts` (new) — `createSubscriptionHandlers(backend)`: strict
  `{ agentId, packageId }` body only; `agents.owner` → 404 if missing/not live;
  `packageVersions.liveForAgent` → find the entry whose `config.id === packageId` → 404 if none;
  `status`/`periodEnd` from the package's own `trialDays` (`'trial'` + that many days, else
  `'active'` + 30 days); `subscriptions.start({ studentId: principal.userId, teacherId }, ...)`. A
  `RepositoryError('invalid')` (the one-live-row-per-pair unique index) maps to `validation`/409
  with a fixed message (`'invalid'` isn't a valid `ErrorCode`, so the mapped code is `validation`,
  not the repository's own kind name).
- `apps/web/src/subscriptions/start.test.ts` (new) — unit tests over an injected backend: trial vs.
  active start, a client-given `packageVersionId`/`version` is refused (strict body schema, never
  read), unknown agent/package → 404 before any further lookup, already-live pair → 409, every
  `RepositoryError` kind mapped, oversize/malformed body → 413/400, unexpected error → 500.
- `apps/web/app/packages/[agentId]/page.tsx` (new) — `requireRole(['student'], { clearance: 'agent'
  })`; `agents.owner` → `notFound()` if missing/not live; `subscriptions.findLive` on that scope —
  if live, shows "you already have a package" + a link to `/learn/[agentId]`, skipping
  `packageVersions.liveForAgent` entirely (upgrade/downgrade is 9.6, out of scope); otherwise reads
  the live packages and renders `PackageCompare`.
- `apps/web/app/packages/[agentId]/page.test.tsx` (new) — mirrors
  `teacher/onboarding/page.test.ts`'s mocking style; `.tsx` (not `.ts`) because the `PackageCompare`
  mock needs JSX.
- `apps/web/app/packages/[agentId]/PackageCompare.tsx` (new, `'use client'`) — one card per package
  (name, `Intl.NumberFormat` currency-neutral price, trial days if set, daily message limit, live
  classes per month, skills), a Start button that `POST`s `{ agentId, packageId }` to
  `/api/subscriptions` and on success navigates to `/learn/[agentId]`; on failure shows the fixed
  error text in a `role="alert"`.
- `apps/web/app/packages/[agentId]/PackageCompare.test.tsx` (new, jsdom, jest-axe) — mirrors
  `OnboardingForm.test.tsx`.
- `apps/web/messages/en.json` — new `packages` namespace (title, per-field labels, trial text,
  start button/states, its own `skills` sub-namespace mirroring `chat.skills`, a fixed
  `errors.generic` fallback).

## Files
- `packages/db/src/repositories/subscriptions.ts` — new `start(scope, input)`: a no-payment
  ownership-checked insert (`insertSelect`), generates its own id, returns the `LiveSubscription`
  directly (no re-select). `StartInput`/`StartOptions` validate `packageVersionId` (`IdSchema`),
  `status` (`'trial' | 'active'`), `periodEnd` (`z.iso.datetime({ offset: true })`). Relies on
  `subscriptions_one_live_per_pair_key` + `translateWrite` for the duplicate-live case (`invalid`).
- `packages/db/src/repositories/package-versions.ts` — new `liveForAgent(scope: { agentId })`: the
  one public scope (mirrors `agents.owner`), joins `packages` (`agent_id`, `live_version is not
  null`) to `package_versions` (`package_id` + `version = packages.live_version`); returns
  `{ packageVersionId, config }[]`. New `LivePackage` type.
- `packages/db/src/repositories/index.ts` — exports `StartInput`, `LivePackage`.
- `packages/db/test/repositories.int.test.ts` — isolation cases for both new methods (`subscriptions.
  start`: student-scope write; `packageVersions.liveForAgent`: public-scope read), plus the isolation
  grid's "has a case for exactly the methods createRepositories returns" check.
- `packages/db/test/leak.test.ts` — added both new methods to the scrubbed-driver-error check.

## Tests
- Phase A: `corepack pnpm vitest run test/repositories.int.test.ts test/leak.test.ts` → 84 passed.
- Phase A: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` → 26 tasks
  successful; `@edmate/db` test: 793 passed, 4 skipped (unrelated `.skip`s); coverage 100%
  branch/stmt/func/line on `src/repositories/subscriptions.ts`, `package-versions.ts`, `index.ts`.
- Phase B: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → 34 tasks
  successful; `@edmate/web` test: 801 passed, 4 skipped; coverage on the new files:
  `src/subscriptions/start.ts` 98.03%/95.23%/90.9%/97.67% (stmt/branch/func/line; the one
  uncovered line is the production wiring export, same shape as `src/studio/profile.ts`'s own
  uncovered wiring line).
- `python3 .githooks/secret-scan.py --all` → clean (both phases).

## Decisions
- **Isolation-grid shape for `subscriptions.start`**: every seeded pair already has a live
  subscription (isolation-seed.ts), so a positive-control write for `actor === target` would always
  hit the unique-index conflict. The write case's `attempt` ends that pair's own seeded row via raw
  SQL only when `actor === target` (never for the non-owns loop, which fails on ownership before any
  uniqueness check), then calls `start`; `verify` restores the seed (deletes the new row, reactivates
  the seeded one) so later tests see the original fixture. The "a pair that already has a live
  subscription" mismatch relies on that same seeded row still being live at the point it runs (grid
  order: non-owns loop, then mismatches, then positive control — confirmed by reading `runGrid`).
  `risk: low` (test-only shape, no production behavior).
  `owns` is defined as "same teacher" (`teacherOf(a) === teacherOf(t)`, matching
  `teacherQuestions.open`'s precedent): a same-teacher, different-student pair's `packageVersionId` is
  always ownership-valid for the scope's teacher, so only cross-teacher targets are genuine
  ownership failures for the ungrid's generic `not_found`/`scope` check. `risk: low`.
- **`packageVersions.liveForAgent`'s draft/suspended fixture reuses new agent ids** (`agt_live_pkg_
  draft`/`agt_live_pkg_susp`) instead of `agents.owner`'s (`agt_owner_draft`/`agt_owner_susp`), to
  avoid a cross-test insertion-order dependency on `CASES`'s object key order. `risk: low`.
- Both methods added to `leak.test.ts`'s "every other method that reaches the database" list, even
  though that list isn't exhaustive over every repo method today — the plan's Files to create/modify
  section called for it. `risk: low`.

### Phase B
- **Period length with no payment (30 days active, package's own `trialDays` for trial)**: per the
  plan's own recommendation (Question 1) — `entitle` never checks `periodEnd` against now yet, so
  this is cosmetic until 9.6/M10. `risk: low`.
- **Already-live pair refuses with a fixed 409** (Question 2): the plan's own recommendation;
  9.6 (upgrade/downgrade) picks up switching packages later. `risk: low`.
- **The already-subscribed `RepositoryError('invalid')` maps to API error code `validation`, not a
  new `'invalid'` code**: `ErrorCode` (`@edmate/contracts`) has no `'invalid'` member, so the route
  uses `validation` with HTTP 409 and the fixed `alreadySubscribed` message, matching the plan's
  recommended status code without adding a new contracts value (which would need an ADR). `risk:
  low`.
- **`app/packages/[agentId]/page.test.tsx` is `.tsx`, not `.ts`** (plan's "mirrors
  `teacher/onboarding/page.test.ts`"): that file's own mock factories are plain objects, but this
  page's `PackageCompare` child needs a JSX mock, so the test file itself needs JSX. `risk: low`.
- **`packages.skills` is its own namespace in `en.json`**, duplicating `chat.skills`'s labels,
  rather than passing `chat` messages into the packages page too (plan's Files section left the
  choice to the builder). Keeps the page's `NextIntlClientProvider` scoped to one namespace, same
  as `onboarding`/`chat` do today. `risk: low`.
- **No discovery link yet** (Phase C, not started): `/packages/[agentId]` is reachable only by
  typed URL, same as `/learn/[agentId]` before 9.2 existed, per the plan's own State-after-phase
  note.

# Handoff: 9.3 — Package compare and start

## Status
Phase A and B done; C left (per plan: three phases, one PR each).

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

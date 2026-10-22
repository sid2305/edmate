# 9.6d handoff: plan page (upgrade, downgrade, pause, resume, cancel)

## Summary
Built `PATCH /api/subscriptions/[id]` and the `/learn/[agentId]/plan` page, per
`docs/tasks/9.6/plan.md` Phase D. No payment screen: change/upgrade/downgrade/switch and resume
apply at once (9.6c Q1 = (a)); the page says so ("While Edmate is free to try, changes take
effect right away."). Scope is always derived from the session via `studentTurnScope`-style
lookups (agent owner + `subscriptions.findLive`); the request body is a strict, discriminated
`change | pause | resume | cancel` shape that cannot carry a client-supplied `studentId`,
`status` or `packageVersionId`. Errors are fixed text; logs carry only the error name.

## Files
- `apps/web/src/subscriptions/change.ts` (new) -- `PlanBackend` port, `createPlanHandlers`,
  wired `planHandlers` singleton. 64KB body cap (module-local, matching `turn/routes.ts`'s
  pattern). Exhaustive `RepositoryError` → HTTP mapping (`not_found`/`scope` → 404, `invalid` →
  409, `integrity` → 400, `failed` → 500, with a `never` guard).
- `apps/web/app/api/subscriptions/[id]/route.ts` (new) -- thin `withRole(['student'], ...)` wrapper.
- `apps/web/src/subscriptions/PlanView.tsx` (new) -- client view: current package, other offers
  labelled Upgrade/Downgrade/Switch, Pause/Resume (409 on resume → fixed "paused by Edmate" text,
  no resume button), two-step Cancel confirm that shows both export links first.
- `apps/web/app/learn/[agentId]/plan/page.tsx` (new) -- server page. `requireRole(['student'])`
  at the **default** clearance ('age', not 'agent') -- same precedent as the memory and progress
  pages: a student waiting on a parent's consent can still manage their own plan. Maps the live
  subscription's `packageVersionId` back to a public `packageId` via `packageVersions.getById`;
  treats `status === 'ended'` the same as no subscription.
- `apps/web/messages/en.json` (modified) -- added only a new `plan` namespace.
- `apps/web/app/learn/[agentId]/page.tsx` (modified) -- added one nav line to `/plan`.
- `apps/web/src/chat/clearance-scan.test.ts` (modified) -- added the plan page to the scan's
  existing allowlist, alongside the memory and progress pages, for the same documented reason.
- Tests: `change.test.ts` (18 tests), `PlanView.test.tsx` (13 tests, incl. axe), `plan/page.test.tsx`
  (7 tests, incl. axe).

## Tests
- `change.test.ts`: 18/18 -- change/pause/resume/cancel happy paths, scope mismatch, wrong
  subscription id in the URL, every `RepositoryError` kind mapped, oversized body rejected,
  malformed JSON, the getById-miss-after-write fail-closed case (400, never an empty `packageId`).
- `PlanView.test.tsx`: 13/13 -- current package display, upgrade/downgrade labels, no-subscription
  state, successful change/pause/resume/cancel, failed change (fixed alert), network failure,
  409-on-resume text, cancel confirm/keep flow, axe with and without a subscription.
- `plan/page.test.tsx`: 7/7 -- default-clearance guard call, redirect passthrough, notFound for a
  non-live agent, package-version-to-packageId mapping, no lookup when there's no live
  subscription, ended-subscription treated as none, axe.
- Full gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → 34/34 tasks
  green (all suites, including the repo-wide `clearance-scan.test.ts`).
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## How it is shown
A student opens `/learn/<agentId>/plan` from the new "Plan" nav link on the chat page. They see
their current package, status and period end, a list of other live offers labelled Upgrade /
Downgrade / Switch, a Pause or Resume button, and a Cancel button behind a two-step confirm that
offers both the JSON and notes-PDF export links first. Every action is a fixed try/catch/finally
with a busy flag; on success, change/resume/cancel navigate to `/learn/<agentId>` (no `?s=`, so
the next message starts a fresh session); pause re-renders in place.

## Decisions

### 22 Oct 2026 · 9.6d plan page clearance stays at default (age) · decided by builder · risk: low
- Decided: `app/learn/[agentId]/plan/page.tsx` calls `requireRole(['student'])` at the default
  clearance, not `clearance: 'agent'`, and is added to `clearance-scan.test.ts`'s existing
  allowlist (alongside the memory and progress pages).
- Why: `docs/tasks/9.6/plan.md`'s Lead answer says the plan page follows the same precedent as
  the memory page: a student waiting on a parent's consent can still manage their own plan. The
  repo-wide clearance scan (task 9.4 Phase C / 9.6 Phase B) already encodes this exact exception
  for memory and progress; extending it is the documented, minimal fix rather than a new pattern.
- risk: low

### 22 Oct 2026 · 9.6d packageId round-trip via getById fails closed · decided by builder · risk: low
- Decided: after a successful `change`, the handler resolves the new `packageVersionId` back to
  a public `packageId` via `packageVersions.getById`; if that lookup unexpectedly returns null,
  the handler throws `RepositoryError('integrity', ...)`, which the exhaustive switch maps to
  400 (not 500).
- Why: an empty or wrong `packageId` in the response would silently point the client at the
  wrong plan; failing closed with a 400 (a data-integrity problem, not a server crash) matches
  the `invalid`/`integrity` convention already used elsewhere in this handler, and is covered by
  a test ("...fails closed, never an empty packageId").
- risk: low

### 22 Oct 2026 · 9.6d 64KB body cap duplicated locally · decided by builder · risk: low
- Decided: `change.ts` re-implements the same 64KB `readCapped`/`readJson` pattern already used
  in `turn/routes.ts`, as a module-local helper, rather than extracting a shared utility.
- Why: no shared module for this existed yet and the plan's scope for 9.6d is the PATCH route and
  plan page only; extracting a shared helper would touch files outside that scope. Left as a
  "left to do" item below for a future cleanup task.
- risk: low

## Left to do
- Consider extracting the duplicated 64KB body-cap helper (`turn/routes.ts`, `studio/routes.ts`
  at 16KB, and now `subscriptions/change.ts`) into one shared module, in a later cleanup task.
- No payment flow yet (out of scope per 9.6c Q1 = (a); payments are M10).

Status: DONE
Tool calls used: 134

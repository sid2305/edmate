**Status:** DONE

## What changed

- `apps/web/src/subscriptions/change.ts`: `PATCH /api/subscriptions/:id` now falls back to
  `subscriptions.listUnavailableForStudent(studentId)` when `studentTurnScope` (`agents.owner`)
  returns `null`, but only for `action: 'pause'` or `action: 'cancel'` (the Lead's answer
  narrowed the plan's `resume`-included design to pause/cancel only). The fallback matches the
  body's `agentId` against the student's own unavailable rows and builds the scope from that
  row's `teacherId` via `studentScope`; `resume` and `change` are unchanged and still 404 when
  `owner` is `null`. `PlanBackend.subscriptions`'s `Pick` gained `listUnavailableForStudent`, and
  `planHandlers`'s wiring gained it too.
- `apps/web/src/subscriptions/change.test.ts`: added `listUnavailableForStudent` to
  `fakeBackend`'s `Overrides`/returned backend (default `[]`, recorded in `calls`); six new
  cases — pause via the fallback, cancel via the fallback, resume still 404s even with a
  matching fallback row, change still 404s even with a matching fallback row, no match in either
  list still 404s, and the fallback is not called on the live/common path.
- `apps/web/app/learn/[agentId]/plan/page.tsx`: when `agents.owner` is `null`, looks up
  `repos.subscriptions.listUnavailableForStudent(principal.userId)` and matches the agent; if
  found, renders with `agentAvailable={false}` and the matched row's `teacherId` (no new
  enumeration — still 404 when there's no match in either list). A live agent passes
  `agentAvailable={true}` (page code makes "always explicit `true`/`false`, never omitted"
  simplest).
- `apps/web/app/learn/[agentId]/plan/page.test.tsx`: stubbed `listUnavailableForStudent` in the
  auth mock and reset it each test; the existing "non-live or malformed agent gives notFound"
  case now stubs it to resolve `[]`; two new cases — a matching fallback row renders `PlanView`
  with `agentAvailable: false` (and `owner` is called only once, no loop), and a live agent never
  calls `listUnavailableForStudent` and gets `agentAvailable: true`.
- `apps/web/src/subscriptions/PlanView.tsx`: new optional `agentAvailable?: boolean` prop
  (default `true`). When `false`: renders `t('agentUnavailable')` under `noPaymentNotice`; hides
  the "other packages" (change-plan) section and the Resume button (per the Lead's answer,
  beyond the plan's original text); a successful pause or cancel navigates to `/home` instead of
  `/learn/<agentId>` (per the Lead's Q3 answer) — pause still uses `router.refresh()` when
  `agentAvailable` is `true` (unchanged for a live agent).
- `apps/web/src/subscriptions/PlanView.test.tsx`: new case for the notice text plus Pause/Cancel
  still present and not disabled, with no Resume or change controls; extended the axe test with
  a third `agentAvailable={false}` render; new cases for pause-to-`/home` and cancel-to-`/home`;
  a paused subscription with `agentAvailable={false}` shows no Resume button.
- `apps/web/messages/en.json` (`plan` section only): added `"agentUnavailable"`.

## Evidence

- `apps/web/src/subscriptions/change.test.ts` — `createPlanHandlers.patch > pauses via the
  fallback when the agent is suspended but listed as unavailable for the student`,
  `> cancels via the fallback when the agent is suspended but listed as unavailable for the
  student`, `> resume still 404s for a suspended agent even when it is in the fallback list`,
  `> change still 404s for a suspended agent even when it is in the fallback list`,
  `> an agentId matching neither owner nor the fallback list still 404s for pause`,
  `> the fallback is not called when owner resolves (the live path costs no extra query)` — all
  pass (26 tests total in this file).
- `apps/web/app/learn/[agentId]/plan/page.test.tsx` — `PlanPage > task 9.3i: a suspended agent
  with a matching listUnavailableForStudent row renders with agentAvailable: false`,
  `> task 9.3i: a live agent never calls listUnavailableForStudent and renders agentAvailable
  true` — pass (10 tests total in this file).
- `apps/web/src/subscriptions/PlanView.test.tsx` — `PlanView > task 9.3i: agentAvailable=false
  (suspended/draft agent) > shows the blame-free notice and keeps Pause enabled, with no Resume
  or change controls`, `> a successful pause goes to /home, not /learn/<agentId>`, `> a
  successful cancel goes to /home, not /learn/<agentId>`, `> a paused subscription shows no
  Resume button and no "paused by Edmate" text`, plus the extended
  `> has no axe violations, with or without a live subscription` (third render) — all pass (17
  tests total in this file).
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force
  --concurrency=1` → `Tasks: 10 successful, 10 total`, `Time: 1m35.46s` (exit 0); all three test
  files ran (not skipped) — `app/learn/[agentId]/plan/page.test.tsx (10 tests)`,
  `src/subscriptions/change.test.ts (26 tests)`, `src/subscriptions/PlanView.test.tsx (17
  tests)`.
- `python3 .githooks/secret-scan.py --all` → exit 0, clean.

## Decisions

### 24 Oct 2026 · 9.3i a student can pause or cancel a subscription whose agent is suspended · decided by builder · risk: high

- Decided: the `listUnavailableForStudent` fallback in `PATCH /api/subscriptions/:id` is tried
  only for `action: 'pause'` and `action: 'cancel'` (never `resume` or `change`), and only after
  `agents.owner` has already returned `null`. The fallback list itself is scoped to the
  signed-in student's own rows (the method's own contract, shipped unchanged by 9.3f), so the
  route can only ever resolve a subscription the student already owns — it cannot be used to
  discover or act on any other student's or any other agent's subscription.
- Why: `agents.owner` and `studentTurnScope` (used everywhere turn, chat, memory and export
  access is decided) stay byte-for-byte unchanged, so this task cannot widen turn access. Keeping
  `resume` and `change` out of the fallback (narrower than the plan's original Q1 recommendation,
  per the Lead's answer) avoids ever resuming or billing a plan for an agent the student cannot
  use, which matters once payments go live.

### 24 Oct 2026 · 9.3i PlanView hides Resume/change controls and redirects to /home when unavailable · decided by builder · risk: low

- Decided: `PlanView`'s Resume button and the "other packages" (change-plan) section are hidden
  when `agentAvailable === false`, and a successful pause or cancel from that state pushes to
  `/home` instead of `/learn/<agentId>`.
- Why: per the Lead's answers to Q1 and Q3 — the route itself refuses `resume`/`change` for an
  unavailable agent, so showing those controls would only produce a 409/404 the student can't
  act on; `/learn/<agentId>` 404s for a suspended agent, so `/home` is the only working landing
  spot after cancelling or pausing from this page.

## Budget

Tool calls used: 32

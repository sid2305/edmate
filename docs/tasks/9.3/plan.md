# Plan: 9.3 — Package compare and start

## Acceptance (verbatim)

- Board (`docs/board/tasks.yaml`, id `9.3`): "The package unlocks on the next message after
  starting; no payment provider is called."
- Build plan (§ M9): "Package compare and start; until M10 a paid package starts as an active
  subscription with no payment (checkout is 10.8)."

**How it will be shown:** automated tests (unit over an injected backend, and `packages/db`
integration tests against the real Postgres test container) cover the write and read paths and
the route. The end-to-end proof is the one manual browser run the thin slice already uses for
8.1a/8.2 (decision log, 20 Oct 2026): on the dev-compose stack, sign in as the seeded demo
student, reach the demo teacher's two packages (Free and the paid "Full Course"), start the paid
one with no payment screen anywhere, land on `/learn/demo-agent`, send a message and get a reply —
proving the package unlocked on the next message. This run is added to that same existing check,
not a new one.

## Context

Joins the thin slice by human decision B-33 (21 Oct 2026, `docs/decisions/log.md`): the slice is
now 8.1, 8.2, 9.1, 9.3, 9.4. 9.2 (discovery/teacher pages) and 9.6 (upgrade/downgrade/pause) are
**not** in scope; 10.8 (real checkout) replaces the no-payment start later. Payments are out of
scope entirely per CLAUDE.md: "until then a paid package starts with no payment."

Read: `apps/web/src/chat/loadChat.ts`, `apps/web/app/learn/[agentId]/page.tsx` (how 9.4 reached an
agent before discovery existed — the same `agents.owner` public read, the same "any live agentId
works, no slug needed" shape); `packages/db/src/repositories/ports.ts` `entitlementStoreFor`
(confirms `entitle` never checks `periodEnd` against now yet — only `paused`/`ended` are refused,
so the exact period length picked here is cosmetic until M10/9.6); `packages/db/src/repositories/
subscriptions.ts` (`findLive`, the one-live-row-per-pair unique index); `packages/db/src/
repositories/package-versions.ts` (no listing method yet — new); `packages/contracts/src/
teacher.ts` (`PackageConfigSchema`); `packages/db/src/seed.ts` (the demo teacher already has
`agents: live`, and `free`/`paid` packages both with `liveVersion: 1` — this task needs no new
seed data); `apps/web/src/chat/liveChats.ts` + `apps/web/app/home/*` (9.4's `EDMATE_CHAT_AGENTS`/
`demo-agent` stand-in for discovery — reused here, not replaced); `apps/web/app/teacher/
onboarding/{page,OnboardingForm}.tsx` and `apps/web/src/studio/profile.ts` (the page/client-
component/backend-module shape to copy: one client component, a `fromError` map, `MAX_BODY_BYTES`/
`readJson` reuse); `apps/web/src/auth/policy.ts` — **`POST /api/subscriptions` (student, clearance
`agent`) is already a ROUTE_POLICY row**, added when the policy table was built from the build
plan's API surface; only the handler and route file are new, so `policy.ts` itself is not touched
and no new risky-path diff opens there.

Sizing: this spans `packages/db` (risky) and `apps/web` (not risky) and would be ~17 files in one
PR, over the ~8-file/100-tool-call guideline. Split into three phases, each its own branch/PR,
each buildable and testable on its own:

- **Phase A** (`packages/db`): the write and the public read.
- **Phase B** (`apps/web`): the route, the compare-and-start page, no discovery link yet (reachable
  by typed URL, exactly like `/learn/[agentId]` is today).
- **Phase C** (`apps/web`): the `/home` "start a package" link, so the manual run doesn't need a
  typed URL — the same discovery stand-in 9.4 used for the chat link.

Each phase's builder reads this plan and the previous phase's handoff.

---

## Phase A — packages/db: `subscriptions.start` and `packageVersions.liveForAgent`

### Files to create/modify
- `packages/db/src/repositories/subscriptions.ts` — add `start(scope: StudentScope, input: {
  packageVersionId: string; status: 'trial' | 'active'; periodEnd: string }): Promise<
  LiveSubscription>`. Validates input with a strict zod object (`packageVersionId` the existing
  `IdSchema`-shaped id, `status` the two-value enum, `periodEnd` `z.iso.datetime({ offset: true })`
  — mirror `PauseOptions`'s style). Writes with an ownership-checked `insertSelect` (mirror
  `packageVersionsRepo.create`): the row is only inserted when `packageVersionId` belongs to a
  `package_versions` row of `scope.teacherId` (else `not_found` — a stray or foreign id never
  writes). Generate the row id in the method (like other writes do) so the return value needs no
  re-select. The one-live-row-per-pair unique index (`subscriptions_one_live_per_pair_key`) already
  refuses a second live subscription for the same (student, teacher); `translateWrite`'s existing
  unique-violation mapping turns that into `invalid` with no new code. No new schema or migration:
  the table, columns and index already exist. **No status/period-length policy here** — the caller
  decides `status` and `periodEnd` (same split as `entitlementStoreFor.build`, which also takes
  them from its caller); this method only enforces scope and shape.
- `packages/db/src/repositories/package-versions.ts` — add `liveForAgent(scope: { agentId: string
  }): Promise<{ packageVersionId: string; config: PackageConfig }[]>`. A public read, the same kind
  as `agentsRepo.owner` ("the one public scope" — reuse or mirror its `PublicAgentSchema`): joins
  `packages` (`agent_id` = the given id, `live_version is not null`) to `package_versions` (`package_
  id` + `version` = `packages.live_version`), returns each row's own `package_versions.id` alongside
  its decoded `PackageConfig` (the config's own `id` field is the *package* id, not this row id —
  callers need both). Nothing for a draft/suspended/unknown agent, and never another teacher's
  packages by construction (the join is entirely by `agent_id`, never a client-given `teacherId`).
- `packages/db/src/repositories/index.ts` — export the new `LivePackage`-shaped type (name it
  clearly, e.g. `LivePackage`) alongside the existing `LiveSubscription` export; `start`'s input/
  output types need no new export (reuses `LiveSubscription`).
- `packages/db/test/repositories.int.test.ts` — this file's case map is a `Record` over every
  `RepositoryMethod`, so **`tsc` fails** until both new methods have a case:
  - `subscriptions.start`: `scope: 'student'`, a write case in the style of other student-scope
    writes (not `pauseFreeForTeacher`'s teacher-scope shape) — attempt from one pair's scope,
    verify the row lands under that pair and nowhere else, and a `mismatches` table covering: a
    `packageVersionId` belonging to another teacher (`not_found`), and a second `start` for a pair
    that already has a live subscription (`invalid`, from the unique index).
  - `packageVersions.liveForAgent`: `scope: 'public'` (mirror `agents.owner`'s `check` case) —
    returns only the seeded pair's agent's live packages, nothing for a draft/suspended/unknown
    agent id, and confirms the returned `packageVersionId` actually matches the row the seed
    created (not just the package's logical id).
- `packages/db/test/leak.test.ts` — check this file's own doc comment for what it enumerates
  (every repo method whose return value could carry sensitive row content, going by the existing
  `subscriptions.findLive` entry); add `subscriptions.start`'s returned row and `packageVersions.
  liveForAgent`'s returned configs if the file's existing pattern calls for it.

### Tests first
Red tests before implementation, per the TDD workflow: the isolation-grid cases above, plus
unit-level zod-input tests (a malformed `packageVersionId`/`status`/`periodEnd` is `invalid` before
any SQL — mirror `subscriptions.test.ts`-style unit coverage if one exists, else inline in the int
test file like `pauseFreeForTeacher`'s neighbours).

### Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/subscriptions.ts` — under `packages/db/src/repositories/**` →
  reviewers: **security-reviewer** (the "money: payments, subscriptions, ledger..." bucket).
- `packages/db/src/repositories/package-versions.ts` — same bucket → **security-reviewer**.
- `packages/db/src/repositories/index.ts` — same bucket → **security-reviewer**.
- `packages/db/test/repositories.int.test.ts`, `packages/db/test/leak.test.ts` — not matched by
  any glob in risk-paths.txt (tests, not `src/`).
- Plus the usual **code-reviewer** and **typescript-reviewer** (every PR).
- This phase logs a `risk: high` decision on merge (CLAUDE.md rule 6: a risky-path PR needs its
  named reviewers and a `risk: high` handoff entry).

### State after this phase
`packages/db` exposes a scope-safe way to start a no-payment subscription and to publicly list an
agent's live packages. Nothing in `apps/web` calls either yet.

---

## Phase B — apps/web: the compare-and-start page and route

Depends on Phase A merged.

### Files to create/modify
- `apps/web/app/api/subscriptions/route.ts` (new) — `export const POST = withRole(['student'],
  subscriptionHandlers.start)`. The ROUTE_POLICY row already exists (`access: ['student'],
  clearance: 'agent'`); `route-coverage.test.ts` will fail if the wrapper's access disagrees, so no
  `policy.ts` edit is needed or expected.
- `apps/web/src/subscriptions/start.ts` (new) — mirrors `apps/web/src/studio/profile.ts`'s shape
  (`Backend` interface, `fromError`, reuse `MAX_BODY_BYTES`/`readJson`/`TOO_LARGE` from `src/studio/
  routes.ts` or hoist them somewhere shared if that import would be awkward — builder's call, not a
  new concept either way). Body: strict `{ agentId, packageId }` (never a client-given `version` or
  `packageVersionId` — rule: never trust client ids for access-relevant lookups). Flow: `agents.
  owner({ agentId })` → 404 if missing/not live; `packageVersions.liveForAgent({ agentId })` → find
  the entry whose `config.id === packageId` → 404 if none; compute `status`/`periodEnd` from that
  package's `trialDays` (trialDays set and > 0 → `'trial'`, periodEnd = now + trialDays days; else
  `'active'`, periodEnd = now + 30 days — a cosmetic choice per Phase A's note, logged as a
  decision, not a question); call `subscriptions.start({ studentId: principal.userId, teacherId },
  { packageVersionId, status, periodEnd })`; map `RepositoryError('invalid')` (already subscribed)
  to a clear, fixed message — recommend HTTP 409, builder's call on the exact code/message, logged
  as a decision.
- `apps/web/src/subscriptions/start.test.ts` (new) — unit tests over an injected backend (rule 4:
  no real database or model calls in tests).
- `apps/web/app/packages/[agentId]/page.tsx` (new) — `requireRole(['student'], { clearance: 'agent'
  })` (same gate as `/learn`); `agents.owner` → `notFound()` if missing/not live; `subscriptions.
  findLive` on that scope — if already live (any status but `ended`), skip the compare UI and show
  a "you already have a package here — continue to chat" link to `/learn/[agentId]` (sidesteps ever
  hitting the 409 path in the normal flow); otherwise `packageVersions.liveForAgent` and render the
  compare client component. One client component only (8.1a precedent: fold the view into it
  instead of a separate pure `view.tsx`, since there is no second page concern to pass it).
- `apps/web/app/packages/[agentId]/page.test.ts` (new) — mirrors `teacher/onboarding/page.test.ts`'s
  mocking style (`vi.mock('../../../src/auth', ...)`, etc.).
- `apps/web/app/packages/[agentId]/PackageCompare.tsx` (new, `'use client'`) — one card per package:
  name, price (format `pricePerMonth` with `Intl.NumberFormat(..., { style: 'currency', currency })`
  — currency-neutral, not a hardcoded `$`, even though the pilot is US-only), trial days if set,
  daily message limit, live classes per month, skills (reuse `chat`'s skill labels or add a small
  set under a new `packages` namespace — builder's call), and a Start button that `POST`s `{
  agentId, packageId }` to `/api/subscriptions` and on success navigates to `/learn/[agentId]`; on
  failure shows the fixed error text (mirror `OnboardingForm`'s `role="alert"` pattern).
- `apps/web/app/packages/[agentId]/PackageCompare.test.tsx` (new, `@vitest-environment jsdom`,
  mirrors `OnboardingForm.test.tsx`).
- `apps/web/messages/en.json` — add a `packages` namespace (title, per-field labels, trial text,
  start button/states, a fixed `errors.generic` fallback — English-only pilot, per memory).

### Tests first
Unit tests for `start.ts` (`subscriptions/start.test.ts`) and the page/component tests above, red
before green, per the TDD workflow skill.

### Risky paths touched
None of this phase's files match `.claude/skills/merge-gate/risk-paths.txt` (not under `apps/web/
src/auth/**` or `apps/web/app/api/webhooks/**`, and `policy.ts` is untouched). **Reviewers: code-
reviewer, typescript-reviewer** only (MVP-first policy, 20 Oct 2026 — same as 8.1a). No `risk: high`
entry required by the risky-path rule; log the status/period-length and 409-mapping choices as
ordinary (`risk: low`/`medium`) decisions instead.

### State after this phase
A student who already knows a live `agentId` (by typed URL, same as `/learn` before 9.2 existed)
can compare its live packages and start one with no payment; the next `/learn/[agentId]` message
unlocks. Nothing on `/home` links here yet.

---

## Phase C — apps/web: `/home` "start a package" link

Depends on Phase B merged.

### Files to create/modify
- `apps/web/src/chat/liveChats.ts` — add a sibling to `liveChatAgents`/`homeChatLinks` (e.g.
  `startableAgents`/`homeStartLinks`) that, for the same `chatAgentCandidates(env)` list, returns
  the agent ids whose `subscriptions.findLive` is `null` (never subscribed, or a previous
  subscription ended — both are fine to show a Start link for; a `paused` subscription is neither
  "chat" nor "start" — resuming it is 9.6, out of scope, a decision to log, not a question).
- `apps/web/src/chat/liveChats.test.ts` — cover the new function (same failure-shows-nothing
  behaviour as `homeChatLinks` on a repository error).
- `apps/web/app/home/page.tsx` — call the new function alongside the existing one; pass both lists
  to `HomeView`.
- `apps/web/app/home/view.tsx` + `apps/web/app/home/view.test.tsx` — render a second list, "packages
  you can start", each linking to `/packages/[agentId]`, alongside the existing chat list; keep the
  single placeholder only when both lists are empty.
- `apps/web/messages/en.json` — add the one or two new `home` strings this needs (a list label and
  link text).

### Tests first
Extend `liveChats.test.ts`, `home/page.test.ts` (if one exists — check; add if not) and `home/
view.test.tsx`, red before green.

### Risky paths touched
None (same reasoning as Phase B). **Reviewers: code-reviewer, typescript-reviewer.**

### State after this phase
The thin slice's manual browser run can go `/home` → "start a package" → compare → start →
`/learn/[agentId]` → message → unlocked reply, with no typed URL and no payment screen anywhere —
matching the task's acceptance and the harness exit gate's "upgrade → unlocked" shape one milestone
early (9.7's E2E reuses this same path later).

---

## Questions

No blocking open decision — these are my calls, logged as low-risk decisions in each phase's
handoff rather than raised as blockers:

1. **Subscription period length with no payment (30 days).** `entitle` never checks `periodEnd`
   against "now" yet (confirmed by reading `packages/db/src/repositories/ports.ts`), so this value
   is cosmetic until 9.6/M10 give subscriptions a real lifecycle. Recommendation: 30 days for
   `active`, the package's own `trialDays` for `trial` — proceed as planned.
2. **A student who already has a live subscription with a teacher cannot switch packages via this
   task** (that is 9.6's upgrade/downgrade). Recommendation: refuse with a clear message (409),
   proceed as planned; 9.6 picks this up.
3. **No discovery page (9.2) exists**, so Phase C's `/home` link reuses 9.4's `EDMATE_CHAT_AGENTS`/
   `demo-agent` stand-in rather than inventing a new discovery surface. Recommendation: proceed;
   9.2 replaces this stand-in for both the chat link and the new start link together, later.

## Summary

READY. Three phases, each ≲ 10 files and well under the ~100-tool-call guideline: (A)
`packages/db` adds `subscriptions.start` and `packageVersions.liveForAgent` — the only risky-path
diff, needs security-reviewer and a `risk: high` decision; (B) the `/packages/[agentId]`
compare-and-start page and the already-reserved `POST /api/subscriptions` route, reachable by typed
URL; (C) a `/home` link so the manual thin-slice browser run doesn't need one. No schema migration,
no `policy.ts` change, no new seed data — the demo teacher's Free and paid packages already exist.
No payment call anywhere, per CLAUDE.md and the task's own acceptance.

# 9.4e plan — 9.4a review LOWs and left-to-do

## Acceptance (verbatim)
> web and db typecheck, lint and test green.

Shown by: `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` (Phase A) and
`--filter=@edmate/web --filter=@edmate/db` (Phase B) both green, plus each new/changed test file's
own red-then-green run quoted in the handoff.

## Disposition (MVP first — fix cheap and real, defer the rest, reason given)

1. **Playwright `--webpack`** — DEFER. Checked `apps/web/next.config.ts` (`serverExternalPackages:
   ['@edmate/content']` only) and `packages/queue/src` (still imports `bullmq` directly in
   `index.ts`/`queues.ts`/`gate.ts`): nothing has changed since the 9.4a Phase D trial. The dev
   webpack compile of `@edmate/queue`'s bullmq import still breaks `/api/health`. Still a
   `next.config.ts`/`@edmate/queue` matter, not a `playwright.config.ts` one. Left on the board.
2. **Export the harness schemas** — FIX (Phase A). Additive exports only, no new imports, so the
   "harness imports only contracts/zod/mathjs" rule holds and no contracts change occurs (no ADR).
3. **Three 0% `.tsx` files** — PARTIAL FIX (Phase B). `apps/web/app/teacher/page.test.tsx` and
   `apps/web/app/teachers/page.test.tsx` already exist and already exercise both pages (confirmed
   by reading them) — closed by other work since 9.4a's handoff was written. Only
   `apps/web/app/layout.tsx` is still untested; add `layout.test.tsx`. Re-run coverage once to
   confirm all three are now above 0% before closing the item.
4. **`ports.ts` reads `users.market` twice** — DEFER. `identity.learnerStatus` already selects
   `market` but can't return it (its `AgeStatus` return is used by ~15 call sites); a clean fix
   needs a new combined identity method and a reshaped `EntitlementStoreOptions`, touching two
   risky paths (`identity/store.ts`, `ports.ts`) plus every `packages/db/test` access fixture
   (`access-seed.ts`, `entitlement-store.int.test.ts`, `turn-config.int.test.ts`,
   `session-package.int.test.ts`, `style-cards.int.test.ts`, `access-property.int.test.ts`,
   `ask-teacher-loop.int.test.ts`) — 12+ files for one extra indexed PK `SELECT` (sub-ms). Not
   worth the blast radius pre-pilot; left on the board.
5. **README documents the bare-id exception** — FIX (Phase B). Doc-only addition to
   `packages/db/src/repositories/README.md`; not in the other builders' busy-file list.
6. **`listLiveForStudent` grid case order** — DEFER. Lives in
   `packages/db/test/repositories.int.test.ts`, the one shared integration-test file every
   `packages/db` repository task edits; with `publish.ts`/`messages.ts`/`sessions.ts`/`notes.ts`/
   `subscriptions.ts` all mid-edit by other builders right now, touching this file risks a merge
   fight for a test-fragility LOW, not a bug. Sequence as its own tiny follow-up once `packages/db`
   quiets down.
7. **`LiveChat.status` typed as `Entitlement['status']`** — FIX (Phase B).
   `packages/db/src/repositories/subscriptions.ts`'s `listLiveForStudent` already returns
   `Entitlement['status']` (checked) — this is a pure type-tightening in
   `apps/web/src/chat/liveChats.ts` only, no `packages/db` edit.
8. **429 carries `Retry-After`** — FIX (Phase B). `apiError` gains an optional 4th `headers`
   param (backward compatible); the session-start 429 sends
   `Retry-After: ceil(SESSION_START_WINDOW_MS / 1000)` (a conservative fixed value — `take()`
   reports no exact remaining time, and changing its shape is out of scope here).
9. **`turn-backend.ts` sleep clamps NaN** — FIX (Phase B). Guard with `Number.isFinite`.
10. **Duplicate `ended` filter in `liveChats.ts`** — FIX (Phase B), same file as item 7.
    `listLiveForStudent` already excludes `ended` at the DB layer; `homeLinks`'s own
    `live = liveRaw.filter(status !== 'ended')` is redundant with `classifyHomeLinks`'s identical
    check. Drop the outer filter, keep `classifyHomeLinks`'s (it also drives chats/paused).

## Phase A — harness schema exports (packages/harness)
**Files:** `packages/harness/src/guardrails/grounding.ts` (export `VerdictSchema as
GroundingVerdictSchema`), `packages/harness/src/guardrails/adviceGuard.ts` (export `VerdictSchema
as AdviceVerdictSchema`), `packages/harness/src/guardrails/index.ts` (re-export both — risky path,
guardrails group), `packages/harness/src/pipeline/index.ts` (add `export { RouteFallbackSchema }
from './results.js';` — already exported there, not risky), `packages/harness/src/memory/
sessionSummary.ts` (add `export` to `SessionSummarySchema` — `memory/index.ts`'s `export *`
already re-exports it, not risky), `packages/harness/src/index.ts` (add `export {
RouteIntentVerdictSchema } from './routing/modelFallback.js';` — it's already exported from
`routing/index.ts` but that module isn't re-exported at top level; not risky). No internal
behaviour changes — both existing `VerdictSchema` consts stay private and unchanged.
**Then:** `apps/web/src/turn/devModel.test.ts` drops its five hand-copied schemas for the five
real imports; delete the stale "out of bounds for 9.4a" comment.
**Tests first:** none new — this only removes test duplication; the existing `devModel.test.ts`
cases must still pass unchanged against the real schemas.
**Risky paths:** `packages/harness/src/guardrails/**` — reviewers: **code-reviewer** (MVP-phase
list; log `risk: high` per the group's standing rule even though code-reviewer runs on every PR).

## Phase B — apps/web and packages/db fixes
**Files:** `apps/web/src/chat/liveChats.ts` + `liveChats.test.ts` (items 7, 10), `apps/web/src/
auth/errors.ts` + its test (item 8, optional headers param), `apps/web/src/turn/routes.ts` +
`routes.test.ts` (item 8's call site + a new Retry-After assertion), `apps/web/test/
turn-backend.ts` + `turn-backend.test.ts` (item 9), `apps/web/app/layout.tsx`'s new
`layout.test.tsx` (item 3), `packages/db/src/repositories/README.md` (item 5, doc only).
**Tests first:** write the failing assertions (Retry-After header, NaN-clamped sleep, LiveChat
status type via a `satisfies Entitlement['status']` check, layout render) before each fix.
**Risky paths:** `apps/web/src/auth/**` (errors.ts) and `packages/db/src/repositories/**`
(README.md) — reviewers: **security-reviewer** for both; log `risk: high` for the errors.ts
change (shared error-response helper).

## Files out of bounds
`packages/db/src/repositories/{publish,messages,sessions,notes,subscriptions}.ts`, any
`packages/db` migration, `packages/db/test/repositories.int.test.ts`, `packages/db/src/
repositories/ports.ts`, `packages/db/src/identity/store.ts`, `apps/web/src/export/**`,
`apps/web/playwright.config.ts`, `apps/web/next.config.ts`, `packages/queue/**`.

## Budget
Budget: 130 tool calls (2 phases: A 45, B 85; packages: harness, web, db)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test and the secret scan only).

## Gate
Phase A: `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` (exports
changed — this filter also runs every dependent, e.g. `apps/web`, `apps/worker`, `evals`).
Phase B: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/db`.
Both phases: `python3 .githooks/secret-scan.py --all`.

## Exit conditions
Each phase: `Status: DONE` once its own files' tests pass and its gate above is green (or a
failure is confirmed pre-existing/unrelated, named explicitly). `Status: PARTIAL` past its own
budget, or if a file outside this plan needs changing (e.g. a busy `packages/db` file turns out
not free) — hand back rather than widen scope.

## Open questions
None — every item above has a disposition and a reason; nothing here is an open decision.

## Lead amendment (26 Oct 2026)
- Phase B starts only after 8.7i merges, because 8.7i also edits `packages/db/src/repositories/README.md`. A fresh Phase B builder merges main first.
- Items 1, 4 and 6 are deferred. At closeout the lead adds one board task (9.4f) holding all three, so review.md can cite `deferred 9.4f`.
- Phase A must not touch `moderationPatterns.ts`, `moderationIn.ts` or their tests (7.2l is building there).

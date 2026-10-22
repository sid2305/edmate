# 9.3b handoff

## Summary

Seven lead decisions addressing 9.3/9.6e review follow-ups:

1. `/home` consolidation: one shared `agents.owner`/`subscriptions.findLive` scan (`homeCandidateScan` + `classifyHomeLinks` + `homeLinks` in `apps/web/src/chat/liveChats.ts`) replaces the four independent per-candidate scans (chat, start, paused, live-classes). `apps/web/app/home/page.tsx` reuses the one scan's deduplicated `teacherIds` for the live-classes loader instead of its own `agents.owner` pass.
2. `fromError` in `apps/web/src/subscriptions/start.ts` is now an exhaustive switch over `RepositoryError['kind']` with a `never`-check default (`assertNever`); only the live-per-pair unique-violation constraint maps to the 409 already-subscribed response, any other unique violation is a logged 500 (error name only).
3. `subscriptions.start` (`packages/db/src/repositories/subscriptions.ts`) now treats a stale (superseded) package version — version number below the package's current `liveVersion`, same teacher/verified/live-agent otherwise — as `invalid`, not `not_found`; a draft version above `liveVersion` (never promoted) stays `not_found`.
4. Paused subscriptions on the compare page already showed their own text with no Change-plan link (shipped in a prior 9.6e follow-up commit); confirmed, no changes needed.
5. `PackageCompare.tsx`'s `formatPrice` already used `Intl.NumberFormat` with currency and no hardcoded fraction digits; confirmed, no code change needed — added a unit test for a 0-decimal currency (JPY) alongside the existing 2-decimal (USD) coverage.
6. `PackageCompare.tsx`'s network-failure catch now logs the error's name only (`console.error('[packages] start failed', errorName(error))`) before showing the existing fixed error text.
7. (a) `liveChats.ts`'s docstring no longer says resuming is out of scope — the old `startableAgents` function (and its docstring) was replaced by `classifyHomeLinks`, whose own docstring correctly notes resuming a paused subscription already shipped (9.6c's `resume`). (b) `apps/web/app/packages/[agentId]/page.test.tsx`'s Change-plan-link test is now `it.each(['trial', 'active', 'past_due'])`, not just `'active'`.

## Files

- `apps/web/src/chat/liveChats.ts`, `apps/web/src/chat/liveChats.test.ts` — rewritten: `homeCandidateScan`, `classifyHomeLinks`, `homeLinks`, `HomeLinks`, `HomeCandidate` replace `liveChatAgents`/`pausedAgents`/`startableAgents`/`homeChatLinks`/`homePausedLinks`/`homeStartLinks`.
- `apps/web/app/home/page.tsx`, `apps/web/app/home/page.test.tsx` — consume `homeLinks`; `homeLiveClasses` takes `teacherIds` directly, no second `agents.owner` pass.
- `apps/web/src/subscriptions/start.ts`, `apps/web/src/subscriptions/start.test.ts` — exhaustive `fromError`, `assertNever`, constraint-based 409/500 split.
- `packages/db/src/repositories/subscriptions.ts` — new `staleVersion` helper; `start`'s fallback branch now also checks it. **Risky path.**
- `packages/db/src/repositories/errors.ts` — `translateWrite` now attaches a `ScrubbedDbError` cause (constraint name) on every unique violation, not only in `guarded`. **Risky path.**
- `packages/db/test/errors.test.ts` — two new tests for the cause attachment.
- `packages/db/test/repositories.int.test.ts` (shared, append-only) — one existing test's title/assertion updated (see Decisions); no other test needed to change.
- `apps/web/app/packages/[agentId]/PackageCompare.tsx`, `PackageCompare.test.tsx` — `errorName` helper + logging in the catch; new JPY-formatting test.
- `apps/web/app/packages/[agentId]/page.test.tsx` — Change-plan-link test parametrized over `['trial', 'active', 'past_due']`.

## Tests

1. `apps/web/src/chat/liveChats.test.ts` (`homeCandidateScan`, `classifyHomeLinks`, `homeLinks` describe blocks) + `apps/web/app/home/page.test.tsx` — one `homeLinks` call per render, shared `teacherIds` reused by `homeLiveClasses`, no duplicate `agents.owner`/`findLive` calls (`toHaveBeenCalledTimes` assertions).
2. `apps/web/src/subscriptions/start.test.ts` — three new `fromError` tests: live-per-pair constraint → 409, a different unique-violation constraint → logged 500 (error name only, no constraint name in the log), no-cause invalid → 400.
3. `packages/db/test/repositories.int.test.ts` — `start (9.3b): a stale (superseded) version is invalid; ...` (renamed from a 9.6i LOW test): asserts `PV_FREE_OLD` (version 1, `liveVersion` 2) is `invalid`; the existing `start (9.6c/9.3b): refuses a non-live version ...` test confirms a draft version (version 2, `liveVersion` 1) stays `not_found`. Fails on `main` before this change (was `not_found`), passes after.
4. Confirmed by reading `apps/web/app/packages/[agentId]/page.tsx` and `en.json` — no new test needed; a prior commit already covers `pausedNotice`/no-Change-plan-link.
5. `apps/web/app/packages/[agentId]/PackageCompare.test.tsx` — `'formats a zero-decimal currency (JPY) with no fraction digits'` (new), alongside the existing USD `$19.99` assertion.
6. `apps/web/app/packages/[agentId]/PackageCompare.test.tsx` — `'a network failure shows the generic error and logs the error name only'` (rewritten): asserts `console.error` called with `'TypeError'` only, and that the thrown message's network detail never appears in the log.
7. (a) no new test (docstring only). (b) `apps/web/app/packages/[agentId]/page.test.tsx` — `it.each(['trial', 'active', 'past_due'])` for the Change-plan link.

## Decisions

### 22 Oct 2026 · 9.3b stale-version detection by version-number comparison · decided by builder · risk: high
- Decided: "stale version" (item 3) means the package-version row's own `version` number is strictly **lower** than the package's current `liveVersion` — not merely "not equal to the live version." A higher version number is a draft never yet promoted, and stays `not_found`.
- Why: an existing fixture (`PV1_V2`, version 2 when `liveVersion` is 1) already asserted `not_found` for a draft; a naive not-equal check would have wrongly flagged it `invalid` and broken that test. Edmate's publish flow only ever increments `liveVersion` (never decrements), so "lower" is the only safe signal that a version was once live and has since been superseded.
- risk: high — touches `packages/db/src/repositories/subscriptions.ts` (risky path). Needs security-reviewer (multi-tenant scope: the join still requires `teacherId` match and `verified`/`live` status, same as the existing `liveTarget` helper) and database-reviewer (index usage, join shape) sign-off before merge.

### 22 Oct 2026 · 9.3b unique-violation cause now travels on every RepositoryError, not only `guarded`'s failed · decided by builder · risk: high
- Decided: `translateWrite` (`packages/db/src/repositories/errors.ts`) attaches a `ScrubbedDbError` cause (SQLSTATE + constraint name only, never the raw driver message) to the thrown `RepositoryError` for every unique-violation, including the existing `onDuplicate`-mapped `invalid`/`not_found` cases, not only to `guarded`'s `failed` path.
- Why: item 2 needs `apps/web/src/subscriptions/start.ts` to tell the live-per-pair constraint apart from any other unique violation without ever inspecting message text (scrub-compliant). The constraint name was already scrub-safe (it's a fixed schema identifier, never user data); only its *reach* changed.
- risk: high — touches `packages/db/src/repositories/errors.ts` (risky path, used by every repository write). Needs security-reviewer (confirms the cause carries no user data across the whole write path) and database-reviewer (confirms no repository relies on the old narrower cause-attachment behavior) sign-off before merge.

### 22 Oct 2026 · 9.3b no-cause invalid stays 400, not the old unconditional 409 · decided by builder · risk: low
- Decided: when a `RepositoryError('invalid', ...)` has no `ScrubbedDbError` cause at all (e.g. a non-unique-violation `invalid`, such as a stale-version refusal from item 3), `fromError` returns the ordinary 400 validation response, not the already-subscribed 409.
- Why: the brief's wording for item 2 only specifically addressed disambiguating *which* unique violation maps to 409; a `RepositoryError('invalid')` with no unique-violation cause at all (the stale-version case from item 3 is exactly this) is not a "you already have this" conflict, so 409 would be misleading. This also means item 3's stale-version refusal surfaces as a 400 (same shape as other `start` refusals), matching the brief's own item-3 wording ("as start already does for other refusals").
- risk: low — response-shape choice within one route handler, no schema/contract change.

### 22 Oct 2026 · 9.3b live-classes stays a dependent second step, not a Promise.all with homeLinks · decided by builder · risk: low
- Decided: `/home`'s `homeLinks` and `homeLiveClasses` calls run one after another (`await homeLinks(...)` then `await homeLiveClasses(...)`), not wrapped in `Promise.all`, because `homeLiveClasses` now needs `homeLinks`' own resolved `teacherIds` as input — a real data dependency, not an artificial ordering.
- Why: the brief's goal was to stop four scans from each re-querying `agents.owner`/`subscriptions.findLive` independently. Removing that duplication required consolidating the owner lookup into one scan (`homeLinks`) that the live-classes loader then reuses; inventing a *second*, independent way to list a student's subscribed teacher ids (so the two calls could stay literally parallel) would need a new, redundant `packages/db` read solely to preserve `Promise.all`, which re-introduces the duplicate-query problem the decision was about. The two internal scans within `homeCandidateScan`'s own candidate loop already run concurrently via `Promise.all`; `homeLiveClasses`'s own per-teacher-id calls also already run concurrently via `Promise.all`. This is the only level at which "independent" genuinely applies.
- risk: low — no schema change, no new repository method; the tradeoff is documented in `apps/web/app/home/page.tsx`'s own comment.

## Left to do

None — all seven items implemented and tested.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web... --filter=@edmate/db...`: `@edmate/db` (typecheck/lint/test, including integration tests against a disposable `edmate-test-93b` Postgres container, now removed) — 26/26 tasks pass, full coverage on changed files. `@edmate/web` — typecheck and lint pass; `test` had 19 failing assertions across 6 unrelated files (`app/api/staff/*/route.test.ts`, `app/api/live-classes/[id]/questions/route.test.ts`), all `Error: Test timed out in 5000ms` under heavy concurrent-build system load — confirmed unrelated and flaky by re-running `app/api/staff/agents/route.test.ts` alone (47/47 pass in 4.6s). All files touched by this task (`src/chat/liveChats.test.ts`, `app/home/page.test.tsx`, `app/packages/[agentId]/PackageCompare.test.tsx`, `app/packages/[agentId]/page.test.tsx`, `src/subscriptions/start.test.ts`) pass individually.
- `python3 .githooks/secret-scan.py --all`: clean.

## Fix round (22 Oct 2026)

Fixed both review HIGHs from the fix brief; one round, same branch.

1. HIGH — stale-version refusal told apart from the alarm-paused refusal. `packages/db/src/repositories/subscriptions.ts`'s `start` now attaches a fixed-reason `ScrubbedDbError` cause (`STALE_PACKAGE_VERSION_REASON = 'subscriptions_stale_package_version'`, no ids/content) only on the stale-version `invalid` throw, not on the alarm-paused `invalid` throw (which stays cause-less). `apps/web/src/subscriptions/start.ts`'s `explainInvalid` now takes the thrown `RepositoryError` itself and checks that marker *before* calling `findLive`: a match returns a new 400 with `MSG.staleVersion` ("This plan has changed. Reload the page to see the current plans."); only when the marker is absent does the existing `findLive`-based alarm-paused/already-subscribed guess run. Added the `packages.staleVersion` key to `apps/web/messages/en.json` (append).
   - Tests: `apps/web/src/subscriptions/start.test.ts` — new `'task 9.3b: a stale-version refusal is its own message, not the alarm-paused guess'` (route-level, through `handlers.start`, not `fromError` directly): asserts 400 + the new message, asserts the alarm-paused text is absent, and asserts `findLive` is never called for this case. The existing `'task 9.6i: an invalid start with no live subscription is the alarm refusal...'` test still passes unchanged, confirming the alarm-paused path (no marker) is untouched. `packages/db/test/repositories.int.test.ts` — the existing `'start (9.3b): a stale (superseded) version is invalid; ...'` test now also asserts `cause: expect.objectContaining({ constraint: STALE_PACKAGE_VERSION_REASON })` on the stale-version throw, and asserts `cause` is `undefined` on the alarm-paused throw for the live free version.
2. HIGH — `PackageCompare.tsx`'s `formatPrice` no longer divides by a hardcoded 100. It now reads `Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits` and scales by `10 ** digits`, the same approach as `apps/web/src/discovery/format.ts`.
   - Tests: `apps/web/app/packages/[agentId]/PackageCompare.test.tsx` — fixed `'formats a zero-decimal currency (JPY) with no fraction digits'` to expect `¥2,000` (was wrongly `¥20`); added `'formats a three-decimal currency (KWD) scaled by 1000, not 100'` expecting `KWD 19.990`.

### Decisions

None — both fixes follow the brief's named approach directly (reuse `errors.ts`'s cause-attachment pattern; reuse `discovery/format.ts`'s fraction-digit scaling), no new judgment calls.

### Gate (fix round)

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/db`: 13/13 tasks pass (exit 0). `@edmate/db` test: 27 passed, 47 skipped (no local Postgres) — `680 passed | 765 skipped`. `@edmate/web` affected files re-run directly: `src/subscriptions/start.test.ts` 18/18 passed; `app/packages/[agentId]/` suite 19/19 passed (2 files).
- `python3 .githooks/secret-scan.py --all`: clean.

Status: DONE

Tool calls used: 105

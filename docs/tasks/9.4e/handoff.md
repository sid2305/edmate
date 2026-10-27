# 9.4e handoff

Status: DONE

## Decisions

### 26 Oct 2026 · 9.4e risky paths merge · decided by lead · risk: high
- Decided: merge 9.4e's changes on risky paths: packages/harness/src/guardrails/** (adviceGuard.ts, grounding.ts, index.ts export the existing verdict schemas; no behaviour change), apps/web/src/auth/errors.ts (apiError gains an optional headers param; cache-control no-store always wins) and packages/db/src/repositories/README.md (doc only).
- Why: code-reviewer, security-reviewer and typescript-reviewer approved with LOWs only; the only headers caller passes a server-computed Retry-After constant.

### 26 Oct 2026 · 9.4e deferred items and review LOWs to 9.4f · decided by lead · risk: low
- Decided: plan items 1 (Playwright --webpack), 4 (ports.ts reads users.market twice) and 6 (listLiveForStudent grid case order), plus the review LOWs (apiError headers type, layout.test.tsx loose props, README sentence wording), go to board task 9.4f.
- Why: MVP-first; none is a bug, and items 4 and 6 touch busy packages/db files.

### 26 Oct 2026 · 9.4e liveChats teacherIds/liveIds derivation · decided by builder · risk: low
- Decided: `homeLinks` computes `liveIds` and `teacherIds` from `classifyHomeLinks`'s own
  `chats`/`paused` output (`new Set([...chats, ...paused])`, then filtering `live` rows by that
  set), not from a fresh `live.filter((row) => row.status !== 'ended')`.
- Why: the plan's item 10 asks to drop the duplicate `ended` filter and rely on
  `classifyHomeLinks`'s own check, but `liveIds`/`teacherIds` also need an `ended` row excluded
  (the existing `an ended subscription leaves its agent startable again` test requires it) and
  `classifyHomeLinks` only returns agent ids split into `chats`/`paused`, not a filtered row list.
  Deriving `liveIds`/`teacherIds` from its output keeps exactly one place that excludes `ended`
  (`classifyHomeLinks`) while leaving every existing test's expected output unchanged.

### 26 Oct 2026 · 9.4e turn-backend NaN guard scope · decided by builder · risk: low
- Decided: guard only `Number.isNaN(ms)` (clamp to 0), not every non-finite value via
  `Number.isFinite`.
- Why: `Infinity`/`-Infinity` already clamp correctly through the existing
  `Math.min(Math.max(ms, 0), MAX_REAL_SLEEP_MS)` (neither breaks `Math.min`/`Math.max`'s
  ordering); only `NaN` is neither greater than nor less than any number, so it is the one value
  that needs an explicit guard. Treating `Infinity` as `0` instead of `MAX_REAL_SLEEP_MS` would
  be a behaviour change beyond the plan's "sleep clamps NaN" item.

## Phase A

Status: PHASE A DONE

Summary: exported the harness's internal classifier/verdict schemas so `apps/web`'s
`devModel.test.ts` no longer hand-copies them; no behaviour change.

- `packages/harness/src/guardrails/grounding.ts` — renamed the local `const VerdictSchema` to
  `export const GroundingVerdictSchema`, kept `const VerdictSchema = GroundingVerdictSchema;` so
  every existing internal reference is unchanged.
- `packages/harness/src/guardrails/adviceGuard.ts` — same pattern: `export const
  AdviceVerdictSchema`, `const VerdictSchema = AdviceVerdictSchema;`.
- `packages/harness/src/guardrails/index.ts` — re-exports `GroundingVerdictSchema` and
  `AdviceVerdictSchema` alongside each module's existing exports (risky path: guardrails group).
- `packages/harness/src/pipeline/index.ts` — `export { DecideResultSchema, RouteFallbackSchema }
  from './results.js';` (`RouteFallbackSchema` was already exported from `results.ts`, just not
  re-exported at the pipeline barrel).
- `packages/harness/src/memory/sessionSummary.ts` — added `export` to `SessionSummarySchema`
  (`memory/index.ts`'s `export *` already re-exports it).
- `packages/harness/src/index.ts` — added `export { RouteIntentVerdictSchema } from
  './routing/modelFallback.js';` (already exported from `routing/index.ts`, which the top-level
  barrel does not re-export, so added directly from the source module instead of widening the
  top-level surface with a whole new `export *`).
- `apps/web/src/turn/devModel.test.ts` — dropped the five hand-copied schemas
  (`GroundingVerdictSchema`, `AdviceVerdictSchema`, `RouteIntentVerdictSchema`,
  `RouteFallbackSchema`, `SessionSummarySchema`) for the real `@edmate/harness` imports; removed
  the now-unused `AttemptSchema`/`IntentSchema` imports from `@edmate/contracts` and the stale
  "out of bounds for 9.4a" comment block. Test assertions and expected values are unchanged.

Did not touch `moderationPatterns.ts`, `moderationIn.ts`, any `packages/db` file, or
`packages/harness/src/guardrails/moderation*`.


## Gate

- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` — green except one
  pre-existing, unrelated flaky test: `packages/harness/src/pedagogy/modelRequest.test.ts >
  forged teacher-note marker (3.11d) > runs in linear time on long hostile input` fails
  intermittently on timing ratio (`expected ~73-77 to be less than 64`) under machine load; that
  file is untouched by this task. Re-ran it alone twice and it passed both times:
  `corepack pnpm --filter @edmate/harness exec vitest run src/pedagogy/modelRequest.test.ts` →
  `Test Files 1 passed (1)`, `Tests 86 passed (86)`. All other packages (`@edmate/web`,
  `@edmate/worker`, `@edmate/evals`, `@edmate/content`, `@edmate/db`) passed typecheck, lint and
  test. Also ran the touched test files directly:
  `corepack pnpm --filter @edmate/harness exec vitest run src/guardrails src/memory` → `Test Files
  26 passed (26)`, `Tests 1429 passed (1429)`; `corepack pnpm --filter @edmate/web exec vitest run
  src/turn/devModel.test.ts` → `Test Files 1 passed (1)`, `Tests 21 passed (21)`.
- `corepack pnpm exec prettier --check` on the changed files — initially flagged 3 files
  (`grounding.ts`, `sessionSummary.ts`, `devModel.test.ts`); ran `--write` on those three, then
  `--check` on all 7 changed files → `All matched files use Prettier code style!`.
- `python3 .githooks/secret-scan.py --all` — clean, no findings.

## Budget

Tool calls used: 40 (harness count; the builder reported 24)

## Phase B

Status: DONE

Summary: the apps/web and packages/db fixes from the plan's disposition list (items 3, 5, 7, 8, 9,
10). Merged `origin/main` first (8.7i's `publish.ts`/`repositories/README.md` change) before
starting, per the lead amendment.

- `apps/web/src/chat/liveChats.ts` (items 7, 10) — `LiveChat.status` is now `Entitlement['status']`
  (imported from `@edmate/contracts`), not a bare `string`. `homeLinks` no longer re-filters
  `ended` rows itself (`classifyHomeLinks` already does); `liveIds`/`teacherIds` are now derived
  from `classifyHomeLinks`'s own `chats`/`paused` output instead of a second
  `status !== 'ended'` check, so there is exactly one place that drops an `ended` row.
  `apps/web/src/chat/liveChats.test.ts` — `row()`'s `status` param is now `LiveChat['status']`
  (a `string` literal no longer typechecks); added a `@ts-expect-error` assignability check that
  a value outside the enum fails typecheck (confirmed red before the type change: `Unused
  '@ts-expect-error' directive`). No existing test's expected output changed — the ended-row
  cases (`an ended subscription leaves its agent startable again`, `dedupes teacher ids across
  the live list`) still pass the same way, now via the `chats`/`paused`-derived set.
- `apps/web/src/auth/errors.ts` (item 8) — `apiError` gains an optional 4th `headers` param,
  merged into the response's headers alongside (never instead of) `cache-control: no-store`.
  New `apps/web/src/auth/errors.test.ts` (no prior test file existed for this module): covers
  `errorBody`'s retryable set, `apiError`'s default headers, and the new merge behaviour (written
  first; the "merges extra headers" case was red — `expected null to be '60'` — before the change).
- `apps/web/src/turn/routes.ts` (item 8) — the session-start 429 now sends
  `Retry-After: ceil(SESSION_START_WINDOW_MS / 1000)` (a conservative fixed value; the limiter's
  `take()` reports no exact remaining time). Added one assertion to the existing 429 test in
  `apps/web/src/turn/routes.test.ts` for the header value.
- `apps/web/test/turn-backend.ts` (item 9) — `deadlineSafeClock`'s no-cancel `sleep` branch
  guards `ms` with `Number.isNaN` before `Math.min(Math.max(...))`, since `NaN` propagates
  through both unclamped (neither `>` nor `<` any number); `Infinity`/`-Infinity` already clamp
  correctly via `Math.min`/`Math.max` and are unaffected. New test in
  `apps/web/test/turn-backend.test.ts` asserts `sleep(NaN)` clamps to `0`, `sleep(Infinity)` to
  `MAX_REAL_SLEEP_MS`, `sleep(-Infinity)` to `0`; confirmed red first (`sleeps` held `NaN` at
  index 0 before the guard).
- `apps/web/app/layout.test.tsx` (item 3, new file) — `RootLayout` had no test (0% coverage).
  It is a pure server component (no `requireRole`, no data fetch), so the test inspects the
  element tree `RootLayout({ children })` returns directly, rather than mounting into jsdom's
  document (which already owns its own `html`/`body` — rendering another `<html>` into it would
  be invalid). Also asserts `metadata.title`/`description` and the mobile `viewport`. No
  behaviour change to `layout.tsx` itself (per the plan's "PARTIAL FIX": the other two 0% files,
  `teacher/page.test.tsx` and `teachers/page.test.tsx`, already existed and were out of scope here).
- `packages/db/src/repositories/README.md` (item 5, doc only) — added a "Bare-id exception" note
  under rule 1, naming every method that takes a bare id instead of a `TeacherScope`/
  `StudentScope`: the staff-only methods (`teacherProfiles.listPendingForStaff`,
  `reports.listOpenForStaff`/`.review`, `safetyAlerts.listForStaff`/`.acknowledge`,
  `takedowns.create`/`.lift`/`.listActiveForStaff`, the regulated-subjects `listForStaff`/
  `setSubject`/`setApproval`), and `subscriptions.listLiveForStudent`/`.listUnavailableForStudent`
  (cross-teacher-by-design, matching the "Same bare-id scope exception" comments already in
  `subscriptions.ts`).

Did not touch `packages/db/src/repositories/{publish,messages,sessions,notes,subscriptions}.ts`,
any migration, `packages/db/test/repositories.int.test.ts`, `ports.ts`, `identity/store.ts`,
`apps/web/src/export/**`, `playwright.config.ts`, `next.config.ts`, or `packages/queue/**`.

### Decisions (Phase B)
Moved under the top `## Decisions` by the lead.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/db` — green,
  13/13 tasks successful (ran twice: once before, once after a `prettier --write` pass below).
  `@edmate/db`: 81 test files, 1764 passed, 4 skipped. `@edmate/web`: all test files passed
  (coverage report printed, no failures). Also ran the touched/new test files directly:
  `corepack pnpm exec vitest run src/chat/liveChats.test.ts src/auth/errors.test.ts
  src/turn/routes.test.ts test/turn-backend.test.ts app/layout.test.tsx` (from `apps/web`) →
  `Test Files 5 passed (5)`, `Tests 73 passed (73)`.
- `corepack pnpm exec prettier --check` on the changed/new files — initially flagged 5 files
  (`liveChats.ts`, `liveChats.test.ts`, `routes.ts`, `routes.test.ts`, `test/turn-backend.ts`);
  ran `--write` on those five, then `--check` on all 11 touched files → `All matched files use
  Prettier code style!`.
- `python3 .githooks/secret-scan.py --all` — clean, no findings.

## Budget

Phase B tool calls used: 86 (harness count; the builder reported 44). Both phases: 126 of the 130 budget.

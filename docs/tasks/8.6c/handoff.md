# Handoff: 8.6c Studio packages API (Phase C of docs/tasks/8.6/plan.md)

Status: DONE

- Branch: `m8/8.6c-packages-api` (built on local branch `work-86c`)
- Worktree: `.claude/worktrees/agent-a1f59d653947df038`
Tool calls used: 93 (harness counts: build 62, fix round 31)

## Summary

`GET/POST/PUT /api/studio/packages` (teacher only, `withRole(['teacher'])`). Every package in every
response carries `estimate: { typicalMicroUsd, maxMicroUsd, shareOfPrice? }`.

- **GET** → `{ packages: PackageView[], modules: {id,title}[], setup: { styleCard: boolean, styleCardLink: '/teacher/style-card' }, perTurnMicroUsd }`.
  Calls `courses.ensureDefault` (same bootstrap as the outline page), `outline.getOutline`,
  `styleCards.latest`, `packages.listForTeacher`.
- **POST** body (strict): `{ name, moduleIds, skills, helpCeiling, finalAnswers, dailyMessageLimit,
  liveClassesPerMonth, pricePerMonth: { amountMinor }, trialDays?, lockedReply }` → 201 `{ package }`.
  Order: `listForTeacher` (cap check, existing agent) → `styleCards.latest` (none → 409) →
  `courses.ensureDefault` + `agents.ensureDraft` (only when the teacher has no package yet) →
  `packages.create`. Currency is always set to `USD` by the server.
- **PUT** body: `{ packageId, ...same settings }` → 200 `{ package }`; the agent id is the package's
  own row from `listForTeacher` (not in the list → 404, nothing written).
- `PackageView = { packageId, version, liveVersion, draft: PackageDraft, estimate }`. `draft.pricePerMonth`
  includes `currency: 'USD'`; the client strips it (sends `{ amountMinor }` only) when saving.
- Errors (`{ error: { code, message, retryable }, reason?, link? }`): 400 `validation`; 413
  `input_too_large` (before parsing); 404 `not_found` (repo `scope`/`not_found`); 409 `validation` +
  `reason: style_card_required` + `link`; 409 `limit_reached` + `reason: package_limit`; 409
  `validation` + `reason: conflict` (repo `integrity`); 503 `provider_error` + `reason: unavailable`
  (backend can't build, or repo `failed`); 500 `provider_error` + `reason: internal`. Every response
  `cache-control: no-store`. Logs: `studio.packages_failed { reason, error? }` (error *name* only),
  `studio.packages_unavailable { reason }`, `studio.packages_runtime_unavailable { reason }`.
- `costEstimate.ts` (pure, client-importable): `monthlyEstimate`, `costWarning`,
  `COST_WARNING_SHARE_PERCENT = 25`, `ESTIMATE_DAYS`, `PACKAGE_LIMITS` (Q4–Q6 numbers for the Phase D form).

## Files

- `apps/web/src/studio/packages.ts` (new): `createPackageHandlers(backend, fallbackLog)`, `PackagesBackend`, `PackageView`, `STYLE_CARD_LINK`.
- `apps/web/src/studio/packagesRuntime.ts` (new): `createPackagesRuntime(env, hooks)`, `packageHandlers` (process wiring).
- `apps/web/src/studio/costEstimate.ts` (new).
- `apps/web/app/api/studio/packages/route.ts` (new): `GET`, `POST`, `PUT`.
- Tests (new): `packages.test.ts` (58), `costEstimate.test.ts` (16), `packagesRuntime.test.ts` (7).
- Not edited: `apps/web/src/auth/**`, `src/studio/{index,routes,runtime,outline,profile,files}.ts`, `view.tsx`, `en.json`, contracts.

## Tests

- `corepack pnpm vitest run src/studio/packages.test.ts src/studio/costEstimate.test.ts src/studio/packagesRuntime.test.ts` → all pass.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → `Tasks: 34 successful, 34 total`; web `Test Files 66 passed | 1 skipped`, `Tests 1032 passed | 4 skipped`; `costEstimate.ts` 100%, `packages.ts` 100% lines / 97.8% branches (re-run after merging origin/main, see commit).
- `python3 .githooks/secret-scan.py --all` → clean.
- Package cap: `at 20 packages: 409 package_limit, nothing written` (no `ensureDefault`/`ensureDraft`/`create` call) and the race case (repo `invalid` on create → 409 `package_limit`).
- `git diff origin/main -- packages/contracts` → empty.

## Decisions

### 22 Oct 2026 · 8.6c Error codes stay the contract's; a `reason` field names the case · decided by builder · risk: low
- Decided: the lead's codes `package_limit`, `style_card_required`, `internal` are sent as a top-level
  `reason` next to the contract's `error` body; `error.code` stays an `ErrorCode` (`limit_reached`,
  `validation`, `provider_error`).
- Why: `ErrorCode` is a contracts enum; adding codes needs an ADR. The client keys on `reason`.

### 22 Oct 2026 · 8.6c The estimate's share of price is a whole percent, rounded up · decided by builder · risk: low
- Decided: `shareOfPrice` = ceil(max / price × 100); the warning shows above 25.
- Why: integers only (plan); rounding up never hides a warning.

### 22 Oct 2026 · 8.6c GET bootstraps the default course like the outline page · decided by builder · risk: low
- Decided: `GET /api/studio/packages` calls `courses.ensureDefault` so the module list is never empty.
- Why: a package needs at least one module; same behaviour as 8.3's outline GET (lead answer Q1).

### 22 Oct 2026 · 8.6c Cap is checked before any write; a repo `invalid` on create also means the cap · decided by builder · risk: low
- Decided: POST counts `listForTeacher` first (≥ 20 → 409 before `ensureDraft`); a repo `invalid` from
  `packages.create` is also 409 `package_limit` (the body already passed a stricter schema than the repo's).
- Why: the repo reports the cap as `invalid`; the pre-check makes "nothing written" hold.

### 22 Oct 2026 · 8.6c Trial only on a paid package; repo `failed` is 503 · decided by builder · risk: low
- Decided: `trialDays > 0` on a free package is 400; `trialDays: 0` on a free package is dropped. A
  repo `failed` error is 503 `unavailable` (logged by kind); `integrity` is 409 `conflict`.
- Why: Q4 says trials are for paid packages only; `failed` is a database outage, not a bug.

### 22 Oct 2026 · 8.6c A failed backend build is not cached · decided by builder · risk: low
- Decided: `createPackagesRuntime` memoises success only; a failure (no signed set, unpriced model) is logged by code and retried on the next request.
- Why: signing a prompt-pack set or fixing prices should not need a restart. An unpriced model is 503, never a $0 estimate.

### 22 Oct 2026 · 8.6c `PACKAGE_LIMITS` lives in costEstimate.ts · decided by builder · risk: low
- Decided: the Q4–Q6 numbers are one frozen table in `costEstimate.ts` (the only pure, client-importable file in the Phase C list), used by the API schema and for Phase D's form.
- Why: one source of truth without adding a file outside the plan's list.

## Left to do

- Phase D (page, nav link, strings, timed walkthrough).
- Follow-up already noted by 8.6b: share the module-ownership check with `package-versions.ts`.

## Fix round 1

Fixed the HIGH finding on `draftOf` in `apps/web/src/studio/packages.ts`: it built a
`Partial<PackageConfig>`, deleted the 4 server-owned keys by hand, then cast to `PackageDraft`
unchecked. `draftOf` now destructures `PackageConfig` into the kept fields by name and assigns
the result to a `PackageDraft`-typed object literal (no cast): a future field added to
`PackageConfig` would be missing from that literal and fail to compile, instead of leaking to the
client through GET/POST/PUT responses. `PackageDraftSchema` isn't exported from `@edmate/db`, so
this stays in `apps/web` without touching `packages/db` or `packages/contracts`. Added a GET test
in `apps/web/src/studio/packages.test.ts` with an extra unknown field on the stored config,
asserting the returned draft neither carries it nor differs otherwise. Harness tool count: 13.

# 8.6f handoff — Phase A (packages/db) + Phase B (apps/web)

**Status:** DONE

## What changed (Phase A)

- `packages/db/src/repositories/errors.ts`: `RepositoryErrorKind` gets `'limit'` ->
  `CODES.limit = 'limit_reached'`.
- `packages/db/src/repositories/package-write.ts` (new): exports `Tx`, `checkModules(tx,
  teacherId, moduleIds, method)` and `lockPackageRow(tx, teacherId, {packageId, agentId},
  method)`, moved/extracted from `packages.ts`/`package-versions.ts`.
- `packages/db/src/repositories/packages.ts`: imports both helpers; `create` throws `'limit'`
  (not `'invalid'`) at `PACKAGES_MAX`; `saveVersion` calls `lockPackageRow` instead of its own
  inline `for('update')` select; `writeVersion`'s audit `after` now keeps `packageId` alongside
  `version`.
- `packages/db/src/repositories/package-versions.ts`: `create` calls `checkModules` and
  `lockPackageRow` (before its `insertSelect`); the old inline key-share module check is gone. The
  pre-existing `written(result) !== 1` not_found guard is now unreachable (the lock already
  proves the package/teacher/agent match in the same transaction) and is marked
  `/* v8 ignore next */` with a comment, left in place as defence in depth.
- Tests (tests first): `errors.test.ts` (`'limit'` row); `packages.int.test.ts` (cap case now
  expects `kind: 'limit'`; new `PACKAGES_MAX + 1` concurrent-create case; audit-row test now
  expects `after` keys `['packageId', 'version']` and a real id, not `'[redacted]'`);
  `teacher-question-answer.int.test.ts` (new concurrent dismiss-vs-answer case, outcome-only per
  the lead's Q2 answer).

## Evidence

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force` (with
  `TEST_DATABASE_URL` set, dev Postgres already running, no docker compose run): all 8 tasks
  green (typecheck, lint, test): `Tasks: 8 successful, 8 total`.
- `packages/db/test/packages.int.test.ts`: 18 tests passed (17 pre-existing + 1 new concurrent
  cap case); the `PACKAGES_MAX + 1` concurrent `Promise.all` resolved to exactly `PACKAGES_MAX`
  successes and exactly one `kind: 'limit'` failure -- the advisory lock
  (`PACKAGE_LOCK_NAMESPACE`) does serialise `create` under real concurrency; no PARTIAL trigger
  from that condition.
- `packages/db/test/teacher-question-answer.int.test.ts`: 20 tests passed (19 pre-existing + 1
  new); the concurrent dismiss-vs-answer case resolved to exactly one winner, one `not_found`
  loser, and a final status of `'dismissed'` xor `'answered'`.
- Coverage: `src/repositories/**` at 100% statements/functions/lines (the one new gap,
  `package-versions.ts`'s now-unreachable `written(result) !== 1` branch, is `v8 ignore`d with a
  comment explaining why, same pattern as `publish.ts`'s existing ignores).
- `python3 .githooks/secret-scan.py --all`: clean (no output).
- `corepack pnpm turbo run typecheck --filter=@edmate/web`: fails -- see "Left for Phase B".

## Left for Phase B

- Final kind name: `'limit'` (as the lead answered Q1). `CODES.limit = 'limit_reached'`.
- `package-write.ts` exports: `Tx`, `checkModules(tx, teacherId, moduleIds, method): Promise<void>`,
  `lockPackageRow(tx, teacherId, { packageId, agentId }, method): Promise<void>`.
- New finding, out of Phase A's files: `corepack pnpm turbo run typecheck --filter=@edmate/web`
  does not compile after adding `'limit'` to `RepositoryErrorKind`. Four `apps/web` files besides
  `src/studio/packages.ts` have an exhaustive switch/mapping over `RepositoryErrorKind` that
  TypeScript now flags as missing the `'limit'` case (all pre-existing, none touched by this
  plan's Phase A or Phase B file list):
  - `apps/web/src/studio/profile.ts:55`
  - `apps/web/src/studio/questions/routes.ts:141`
  - `apps/web/src/subscriptions/change.ts:136`
  - `apps/web/src/subscriptions/start.ts:87`
  Per the plan's exit conditions ("apps/web's studio packages.ts still checks 'invalid' until
  Phase B, so it should still compile; if it doesn't, stop PARTIAL and name it"), I am stopping
  here rather than editing files outside Phase A's list. Phase B's builder needs to add a
  `'limit'` arm to each of these four switches (each one, from the compiler errors, currently maps
  every `RepositoryErrorKind` to a non-`'limit'` value and TS now requires an exhaustive match) in
  addition to the plan's named `apps/web/src/studio/packages.ts` edit -- this expands Phase B's
  file list by four files. None of the four are in `apps/web/app/api/staff/**` or another
  risk-paths.txt glob, so they do not change Phase B's required-reviewer set, only its scope.

## What changed (Phase B)

- `apps/web/src/studio/packages.ts`: `create`'s catch now checks `error.kind === 'limit'` (was
  `'invalid'`); `fromError`'s switch gets `case 'limit': return packageLimit();`; `list` runs its
  three independent reads (`outline.getOutline`, `styleCards.latest`, `packages.listForTeacher`)
  via one `Promise.all` after the required `courses.ensureDefault` await; a doc comment above the
  module header explains the `reason`/`link` response extras; `draftOf`'s comment now names its
  reliance on `PackageDraft` being `PackageConfigSchema.omit(...)`.
- `apps/web/src/studio/packages.test.ts`: the cap-race mock now throws
  `RepositoryError('limit', ...)`; a new case proves a plain `RepositoryError('invalid', ...)` on
  `create` is a bare 400 (`reason` undefined), not `package_limit`.
- Four pre-existing `apps/web` exhaustive `RepositoryErrorKind` switches, each missing the new
  `'limit'` case after Phase A (none reachable from these files' repo calls, so each is mapped to
  its closest client-error response with a one-line comment — see Decisions):
  `apps/web/src/studio/profile.ts`, `apps/web/src/studio/questions/routes.ts`,
  `apps/web/src/subscriptions/change.ts`, `apps/web/src/subscriptions/start.ts`.
- No other `apps/web`, `apps/worker` or `apps/cli` file needed a fix:
  `corepack pnpm turbo run typecheck --filter=...@edmate/db` (covers every package depending on
  `@edmate/db`, i.e. `@edmate/db`, `@edmate/web`, `@edmate/worker`) was green with no other
  changes; `apps/cli` has no `RepositoryErrorKind` switch at all.

## Evidence (Phase B)

- `corepack pnpm turbo run typecheck --filter=...@edmate/db`: `Tasks: 11 successful, 11 total`
  (covers `@edmate/db`, `@edmate/web`, `@edmate/worker`).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force`: `Tasks: 10
  successful, 10 total`; `src/studio/packages.test.ts` 60 tests passed; `Test Files 153 passed |
  4 skipped (157)`; `src/auth/index.test.ts` passed its 27 tests in ~26s (no timeout seen; not
  re-run).
- `python3 .githooks/secret-scan.py --all`: clean (no output).

## Decisions

### 25 Oct 2026 · 8.6f Phase A: a distinct `RepositoryErrorKind` for the package cap, and a shared package-row lock · decided by builder · risk: high

- Decided: added `'limit'` to `RepositoryErrorKind` (mapping to the existing contracts
  `ErrorCode` `'limit_reached'`) so `packages.create`'s cap refusal is no longer reported as the
  same `'invalid'` used for unrelated bad writes; extracted `checkModules` and a new
  `lockPackageRow` helper into `packages/db/src/repositories/package-write.ts` so
  `packages.ts`'s `saveVersion` and `package-versions.ts`'s `create` lock the same package row
  the same way; `packages.ts`'s `package.save` audit `after` now keeps the package id (8.7h
  already fixed the audit redactor's UUID handling, so the old omission was working around a bug
  that no longer exists).
- Why: a real repo `'invalid'` on `packages.create` (for example a stray unique-violation) was
  previously indistinguishable from "you're at the package limit," which could mislead a caller
  into showing the wrong error to a teacher; two writers taking the package row lock in
  inconsistent ways is exactly the deadlock-class risk `docs/lessons.md` already flags from
  8.7a, so sharing one lock helper closes that class of bug before it can happen here.

### 25 Oct 2026 · 8.6f Phase A: apps/web has four more exhaustive `RepositoryErrorKind` switches than the plan listed · decided by builder · risk: low

- Decided: did not edit `apps/web/src/studio/profile.ts`,
  `apps/web/src/studio/questions/routes.ts`, `apps/web/src/subscriptions/change.ts` or
  `apps/web/src/subscriptions/start.ts` -- none are in Phase A's file list, and editing them was
  not authorized by this plan.
- Why: the plan's exit conditions name exactly this situation ("if it doesn't [compile], stop
  PARTIAL and name it") rather than asking the builder to silently expand scope into unlisted
  files; Phase B's builder (or a follow-up) should add the `'limit'` arm to all four switches
  alongside the plan's named `packages.ts` edit.

### 25 Oct 2026 · 8.6f Phase B: four pre-existing `apps/web` switches map the new `'limit'` kind to their closest client-error response · decided by builder · risk: low

- Decided: `apps/web/src/studio/profile.ts` and `apps/web/src/studio/questions/routes.ts` group
  `'limit'` with `'invalid'`/`'integrity'` (a plain 400 `validation`); `apps/web/src/
  subscriptions/change.ts` groups it with `'invalid'` (the action-specific 409); `apps/web/src/
  subscriptions/start.ts` maps it the same as `'integrity'` (a plain 400 `validation`). Each
  switch keeps a one-line comment saying the repo call behind it (`teacherProfiles`,
  `teacherQuestions`, subscription plan changes, subscription start) has no cap and so can never
  actually raise `'limit'` — the case exists only so the exhaustive switch (each file's own
  `const unreachable: never` / `assertNever` pattern) still compiles. No test was added for any
  of the four: none of their repo calls can reach `'limit'`, so there is nothing reachable to
  assert (per the brief: "Add a test only where a mapping is reachable").
- Why: each of these four files' exhaustive switch is a defence against a *future* repo call
  starting to raise a kind the switch doesn't expect; today none of the four routes' calls
  (`teacherProfiles.*`, `teacherQuestions.*`, subscription change/start) go through any capped
  write, so there's no live path to `'limit'` to test — grouping with the nearest existing
  client-error response keeps each file compiling without inventing a cap-specific response a
  caller can't actually trigger.

## Budget

Tool calls used: 64
Phase B tool calls used: 24

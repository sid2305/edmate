# 8.6f plan — 8.6b/8.6c/8.9a review follow-ups: concurrent package-cap test, shared package
locking, a named cap error kind, and the audit UUID fix

Status: READY

## Acceptance (verbatim from the board)

> a concurrent create test at the cap boundary passes; package-versions writes take the package
> row lock; an audit after with a UUID keeps the UUID.

How it will be shown:
- `packages/db/test/packages.int.test.ts` (new case): `PACKAGES_MAX + 1` concurrent
  `packages.create` calls for one teacher (`Promise.all`) resolve to exactly `PACKAGES_MAX`
  successes and exactly one failure with `kind: 'limit'` — the existing per-teacher advisory lock
  (`PACKAGE_LOCK_NAMESPACE`) already serialises `create`; this proves it holds under real
  concurrency, not just the existing sequential loop.
- `packages/db/src/repositories/package-versions.ts`'s `create` takes a `for('update')` lock on
  the package row (shared helper, same lock `packages.saveVersion` already takes) before its
  insert; proven by reusing `packages.int.test.ts`'s existing grid plus one new assertion that the
  shared helper is actually called (see "Design" below — no new int test needed beyond coverage,
  since the lock only changes *when* two writers serialise, which the existing single-writer tests
  already exercise correctly end-to-end).
- `packages/db/test/packages.int.test.ts`'s existing `package.save` audit-row test: `after` now
  has keys `['packageId', 'version']` (not just `['version']`), and `after.packageId` equals the
  real (digit-led-capable) package id — not `'[redacted]'`.

## Context (read before building)

Source findings: `docs/tasks/8.6b/review.md`, `docs/tasks/8.6c/review.md`,
`docs/tasks/8.9a/review.md`. Per-item disposition (board title order):

1. Concurrent `PACKAGES_MAX` test (8.6b MEDIUM) — **build**, see Design #1.
2. Concurrent dismiss-vs-answer test (8.9a LOW) — **build**, see Design #4 (cheap, same PR,
   `packages/db` only; database-reviewer already assessed the race in 8.9a's own review — this
   just adds the missing test, no behaviour change).
3. A distinct error kind for the package cap (8.6b LOW + 8.6c LOW, same fix) — **build**, see
   Design #2. No contracts change: `RepositoryErrorKind` lives in
   `packages/db/src/repositories/errors.ts`, not `packages/contracts`, and the `ErrorCode`
   `'limit_reached'` it maps to already exists in `packages/contracts/src/shared.ts` — no ADR.
4. Share the module check and version locking between `packages.ts` and `package-versions.ts`
   (8.6b LOW) — **build**, see Design #3.
5. `ModelPolicySchema` in `DraftAgentInput` (8.6b LOW) — **close with reason**: `agents.ts`'s
   `ensureDraft` immediately re-parses `d.modelPolicy` through the full `AgentConfigSchema`
   (`modelPolicy: ModelPolicySchema`, `packages/contracts/src/teacher.ts`) two lines after
   `DraftAgentInput` validates — there is no runtime validation gap, only a looser type at one
   intermediate step. Pure type-tightening with zero behaviour change; not touched here to keep
   this PR's `packages/db/src/repositories/**` diff to the locking/error-kind/audit work the
   accept line actually asks for.
6. The audit redactor treats digit-led UUIDs as phone numbers (8.6b LOW) — **build, but the
   redactor itself needs no change**: `packages/db/src/repositories/redact-json.ts` already
   carves UUID spans out of phone-candidate matching (task 8.7h; see its own
   `redact-json.test.ts`, including a 10,000-UUID property test and crafted all-digit-group
   cases). The actual fix is in `packages.ts`: stop working around the (already-fixed) old bug by
   omitting the id, and prove the real round trip. See Design #5.
7. `Promise.all` for the independent reads in `packages` list (8.6c MEDIUM) — **build**: cheap,
   same file already touched for item 3's studio-side change, no new risk path. See Design #6.
8. (duplicate of item 3 — one fix.)
9. Document the studio error `reason`/`link` fields (8.6c LOW) — **build**: one doc comment,
   bundled into the same `apps/web/src/studio/packages.ts` edit as items 3/7/10 (near-zero extra
   cost).
10. The `draftOf` comment notes it relies on `PackageDraft` being `PackageConfigSchema.omit(...)`
    (8.6c LOW) — **build**: one-line comment, same bundle as item 9.

Current shapes read for this plan: `packages/db/src/repositories/packages.ts`,
`package-versions.ts`, `errors.ts`, `agents.ts`; `packages/db/test/packages.int.test.ts`,
`errors.test.ts`, `teacher-question-answer.int.test.ts`; `apps/web/src/studio/packages.ts`,
`packages.test.ts`.

## Design (one sentence each)

1. **Concurrent cap test**: in the existing `stops at PACKAGES_MAX` describe block, a new case
   fires `PACKAGES_MAX + 1` concurrent `repos.packages.create(MANY, {...})` calls via
   `Promise.all` (each wrapped to capture success/`RepositoryError` rather than reject the whole
   `Promise.all`), then asserts exactly `PACKAGES_MAX` resolved and exactly one has
   `kind: 'limit'`, and `packageCount(MANY.teacherId) === PACKAGES_MAX` after.
2. **Named cap kind**: `errors.ts` adds `'limit'` to `RepositoryErrorKind` and
   `CODES.limit = 'limit_reached'` (already a valid `ErrorCode`). `packages.ts`'s `create` throws
   `new RepositoryError('limit', method)` (not `'invalid'`) when `n!.n >= PACKAGES_MAX`.
   `apps/web/src/studio/packages.ts`'s `create` catch checks `error.kind === 'limit'` (not
   `'invalid'`), and `fromError`'s switch gets its own `case 'limit': return packageLimit();` —
   a genuine `'invalid'` from the repo (for example a stray unique-violation) now correctly falls
   through to a plain 400, instead of being misreported as "you're at the package limit."
3. **Shared module check + package-row lock**: new `packages/db/src/repositories/
   package-write.ts` exports `Tx`, `checkModules(tx, teacherId, moduleIds, method)` (moved
   verbatim from `packages.ts`) and `lockPackageRow(tx, teacherId, {packageId, agentId}, method)`
   (the `for('update')` select `packages.saveVersion` already does, extracted). `packages.ts`
   imports both (its own `checkModules` definition is deleted; `saveVersion` calls
   `lockPackageRow` instead of its inline select). `package-versions.ts` imports both: its inline
   key-share module check (lines ~224-231) becomes one `checkModules` call, and `create` calls
   `lockPackageRow(tx, teacherId, { packageId: c.id, agentId: c.agentId }, method)` before the
   `insertSelect` — the same lock discipline both writers now share (`docs/lessons.md`'s "Two
   writers that lock the same rows in different orders deadlock" is exactly the risk this
   closes).
4. **Concurrent dismiss-vs-answer**: one new case in `teacher-question-answer.int.test.ts`: open
   one ungrouped question, then `Promise.all([dismiss(...), answer(...)])` (each caught, not
   rejecting the pair) on the same question id; assert exactly one resolves and the other is
   `kind: 'not_found'`, and the row's final status is `'dismissed'` xor `'answered'` (never both,
   never a write from the loser). Unforced (no raw second-connection lock-step, unlike the
   deadlock tests above it in this file) — the existing `/* v8 ignore */` comments on `answer`'s
   race branches already document that forcing this exact interleaving needs manual two-connection
   lock-stepping and isn't required for this finding; database-reviewer's 8.9a note ("whichever
   statement takes the row first wins") is what this test checks.
5. **Audit keeps the id**: `packages.ts`'s `writeVersion` changes `after: { version: ids.version
   }` to `after: { packageId: ids.packageId, version: ids.version }`, and the comment explaining
   the old omission is replaced with one line noting 8.7h already fixed the redactor's UUID
   handling.
6. **`Promise.all` in studio `list`**: after `await b.repos.courses.ensureDefault(scope)` (must go
   first — it bootstraps the course `outline`/`packages` may depend on), `outline.getOutline`,
   `styleCards.latest` and `packages.listForTeacher` run via one `Promise.all` instead of three
   sequential awaits.

## Files to create / modify (one phase, two sub-phases — see Budget)

### Phase A — `packages/db` (risky: `packages/db/src/repositories/**`)

No migration; no contracts change.

1. `packages/db/src/repositories/errors.ts` — add `'limit'` kind (Design #2).
2. `packages/db/src/repositories/package-write.ts` (**new**) — `Tx`, `checkModules`,
   `lockPackageRow` (Design #3).
3. `packages/db/src/repositories/packages.ts` — import from `package-write.ts`; `create` throws
   `'limit'`; `saveVersion` uses `lockPackageRow`; `writeVersion`'s `after` keeps `packageId`
   (Design #2, #3, #5).
4. `packages/db/src/repositories/package-versions.ts` — import `checkModules`/`lockPackageRow`
   from `package-write.ts`; `create` locks the package row before its insert (Design #3).
5. Tests (tests first):
   - `packages/db/test/errors.test.ts` — add `['limit', 'limit_reached']` to the existing
     `it.each` kind-to-code table.
   - `packages/db/test/packages.int.test.ts` — the existing `stops at PACKAGES_MAX` case's
     single-race assertion (`kind: 'invalid'`) becomes `kind: 'limit'`; new concurrent-create
     case (Design #1); the `package.save` audit-row test's `Object.keys(after)` and value
     assertions updated (Design #5, acceptance line 3).
   - `packages/db/test/teacher-question-answer.int.test.ts` — one new concurrent dismiss-vs-answer
     case (Design #4).
   - Coverage: `src/repositories/**` stays at 100% statements/functions/lines (the new
     `package-write.ts` is exercised through both callers' existing and new tests — no new direct
     unit test file needed unless coverage shows a gap).
   - Run: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`; secret scan.

### Phase B — `apps/web` (not risky by path: `apps/web/src/studio/**` is not in
`apps/web/app/api/staff/**` or any other risk-paths.txt glob)

6. `apps/web/src/studio/packages.ts` — `create`'s catch checks `'limit'`; `fromError` gets
   `case 'limit'`; `list`'s three independent reads run via `Promise.all` (Design #2, #6); one
   doc comment above the `reason`/`link` extras explaining the shape (item 9); one line added to
   `draftOf`'s comment naming its `PackageConfigSchema.omit(...)` reliance (item 10).
7. Tests (tests first):
   - `apps/web/src/studio/packages.test.ts` — the "repo refusing the cap in a race" mock becomes
     `new RepositoryError('limit', 'packages.create')`; one new case proves a plain `'invalid'`
     from `packages.create` (not the cap) is a bare 400, not `package_limit` (locks in the fix's
     value); existing `list` tests are unchanged regression coverage for the `Promise.all` (they
     assert final output, not call order, for `GET`).
   - Run: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`; secret scan.

## Files out of bounds

`packages/contracts/**` (no new code or ADR needed — see Design #2). `packages/db/src/
repositories/agents.ts` (item 5, closed with reason). `apps/web/app/api/staff/**`,
`apps/web/app/api/webhooks/**`, `apps/web/src/auth/**`, `apps/web/app/api/auth/**` (unrelated).
Any migration (none needed — no schema change).

## Risky paths touched (checked against risk-paths.txt)

- `packages/db/src/repositories/errors.ts`, `package-write.ts` (new), `packages.ts`,
  `package-versions.ts` — group "access filter / money / data isolation"
  (`packages/db/src/repositories/**`): required reviewer `security-reviewer`. Recommended as
  well: `database-reviewer` (shared row locking across two writers — exactly the deadlock-class
  risk `docs/lessons.md` flags), `code-reviewer`, `typescript-reviewer`.
- `apps/web/src/studio/packages.ts` — not risky by path (not under `apps/web/app/api/staff/**`
  or any other risk-paths.txt glob); `code-reviewer`, `typescript-reviewer` on general principle,
  not required by the gate.
- No `packages/contracts/**`, `docs/adr/**`, `.claude/**`, migration or locale change.
- This task's handoff logs a `risk: high` decision (below) for the Phase A change.

## Decisions to log (handoff `## Decisions`, risk: high)

1. "A new `RepositoryErrorKind` (`'limit'` → `ErrorCode` `'limit_reached'`, already in
   `packages/contracts`) replaces the overloaded `'invalid'` for the package cap, so a genuine
   repo `'invalid'` on `packages.create` no longer reports as `package_limit`. A new
   `package-write.ts` shares the module-ownership check and the package row lock between
   `packages.ts` and `package-versions.ts`, so both writers lock the same row the same way
   (closing the 8.6b LOW). `packages.ts`'s audit `after` now keeps the package id (8.7h already
   fixed the redactor; this task stops working around the old bug). `agents.ts`'s
   `DraftAgentInput` (item 5) is closed with reason, not built — `AgentConfigSchema` already
   validates `modelPolicy` at runtime two lines later."

## Open questions (all non-blocking; recommendations are what the plan builds)

- Q1 Kind name: `'limit'` vs. something more specific (`'package_limit'`, `'quota'`). Recommended
  `'limit'` — matches the existing one-word style (`scope`, `not_found`, `invalid`, `integrity`,
  `failed`) and this is the only cap in `packages/db` today; a second cap elsewhere can reuse it
  or rename later without a contracts change either way.
- Q2 Forced two-connection lock-step vs. a plain `Promise.all` for the dismiss-vs-answer test.
  Recommended plain `Promise.all` (Design #4) — 8.9a's own review already assessed the race
  mechanism; this test documents the outcome, not a specific interleaving, and avoids adding
  another flaky-timing risk (`docs/lessons.md`'s wall-clock-bounds lesson is adjacent caution).

## Budget

Budget: 65 tool calls (2 phases, packages/db + apps/web)
- Phase A (packages/db): 45 tool calls.
- Phase B (apps/web): 20 tool calls.

Two Sonnet builders (one per phase, sequential), one branch, one PR
(`m13/8.6f-package-lock-and-cap-kind`). Phase B's builder reads Phase A's handoff before starting
(needs the final `'limit'` kind name and `package-write.ts`'s exports).

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for `@edmate/db` and `@edmate/web`,
the secret scan, git add/commit/push on the task branch only).

## Exit conditions

- `Status: DONE`: the tests above exist and pass (tests first), both packages' typecheck, lint
  and test are green with the db coverage threshold met, secret scan clean, handoff written with
  `Tool calls used:` and the `risk: high` decision.
- Stop at `Status: PARTIAL` when past each phase's call budget, when a file outside this plan
  needs a change, or when the concurrent-create test proves the advisory lock does **not** fully
  serialise `create` under real concurrency (more than one success over `PACKAGES_MAX`, or more
  than one failure) — that would be a real bug in existing code, not this task's scope to fix
  silently; stop and name it.

## Lead answers (25 Oct 2026)
- Q1: use `'limit'`, as recommended.
- Q2: use a plain `Promise.all`, as recommended. Assert only the outcome: exactly one winner, the loser gets `not_found`, and the final status is one or the other. Don't assert which call wins.
- Reviewers: Phase A gets security-reviewer, database-reviewer, code-reviewer and typescript-reviewer. Phase B gets code-reviewer and typescript-reviewer. The lead logs a `risk: high` merge decision.
- Each phase is a fresh Sonnet builder on the same branch, and the PR opens after Phase B. Phase A's budget is 45 calls, stopping at 55; Phase B's is 20, stopping at 28.

# Handoff: 9.3 — Package compare and start

## Status
Phase A done; B and C left (per plan: three phases, one PR each).

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
- `corepack pnpm vitest run test/repositories.int.test.ts test/leak.test.ts` → 84 passed.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` → 26 tasks successful; `@edmate/db`
  test: 793 passed, 4 skipped (unrelated `.skip`s); coverage 100% branch/stmt/func/line on
  `src/repositories/subscriptions.ts`, `package-versions.ts`, `index.ts`.
- `python3 .githooks/secret-scan.py --all` → clean.

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

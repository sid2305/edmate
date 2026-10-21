**Status:** DONE

## Summary
Added `learnerProfilesRepo.rebuildMastery(scope)` (`packages/db/src/repositories/learner.ts`):
same row-lock pattern as `applyEvidenceMastery` (insert-default-row `ON CONFLICT DO NOTHING`, then
`SELECT ... FOR UPDATE`), but reads **every** `evidence_events` row for the scope (`ORDER BY ts
ASC, id ASC`) and folds them from an **empty** mastery map via the existing `foldMastery` —
discarding whatever is currently stored rather than merging onto it. Always uses `BKT_DEFAULTS`
(no param override). Returns the rebuilt `LearnerProfile`. No contracts change, no migration, no
`packages/harness` change — matches the plan's design exactly.

## Files
- `packages/db/src/repositories/learner.ts` — new `rebuildMastery` method.
- `packages/db/test/mastery.test.ts` — two new pure-fold tests, hand-computed BKT reference values
  (topic A: correct/correct/incorrect → 0.600, 0.8903225806451613, 0.5781021897810219; topic B:
  incorrect → 0.17575757575757575), each `toBeCloseTo(x, 3)`.
- `packages/db/test/profile-store.int.test.ts` — integration test seeding events for two topics
  (own teacher's topic + a new `top_rebuild_b`) out of chronological insertion order, asserting the
  rebuilt/stored mastery matches the hand-computed values to 3 decimals and the pure fold exactly
  (`toBeCloseTo(x, 10)`); asserts a stale/corrupted mastery value is discarded, not merged, and
  `mistakes`/`lastSummary` are untouched; a malformed-scope rejection test.
- `packages/db/test/repositories.int.test.ts` — isolation-grid case for `rebuildMastery`
  (`owns: () => true`, same shape as `applyEvidenceMastery`'s entry).

## Tests
- `packages/db/test/mastery.test.ts`: 16 → 18 tests, all pass (pure, no DB).
- `packages/db/test/profile-store.int.test.ts`, `repositories.int.test.ts`, `mastery.test.ts`
  together (Postgres via docker compose): 117 tests, all pass.
- Full `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`: 26/26 tasks green;
  `learner.ts` reports 100% coverage.
- `python3 .githooks/secret-scan.py --all`: clean, no output.

## Deviations
- The plan's design used `ids.topic('B')` as a second topic for the integration test, but the
  shared seed (`isolation-seed.ts`) gives each teacher only **one** topic — `ids.topic('B')`
  belongs to a different teacher and is correctly rejected as unowned. Inserted a fresh topic
  (`top_rebuild_b`) owned by `own.teacherId` instead, so the test has two topics under one teacher
  as the plan's table requires. Low risk, test-only.
- The isolation-grid attempt (`repositories.int.test.ts`) timestamps its evidence event relative to
  real `Date.now()` rather than a fixed 2026 date: `isolation-seed.ts` seeds one evidence event per
  pair with no explicit `ts` (defaults to real insertion time), which would otherwise sort *after*
  a fixed-2026-date event and make the grid's own write look stale. Low risk, test-only; found by
  running the new test, not anticipated in the plan.
- Cut the plan's "optional, nice-to-have" concurrency test (rebuildMastery vs. concurrent
  applyEvidenceMastery) — the plan itself flags this as first-to-cut if budget is tight; the shared
  row-lock (same as `applyEvidenceMastery`'s already-reviewed pattern) structurally guarantees no
  interleaving, and budget was tight after the two debugging rounds above.

## Decisions
### Rebuild is a `packages/db`-internal method, not a `ProfileStore` port method
Matches the plan's design and 3.17's own precedent (`applyMastery`/`applyEvidenceMastery` are not
on the port either). No ADR.
risk: low

### `risk: high` — new write path in `packages/db/src/repositories/learner.ts` (risky path)
Per CLAUDE.md rule 6 and the plan: this PR touches `packages/db/src/repositories/**`, the
security-reviewer group. Reviewers for this PR: security-reviewer (plus default
code-reviewer/typescript-reviewer).
risk: high

Tool calls used: 29

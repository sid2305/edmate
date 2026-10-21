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
- **Correction (fix round 1): the cut concurrency test was right to flag as a gap, wrong on why it
  was safe to skip.** The original handoff said "the shared row-lock... structurally guarantees no
  interleaving" — that was wrong. `applyEvidenceMastery` and `evidenceEvents.append` were two
  *separate* transactions, so the row lock only ever covered the second one; nothing locked the gap
  between them, and a `rebuildMastery` racing in that gap could double-count an event (fix round 1,
  finding 1). See "Fix round 1" below for the actual fix (one transaction, lock-before-insert).

## Fix round 1 (6.2)
Fixed all three findings from review:
1. **[HIGH] Race: `applyEvidence`'s append and fold were two transactions, not one.** Added
   `evidenceEventsRepo.appendAndFold(scope, events)` (`packages/db/src/repositories/learner.ts`):
   one transaction that locks topics (`key share`, same order as every other method here), then
   locks the `learner_profiles` row (insert-default, `SELECT ... FOR UPDATE`) **before** inserting
   the events, then inserts them (idempotent, `ON CONFLICT (id) DO NOTHING`) and folds only the
   newly-inserted rows onto the locked mastery. `rebuildMastery` locks the same row first, so the
   two now fully serialise — no gap for either to observe an event inserted but not yet folded.
   `profileStoreFor.applyEvidence` (`ports.ts`) now calls this one method instead of
   `evidenceEvents.append` + `learnerProfiles.applyEvidenceMastery` back to back. The old
   `applyEvidenceMastery` method is untouched (still directly tested, no longer called from
   `applyEvidence`'s production path) — kept rather than removed, since nothing in the findings asked
   for its removal and removing it would have touched more test call sites for no behaviour change.
   Test: `packages/db/test/profile-store.int.test.ts` — "applyEvidence racing a concurrent
   rebuildMastery never double-counts an event" races `store.applyEvidence` against two concurrent
   `rebuildMastery` calls, 5 times in a row (one event added per round), then asserts the stored
   mastery's `n` and `p` equal a fresh, from-scratch `rebuildMastery` over the complete history, and
   the first-3-events value matches the plan's hand-computed `0.5781021897810219` (`toBeCloseTo`, 3).
2. **[MEDIUM] Rebuild-vs-incremental agreement was never tested.** Extended the existing rebuild
   test (same `it` block, so it can reuse the already-seeded events and the already-computed
   `rebuilt` value) with a second scope (`stu_rebuild_agree`) that replays the same ordered events
   one by one through `profileStoreFor.applyEvidence` (the incremental path), then asserts its
   stored mastery's `p` (`toBeCloseTo`, 3) and `n` (exact) match `rebuildMastery`'s result on the
   first scope, for both topics.
3. **[LOW] `locked!` in `rebuildMastery`.** Replaced with `if (!locked) throw new
   RepositoryError('scope', method);`, matching this module's error style everywhere else. Added
   the identical check to the new `appendAndFold`'s own row-lock select. Both are genuinely
   unreachable (the insert immediately before each guarantees the row exists) and are not newly
   covered by a happy-path test; both are marked `/* v8 ignore next */` to keep
   `src/repositories/**`'s 100% coverage threshold green without faking a test that can't actually
   exercise the branch (same shape the original `applyEvidenceMastery`'s un-checked `locked!`
   silently relied on; now explicit everywhere).

Also added two small coverage tests for `appendAndFold`'s own new branches (not named by a specific
finding, but needed to keep `learner.ts` at 100%): an empty-events no-op, and a same-id replay that
exercises the "no newly-applied events, skip the fold/update" branch.

### Files touched (fix round 1)
- `packages/db/src/repositories/learner.ts` — new `evidenceEventsRepo.appendAndFold`; `locked!` ->
  explicit check (both in `rebuildMastery` and the new method).
- `packages/db/src/repositories/ports.ts` — `profileStoreFor.applyEvidence` calls `appendAndFold`
  instead of `append` + `applyEvidenceMastery`.
- `packages/db/test/profile-store.int.test.ts` — race test, agreement test (extends the existing
  rebuild test), two `appendAndFold` coverage tests, doc-comment fix.
- `packages/db/test/repositories.int.test.ts` — isolation-grid case for
  `evidenceEvents.appendAndFold`.

### Tests (fix round 1)
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`: 26/26 tasks green.
  `@edmate/db:test`: 51 test files, 871 passed (4 skipped, unrelated — DB-down guards), up from the
  previous round's count (new race/agreement/coverage/isolation-grid tests added).
  `src/repositories/**` coverage: 100% statements/functions/lines, 97.62% branches (two
  `/* v8 ignore next */` lines, justified above) — passes the package's 100%-statements threshold
  for this directory.
- `python3 .githooks/secret-scan.py --all`: clean, no output.

Tool calls used: 26

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

### Fix round 1 — combined `append` + fold into one transaction, kept `applyEvidenceMastery` in place
Decided: the fix is a new method (`evidenceEventsRepo.appendAndFold`), not a rewrite of
`applyEvidenceMastery` in place, so `applyEvidenceMastery`'s existing direct tests and isolation-grid
case stay valid unchanged. `profileStoreFor.applyEvidence` is the only caller moved to the new
method; `applyEvidenceMastery` itself is now dead in production but still reachable and tested
directly — left in place rather than deleted, since removing it was not asked for and would have
touched more call sites for no behaviour change.
Why: smallest fix that closes the race without touching anything the findings didn't name.
risk: high (same risky path as the original PR)

Tool calls used (plan + build + fix round 1): 29 + fix round 1's own 44 (slightly over the fix
round's ~40 budget — the coverage-threshold fallout from finding 3's explicit `locked!` check cost
an extra debugging round).

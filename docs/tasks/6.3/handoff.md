**Status:** DONE

## Summary
Added `classifyMistakeTags(candidates, allowedTags)` (new `packages/harness/src/memory/mistakeTags.ts`,
pure, no I/O, same shape as `topicMap.ts`): dedupes/aggregates candidate `{tag, ts}` entries by exact
tag string (sums `count`, keeps the later `lastSeen`), then splits strictly on membership in
`allowedTags` (exact string match, case-sensitive). `known` entries are shaped exactly as
`LearnerProfileSchema.mistakes` elements; `proposed` entries (tags not on the list) are returned,
never written anywhere. Exported from `packages/harness/src/memory/index.ts`.

Added `learnerProfilesRepo.applyMistakes(scope, patch)` (`packages/db/src/repositories/learner.ts`),
same shape as `applyMastery`/`applyEvidenceMastery`: under a row lock, merges `patch` into the
scope's `mistakes` jsonb array by tag (summing `count`, keeping the later `lastSeen`; appending a
new entry for a tag not yet present). The `SET` list only ever names `mistakes` and `updated_at`.
No topic-ownership check (a mistake tag is not a topic id); `classifyMistakeTags` already guarantees
every `known` entry's tag is on the caller-supplied allowed list before this is called. An empty
patch is a no-op.

No contracts change (`LearnerProfileSchema.mistakes` already had the right shape, task 3.17). No
migration (`learner_profiles.mistakes` already exists). Per the lead's 21 Oct answers: this task
covers only the classifier and `applyMistakes`; persisting proposed tags and the teacher-approval
surface move to a new board task 6.3a (M13).

## Files
- `packages/harness/src/memory/mistakeTags.ts` (new) — `classifyMistakeTags`.
- `packages/harness/src/memory/mistakeTags.test.ts` (new) — seeded-PRNG property test (2,000
  iterations, unicode/empty/very-long/duplicate/whitespace/case-variant candidates) asserting every
  `known` tag is on the allowed list and every tag not on it lands only in `proposed`; an
  example-based test using the real `content/demo-teacher/common-mistakes.yaml` tags
  (`off-by-one-range`, `string-number-mix`) plus one unseen tag (`foo-bar`); an empty-input no-op
  test.
- `packages/harness/src/memory/index.ts` — `export * from './mistakeTags.js'`.
- `packages/db/src/repositories/learner.ts` — new `applyMistakes` method.
- `packages/db/test/profile-store.int.test.ts` — integration test: seeds a profile with one
  mistakes entry and non-empty mastery/lastSummary, calls `applyMistakes` with a patch that
  increments the existing tag and adds a new one, asserts the merged result and that
  `mastery`/`lastSummary` are untouched; a malformed-scope-rejection + empty-patch-no-op test.
- `packages/db/test/repositories.int.test.ts` — isolation-grid case for `applyMistakes`
  (`owns: () => true`, same shape as `applyMastery`'s entry).

## Deviations
- The plan's example text names `off-by-one`/`string-number-mixup` as "real demo-teacher tags", but
  `content/demo-teacher/common-mistakes.yaml`'s actual tags are `off-by-one-range` and
  `string-number-mix`. Used the file's real strings (verified by `grep`) rather than the plan's
  paraphrase. Low risk, test-only.
- The isolation-grid's `mismatches` block (used by `applyMastery`/`applyEvidenceMastery` for a
  not-owned-topic case) is omitted for `applyMistakes`: a mistake tag is not a topic id, so there is
  no analogous "names something unowned" case to test — only the contract-shape `invalid` case
  would apply, and `parseArg` already covers that uniformly for every method via `scope.ts`. Low
  risk, test-only; no production code gap.

## Tests
- `packages/harness`: `mistakeTags.test.ts`, 3 tests, all pass.
- `packages/db`: full `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...
  --filter=@edmate/db...` (Postgres via `docker compose -f docker/compose.yaml -f
  packages/db/test/compose.port.yaml up -d postgres`): 26/26 tasks green.
  `@edmate/db:test`: 51 test files, 877 passed (4 skipped, unrelated DB-down guards).
  `src/repositories/learner.ts`: 100% statements/functions/lines, 97.5% branches (one
  `/* v8 ignore next */`, the row-not-found guard, same pattern 6.2 already uses).
- `git diff origin/main -- packages/contracts`: empty.
- `python3 .githooks/secret-scan.py --all`: clean, no output.

Tool calls used: 24

## Decisions

### 21 Oct 2026 · 6.3 merge: mistake tags (classifier and applyMistakes) · decided by lead · risk: high
- Decided: merge 6.3. `classifyMistakeTags` splits tags into known (on the style card's `mistakeTags`) and proposed; `applyMistakes` in `packages/db/src/repositories/learner.ts` merges known tags under the profile row lock. Proposed tags are returned, not stored (6.3a). The concurrency test and the tag and array caps go to 6.3b. Three cosmetic LOWs in `packages/harness/src/memory/mistakeTags.test.ts`, `packages/db/test/repositories.int.test.ts` and `packages/db/src/repositories/learner.ts` are left as they are (wontfix).
- Why: code-reviewer, typescript-reviewer, security-reviewer and database-reviewer (all sonnet) approve with no CRITICAL or HIGH; the lock pattern matches 6.2's race-tested one; no contracts change.
- risk: high (a new write path under `packages/db/src/repositories/**`).

### Runtime "teacher's list" is the style card's `mistakeTags`, not a new catalogue copy
Decided: `classifyMistakeTags` takes `allowedTags: readonly string[]`, the caller's job to supply
(expected to be `styleCard.mistakeTags` wherever this is eventually wired into a turn). No new
contracts type, no new persisted catalogue.
Why: the only existing runtime-queryable source; avoids a second, driftable copy of "the list".
risk: low

### Proposed tags are returned, not persisted, this task
Decided: `classifyMistakeTags`'s `proposed` output is pure data back to the caller; no new table,
no approval endpoint, in this task. Persisting and approving proposed tags moves to board task
6.3a (M13, MVP first), per the lead's 21 Oct answer.
Why: no approval surface (table, repo or UI) exists yet to receive one; matches 6.2's precedent for
not-yet-asked-for scope.
risk: low

### `risk: high` — new write path in `packages/db/src/repositories/learner.ts` (risky path)
Decided: ship `applyMistakes`, logged `risk: high` per the merge gate's rule for any
`packages/db/src/repositories/**` change, reviewed by security-reviewer.
Why: the risk-paths group requires it regardless of the change's actual size; matches 3.17's and
6.2's own logged precedent for the same file.
risk: high

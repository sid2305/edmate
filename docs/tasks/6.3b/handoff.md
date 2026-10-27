# Handoff: 6.3b
Status: DONE

## Summary
`applyMistakes` (`packages/db/src/repositories/learner.ts`) now takes a third, required
`allowedTags: readonly string[]` argument and enforces two new caps, closing the 6.3 review's
tag-list LOW via option (a) (re-check in `packages/db`, no contracts change):

- `MAX_MISTAKES_PATCH_LENGTH = 50`: `parseArg`'s schema gets `.max(MAX_MISTAKES_PATCH_LENGTH)`
  appended to `LearnerProfileSchema.shape.mistakes`; a longer patch is `invalid` before any SQL.
- Tag re-check: `const allowed = new Set(allowedTags); if (p.some((e) => !allowed.has(e.tag)))
  throw new RepositoryError('scope', method);` runs before the transaction opens — a patch tag
  outside the caller's own list is rejected, never reaching SQL.
- `MAX_MISTAKES_ENTRIES = 200`: inside the transaction, after merging, `if (next.length >
  MAX_MISTAKES_ENTRIES) throw new RepositoryError('limit', method);` — thrown inside
  `db.transaction`, so Postgres rolls the whole write back (the row lock and the earlier
  `insert ... onConflictDoNothing` are undone too), leaving the existing row unchanged.

Both constants are exported from `packages/db/src/repositories/index.ts` next to
`EVIDENCE_LIST_MAX` (same export line, one block — no 8.2i conflict found; `index.ts` still has
only the single `EVIDENCE_LIST_MAX`/`EvidenceEventEntry` export block on `main`, so the lead's
merge-override path for a concurrent 8.2i export never triggered).

Four call sites updated to pass `allowedTags` (`packages/db/test/profile-store.int.test.ts`
lines ~516, ~542-553, ~556 pre-edit; `packages/db/test/repositories.int.test.ts` line ~1816).

### Red-then-green evidence
- Before the signature change, the three existing `applyMistakes` call sites in
  `profile-store.int.test.ts` only passed two arguments; updating them to pass a third argument
  first (per the plan's "tests first") would not typecheck against the still-two-argument method
  — confirmed by building the new tests against the old signature and seeing TS errors before
  editing `learner.ts`, then adding the parameter.
- New/extended tests, all in `packages/db/test/profile-store.int.test.ts`:
  1. **Race** — `Promise.all` of 20 concurrent `applyMistakes(scope, [{tag:'race-tag',count:1,
     lastSeen}], ['race-tag'])` calls, fresh `lastSeen` per call; asserts the stored entry's
     `count === 20` and `lastSeen` is the latest of the 20. Passed on first run (the row lock
     from 6.3 already serialises correctly) — confirms the review's MEDIUM finding that the
     existing lock pattern already works.
  2. **Patch-length cap** — a patch of `MAX_MISTAKES_PATCH_LENGTH + 1` entries: red (patch
     accepted, no cap) before `.max()` was added; green after — `kind === 'invalid'`, `get`
     afterward returns `null` (no row touched).
  3. **Stored-array cap** — seed `MAX_MISTAKES_ENTRIES` distinct tags, then one more (in
     `allowedTags`, not yet stored): red (write succeeded, array grew past the cap) before the
     in-transaction length check; green after — `kind === 'limit'`, `get` afterward still shows
     the original `MAX_MISTAKES_ENTRIES`-entry array, unchanged.
  4. **Re-check** — a patch naming a tag not in `allowedTags`: red (accepted, no re-check) before
     the `Set`-membership check; green after — `kind === 'scope'`, `get` afterward returns `null`
     (fresh scope, no row touched).
- `packages/db/test/repositories.int.test.ts`'s `learnerProfiles.applyMistakes` isolation-grid
  `attempt` now passes `allowedTags: [tag]` — a signature-compatibility fix; all 190 tests in that
  file still pass.

## Decisions

### 27 Oct 2026 · 6.3b prettier reformatted the whole of `profile-store.int.test.ts` · decided by builder · risk: low
- Decided: ran `prettier --write` on the file (as the gate requires `prettier --check` to pass)
  rather than hand-formatting only the new test bodies; this rewrote every existing `it(...)`
  call in the file from an explicit multi-line `it(\n'desc',\nasync () => {...},\n15_000,\n)`
  shape to prettier 3.9.10's own single-line-where-it-fits shape — a large diff, but no behaviour
  change (confirmed: all pre-existing tests in the file still pass, 23/23). The file already
  failed `prettier --check` before this task touched it (pre-existing drift, not introduced
  here); fixing only my own additions by hand would have left the file still failing the check.
- Why: the gate names `prettier --check` on changed files as a required command; the only way to
  make it pass on this file, given its pre-existing drift, is a full-file `--write`.
risk: low

### 27 Oct 2026 · 6.3b caps and re-check implemented as planned · decided by builder · risk: low
- Decided: shipped `MAX_MISTAKES_PATCH_LENGTH = 50`, `MAX_MISTAKES_ENTRIES = 200`, required
  `allowedTags`, and reject-whole-write (`'limit'`, no truncation) exactly as the plan's Q1/Q2/Q3
  and the lead's answers specified — no deviation.
- Why: the lead's answers in the plan closed all three open questions before the build started.
risk: low

### 27 Oct 2026 · 6.3b `applyMistakes`'s signature and logic change in `learner.ts` (risky path) · decided by builder · risk: high
- Decided: shipped the new `allowedTags` parameter, the patch-length cap and the stored-array
  cap in `packages/db/src/repositories/learner.ts` (and its `index.ts` export), a
  `packages/db/src/repositories/**` risky path (security-reviewer group).
- Why: the merge gate's rule requires `risk: high` for any change to this path regardless of the
  change's actual size; reviewers for this PR: security-reviewer, code-reviewer,
  typescript-reviewer, database-reviewer (per the plan).
risk: high

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` — 19/20 tasks succeeded;
  one failure, `test/retrieval-leak.int.test.ts`'s SLO assertion (`p95 <= 50ms` on a warm cache),
  unrelated to this task (no file this task touches). Re-ran that file alone immediately after:
  all 26 tests passed (`Tests  26 passed (26)`), confirming the full-run failure was timing
  contention from concurrent load on the shared machine (another builder's run was active in a
  sibling worktree at the same time), not a regression from this change.
  `packages/db/test/profile-store.int.test.ts` (23/23) and `packages/db/test/repositories.int.test.ts`
  (190/190) both passed cleanly on their own, both in the full run and standalone.
- `corepack pnpm exec prettier --check` on the four changed files: one formatting issue in
  `profile-store.int.test.ts` (new test bodies), fixed with `prettier --write`; re-check passed —
  "All matched files use Prettier code style!".
- `python3 .githooks/secret-scan.py --all`: clean, no output.
- `git diff origin/main -- packages/contracts`: empty (no contracts change, per plan).

## Budget
Tool calls used: 32

# Task 6.3b — 6.3 review follow-ups: race test, patch/array caps, re-check tags against the list

Board: milestone M13 · dep `6.3` (done, merged) · branch `m6/6.3b-mistake-caps` · **risky**
(`packages/db/src/repositories/**`) · one phase, one builder.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "6.3 review follow-ups: a concurrent applyMistakes test (Promise.all on one tag, assert the
summed count, like 6.2's race test); cap the patch length and the stored mistakes array;
applyMistakes re-checks tags against the teacher's list or the contract caps mistakes.tag length
(contracts change needs an ADR)"
Accept: "race test green; caps tested; any contracts change has its ADR"

### How it is shown (paste into handoff.md)
Three new/extended tests in `packages/db/test/profile-store.int.test.ts`, run against Postgres:
1. A race test — `Promise.all` of N concurrent `applyMistakes` calls on the *same* scope and the
   *same* tag (count 1 each) — asserts the final stored `count` equals N (no lost update), same
   shape as 6.2a's `rebuildMastery`/`applyEvidence` race test in the same file.
2. A cap test — a patch longer than `MAX_MISTAKES_PATCH_LENGTH` is rejected (`kind === 'invalid'`)
   before any row is touched; a patch whose tags are a subset of the allowed list but would push
   the *stored* array past `MAX_MISTAKES_ENTRIES` is rejected (`kind === 'limit'`) and the
   existing row is read back unchanged (atomic, no partial write).
3. A re-check test — a patch containing one tag not in the `allowedTags` argument is rejected
   (`kind === 'scope'`) before any row is touched, even though nothing stops a future caller from
   building a patch without going through `classifyMistakeTags` first.
All three gate on `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`.

## Chosen path: no `packages/contracts` change

The board's acceptance offers two ways to close the review's tag-list LOW (`docs/tasks/6.3/
review.md`): (a) `applyMistakes` re-checks tags against the teacher's list itself, or (b) the
contract caps `mistakes.tag`'s length (needs an ADR, `architect` + `security-reviewer` +
`typescript-reviewer`). This plan takes (a): `applyMistakes` already receives the merge patch one
call before it's written; the teacher's list (`StyleCard.mistakeTags`, same source `classifyMistakeTags`
already uses) is just as available to the DB layer as it is to the harness. Re-checking it in
`packages/db` is a few lines, touches no schema, and gives defense in depth for the exact gap the
review named ("before any live caller skips the classifier") — the harness-level invariant already
holds (6.3's property test), this task adds the same invariant at the write boundary, which is the
only place that still trusts its caller completely today. A contracts change would add an ADR,
three required reviewers and a schema edit for a cap that doesn't fix the actual gap (a length cap
on `tag` does not stop an off-list tag of valid length), so it is not the better fit here even
though the board allows it.

## Design

### `packages/db/src/repositories/learner.ts` — `applyMistakes` gets a third argument and two caps

New signature: `applyMistakes(scope: StudentScope, patch: LearnerProfile['mistakes'], allowedTags:
readonly string[]): Promise<void>`. `allowedTags` is the same list the caller already has to build
to get a `known`-only patch from `classifyMistakeTags` in the first place (`styleCard.mistakeTags`)
— passing it again costs the caller nothing, and lets this method check its own invariant instead
of trusting the harness classifier blindly.

Two new exported constants (same style as `EVIDENCE_LIST_MAX`, line 20 of the same file):
```ts
/** A single applyMistakes call's patch is capped at this many entries (task 6.3b): bounds one
 * call's cost; a bigger patch is `invalid`. */
export const MAX_MISTAKES_PATCH_LENGTH = 50;
/** A profile's stored mistakes array is capped at this many distinct tags (task 6.3b): bounds
 * per-scope storage even if a future caller's allowedTags list grows large; a write that would
 * cross it is `limit` (the whole write is rejected, nothing is truncated silently). */
export const MAX_MISTAKES_ENTRIES = 200;
```

New checks, in this order (each added as a distinct, minimal diff — see Tests first):
1. `parseArg`'s schema gets `.max(MAX_MISTAKES_PATCH_LENGTH)` appended
   (`LearnerProfileSchema.shape.mistakes.max(MAX_MISTAKES_PATCH_LENGTH)` — zod's `.max()` on the
   array type already imported, no new import). A patch over the cap now fails `parseArg`'s
   `safeParse` and throws `RepositoryError('invalid', method)`, same path `EVIDENCE_LIST_MAX`'s own
   cap uses, before any SQL.
2. Immediately after the existing empty-patch check (`if (p.length === 0) return;`) and before
   `db.transaction(...)` opens: build `const allowed = new Set(allowedTags);` and `if (p.some((e) =>
   !allowed.has(e.tag))) throw new RepositoryError('scope', method);` — same error kind and the
   same "payload names something outside what the scope's caller is allowed to touch" reasoning
   `applyMastery`'s topic-ownership check already uses (`owned.length !== topicIds.length` →
   `'scope'`), just checked in memory instead of via a DB round trip (no query needed: `allowedTags`
   is already fully known to the caller, nothing to look up). This runs before the transaction opens,
   so — like the scope-shape check already above it — a disallowed tag never reaches SQL.
3. Inside the transaction, after `const next = [...byTag.values()];` and before the `update(...)`
   call: `if (next.length > MAX_MISTAKES_ENTRIES) throw new RepositoryError('limit', method);` —
   thrown inside the `db.transaction(async (tx) => {...})` callback, so Postgres rolls the whole
   transaction back (the earlier `insert ... onConflictDoNothing` and the row lock are undone too);
   `translateWrite` already passes a thrown `RepositoryError` straight through (confirmed: this is
   exactly how `applyMastery`'s own in-transaction `'scope'` throw already behaves).

Doc comment above `applyMistakes` gets two sentences added: `allowedTags` must be the same list
the caller used to classify the patch (defense in depth, task 6.3b, closing the review's "does not
re-check tags against the list" LOW); the two caps and their error kinds, pointing at the new
constants' own doc comments rather than repeating the numbers.

### `packages/db/src/repositories/index.ts`
Export the two new constants next to `EVIDENCE_LIST_MAX`'s existing export line (same file, line
224): `export { EVIDENCE_LIST_MAX, MAX_MISTAKES_PATCH_LENGTH, MAX_MISTAKES_ENTRIES, type
EvidenceEventEntry } from './learner.js';` (or a second line — either is fine, builder's call).
**Conflict note:** task 8.2i has an open PR touching this same file (new exports for
`chunks.ts`/`ingestSweep.ts`, a different block). This task only adds to the `EVIDENCE_LIST_MAX`
export line/block — low collision risk, but if 8.2i has merged to `main` by the time this task
starts, rebase onto it first and keep both sets of exports; don't hand-resolve by guessing at
8.2i's content (same rule 6.3's own plan used for 6.2's `learner.ts` edits).

### No contracts change, no migration
`LearnerProfileSchema.mistakes` (`packages/contracts/src/memory.ts:16`) is unchanged — the cap and
re-check are enforced in `packages/db`, one call site, not the schema. `git diff origin/main --
packages/contracts` must be empty. No new column: `learner_profiles.mistakes` is unchanged, both
caps are application-level checks on the existing jsonb array. No new migration.

## Files

- **Modify:** `packages/db/src/repositories/learner.ts` — `applyMistakes`'s new `allowedTags`
  parameter, the two new constants, the `.max()` schema cap, the tag re-check, the stored-array
  cap, the extended doc comment.
- **Modify:** `packages/db/src/repositories/index.ts` — export the two new constants.
- **Modify:** `packages/db/test/profile-store.int.test.ts` — thread `allowedTags` through the three
  existing `applyMistakes` calls (lines ~516, ~542, ~549, ~556 today); add the race test, the two
  cap tests and the re-check test (see Tests first).
- **Modify:** `packages/db/test/repositories.int.test.ts` — thread `allowedTags` through the
  `learnerProfiles.applyMistakes` isolation-grid `attempt` (around line 1816: `allowedTags: [tag]`).
- **Modify:** `docs/tasks/6.3b/handoff.md` (end of task, by the builder).

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` — no contracts change (Design, above: the no-ADR path).
- `packages/harness/**` (including `mistakeTags.ts`/`mistakeTags.test.ts`) — `classifyMistakeTags`
  already enforces "never a known tag outside the list" at the pure-function level (6.3's property
  test); this task adds the same invariant again at the DB write boundary, it does not change the
  classifier.
- Any new table, migration, or teacher-approval surface for *proposed* tags — still 6.3a's scope
  (M13), unaffected by this task.
- `apps/**`, `packages/content/**`, `content/**` — no caller wiring, no content change; this task
  only hardens the existing `packages/db`-internal method and its tests.
- `packages/db/src/schema/**`, `packages/db/migrations/**` — no schema/column change, so no new
  migration file (the next free number, confirmed by listing `packages/db/migrations/*.sql`, is
  `0040`, but this task should not need it).

## Tests first

1. `packages/db/test/profile-store.int.test.ts`: before touching `learner.ts`, update the three
   existing `applyMistakes` call sites to pass a third `allowedTags` argument (e.g. the tags the
   patch itself uses) — this alone won't compile/typecheck against the still-two-argument method,
   confirming the signature change is the first red step. Then add:
   - **Race:** seed a scope, run `Promise.all` of (say) 20 concurrent `applyMistakes(scope, [{ tag:
     'race-tag', count: 1, lastSeen }], ['race-tag'])` calls (fresh `lastSeen` per call so the merge
     exercises both the count-sum and lastSeen-max branches), then assert the stored entry's `count`
     is 20. Red before the row-lock logic is touched (it isn't — the lock already exists from 6.3;
     this test is new coverage, expected to pass once the signature compiles, confirming the review's
     MEDIUM finding was right that the existing lock pattern already works) — run once to confirm,
     note the result in the handoff either way.
   - **Patch-length cap:** a patch of `MAX_MISTAKES_PATCH_LENGTH + 1` entries is rejected,
     `kind === 'invalid'`, before any row exists for that scope (`get` after the rejected call
     returns `null`). Red until the `.max()` schema cap is added.
   - **Stored-array cap:** seed a profile whose `mistakes` array already has `MAX_MISTAKES_ENTRIES`
     distinct tags (all members of a large `allowedTags` fixture), then call `applyMistakes` with
     one new tag not yet in the array (also in `allowedTags`); assert `kind === 'limit'` and that
     `get` afterward still shows the original `MAX_MISTAKES_ENTRIES`-entry array, unchanged (the
     rejected write left no partial trace). Red until the in-transaction length check is added.
   - **Re-check:** a patch naming a tag not present in the `allowedTags` argument is rejected,
     `kind === 'scope'`, before any row exists for a fresh scope. Red until the `Set`-membership
     check is added.
2. `packages/db/test/repositories.int.test.ts`: update the existing `learnerProfiles.applyMistakes`
   isolation-grid entry's `attempt` to pass `allowedTags: [tag]` — no new case needed, this is a
   signature-compatibility fix so the existing isolation coverage keeps compiling and passing.
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (Postgres up via
  `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`).
  No `@edmate/harness` filter needed — this task doesn't touch `packages/harness`.
- **Size:** one method's signature plus two constants in one file, two export lines, four test
  call-site updates and four new/extended test cases — smaller than 6.3, one phase.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/**` (`learner.ts`'s `applyMistakes` change, `index.ts`'s export)
  matches the security-reviewer group (risk-paths.txt lines 29–41: "...keeping each teacher's and
  student's data apart"). **Reviewers for this PR: security-reviewer** (plus the default
  code-reviewer/typescript-reviewer on every PR, and database-reviewer per 6.3's and 6.2's own
  precedent for the same file).
- No `packages/contracts/**`, `docs/adr/**`, `.claude/**`, `packages/harness/src/guardrails/**` or
  `packages/harness/src/pedagogy/**` touched — no other risk-paths group applies.
- Per CLAUDE.md rule 6, the handoff must log a `risk: high` decision for the repositories-layer
  touch (planned below), same as 6.3's, 6.2's and 3.17's own precedent for this exact file.

## Questions (each with a recommended answer — none block the start of the build)

- **Q1. Exact cap values for `MAX_MISTAKES_PATCH_LENGTH` (50) and `MAX_MISTAKES_ENTRIES` (200)?**
  Recommend: ship these two numbers as proposed above — generous enough that no real teacher's
  common-mistakes list or a single turn's candidate tags should ever hit them (the demo content's
  own catalogue has well under 50 tags total), tight enough to bound one call's cost and one
  profile's storage. No external precedent constrains these; if the lead wants different numbers
  later, they're a one-line change with no migration.
- **Q2. Should `allowedTags` be optional (skippable re-check) to avoid breaking the few existing
  test call sites, or required?** Recommend: required — an optional, skippable re-check defeats
  the point of the review finding ("does not re-check tags against the list"); there is no live
  production caller yet (per 6.3's plan, this method isn't wired into a turn), so the only call
  sites to update are this task's own tests, already accounted for in Files/Tests above.
- **Q3. On the stored-array cap, reject the whole write or silently drop the oldest/least-recent
  entries to make room?** Recommend: reject (`kind: 'limit'`, no partial write) — matches this
  file's own `'limit'`-kind doc comment ("a write would exceed a fixed per-scope cap") and the
  codebase's no-silent-failure convention; a caller that hits this in practice needs to know, not
  have older mistake history quietly disappear.

## Decisions (draft for the handoff)

### No contracts change: tag re-check lives in `packages/db`, not a schema cap
Decided: closes the review's tag-list LOW via option (a) from the board's acceptance (re-check in
`applyMistakes`), not option (b) (a `mistakes.tag` length cap in `packages/contracts`, which would
need an ADR and three reviewers and wouldn't actually stop an off-list tag of valid length).
Why: cheaper, touches no schema, and fixes the actual gap the review named.
risk: low

### `risk: high` — `applyMistakes`'s signature and logic change in `learner.ts` (risky path)
Decided: ship the new `allowedTags` parameter, the patch-length cap and the stored-array cap,
logged `risk: high` per the merge gate's rule for any `packages/db/src/repositories/**` change,
reviewed by security-reviewer (plus database-reviewer, matching 6.3's and 6.2's own precedent).
Why: the risk-paths group requires it regardless of the change's actual size.
risk: high

## Budget
Budget: 45 tool calls (1 phase, packages/db)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test and `docker compose ... up -d postgres`
only; no network, no payment or model calls).

## Exit conditions

- Status: DONE once all four new/extended tests pass, the two updated call sites in
  `repositories.int.test.ts` and the three in `profile-store.int.test.ts` still pass, the gate
  command above is green, `git diff origin/main -- packages/contracts` is empty, and the handoff
  logs the `risk: high` decision above.
- Status: PARTIAL if past ~45 tool calls, if 8.2i's `index.ts` export conflicts turn out non-trivial
  to rebase around (the builder stops rather than guessing at 8.2i's content), or if the lead's
  answer to Q1/Q2/Q3 changes this task's scope — stop and flag rather than silently expanding scope.

## Lead answers (27 Oct 2026)
- Q1: yes, `MAX_MISTAKES_PATCH_LENGTH` = 50 and `MAX_MISTAKES_ENTRIES` = 200.
- Q2: yes, `allowedTags` is required (no production caller of `applyMistakes` exists yet; only tests).
- Q3: yes, reject the whole write (`kind: 'limit'`), never truncate silently.
- Override on the 8.2i overlap in `packages/db/src/repositories/index.ts`: never rebase. If 8.2i has merged to main when you finish, run `git merge --no-edit origin/main`, keep both sets of exports, and re-run the gate. If the conflict is anything other than the two export blocks, stop and report it.
- Reviewers: security-reviewer, code-reviewer, typescript-reviewer, database-reviewer.

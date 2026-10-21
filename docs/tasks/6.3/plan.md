# Task 6.3 — Mistake tagging from the teacher's list, plus proposed tags the teacher approves

Board: milestone M6 · deps `1.8` (done), `5.6` (done), `6.1` (done), `M3` (done) · branch
`m6/6.3-mistake-tags` · **risky** (`packages/db/src/repositories/**`) · one phase, one builder.
Builds next to 6.2 (mastery rebuild, in review on `packages/db/src/repositories/learner.ts`):
this task adds a *new* method to the same file, so the builder must rebase onto `main` after 6.2
merges before editing it (see Files, below) — never resolve a conflict by guessing at 6.2's code.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Mistake tagging from the teacher's list, plus proposed tags the teacher approves"
Accept: "never emits a tag outside the list."

Build-plan detail (line 444): "**Mistakes:** tags from the teacher's list of common mistakes, plus
auto-proposed tags the teacher approves; never a tag outside the list."

### How it is shown (paste into handoff.md)
A property test (`packages/harness/src/memory/mistakeTags.test.ts`, fast-check or a hand-rolled
fuzz loop over random strings/unicode/empty/duplicate candidate tags, against a fixed allowed-tags
list) asserts: for every input, every tag in the function's `known` output is a member of the
allowed list, and every tag *not* in the allowed list always lands in `proposed`, never in `known`
— so the invariant holds for adversarial input, not just the hand-picked example tags already in
`content/demo-teacher/common-mistakes.yaml`. A second, example-based test feeds those real tags
(`off-by-one`, `string-number-mixup`) plus one unseen tag (`foo-bar`) and checks the exact split.
A `packages/db/test/profile-store.int.test.ts` (extended) integration test calls the new
`learnerProfilesRepo.applyMistakes` with a `known`-only patch, asserts the stored
`learner_profiles.mistakes` row matches (count/lastSeen merged, not replaced) and that `mastery`/
`last_summary` are untouched — same no-clobber invariant 6.2 and 3.17 already guard for their own
columns.

## State of the world (read, not assumed)

- `LearnerProfileSchema.mistakes` (`@edmate/contracts`'s `memory.ts`) already exists:
  `z.array(z.strictObject({ tag: z.string(), count, lastSeen }))` — the storage shape is already
  built (task 3.17); `tag` is a plain string (no enum), so the "never outside the list" rule is an
  *application* invariant, not a schema one — it must be enforced in code, which is this task's job.
- The only **runtime-available** "teacher's list" today is `StyleCard.mistakeTags: string[]`
  (`@edmate/contracts`'s `teacher.ts`), persisted per style-card version
  (`packages/db/src/schema/content.ts`'s `style_cards.mistake_tags`), already loaded every turn by
  `turnConfigStoreFor.load` (`packages/db/src/repositories/ports.ts`) and already shown to the model
  as `mistake_tags` in `packages/harness/src/pedagogy/compose.ts`. The broader
  `content/demo-teacher/common-mistakes.yaml` catalogue (tag + description, validated by
  `packages/content`'s loader/rules at content-build time, rule 7: every style-card tag ⊆ that
  catalogue) is **not** persisted anywhere queryable per teacher at turn time — only the subset a
  given style-card version cites is. Design decision (below): this task checks against the
  style card's `mistakeTags`, the same list `compose.ts` already calls "the teacher's
  common-mistakes list" — not a new, parallel copy of the full catalogue.
- No scoring/grading tool exists yet that would call this from a live turn (same gap 6.2's plan
  already found for evidence events: `practice.next_item` exists, no answer-checking tool does).
  So, like 6.2, this task ships the pure logic and a DB-internal persistence method, exercised by
  tests with directly-built candidate-tag fixtures — not wired into a live pipeline call site. That
  wiring is future scope once a scoring/mistake-detecting tool exists to call it from.
- No existing table or repo stores *proposed* (not-yet-approved) tags, and no teacher-facing
  approval surface (list/approve/reject UI or endpoint) exists anywhere in the codebase yet — M6 is
  learner memory, not teacher authoring. Building that full approval workflow now would mean
  inventing a new table, a new repo, and guessing at an approval surface no other task has asked
  for. Scope cut (mirrors 6.2's Q1, which split out the not-yet-asked-for evidence producer): this
  task's `classifyMistakeTags` always computes and returns a `proposed` list (tags seen but not on
  the teacher's list) as part of its output, but **does not persist it** — nothing to approve yet
  because nothing durable holds proposals yet. Persisting and approving proposed tags is flagged as
  a follow-up task below (Open questions, Q2), not invented here.

## Design

### `packages/harness/src/memory/mistakeTags.ts` (new) — pure, no I/O, same shape as `topicMap.ts`
- `classifyMistakeTags(candidates: {tag: string; ts: string}[], allowedTags: readonly string[]):
  { known: LearnerProfile['mistakes']; proposed: {tag: string; count: number; lastSeen: string}[] }`
- Dedupes/aggregates candidates by exact tag string (count occurrences, latest `ts` as `lastSeen`),
  then splits strictly on membership in `allowedTags` (a `Set`, exact string match — case-sensitive,
  same convention as `CommonMistakeSchema.tag` and `topicId`-style identifiers elsewhere; no fuzzy
  matching, no normalisation — keeps the "never outside the list" check trivially correct to audit).
  `known` entries are shaped exactly as `LearnerProfileSchema.mistakes` elements so they can be
  merged straight into a profile; `proposed` entries are returned, never silently promoted to
  `known`, and never written anywhere by this function (it is pure).
- Export from `packages/harness/src/memory/index.ts` alongside `topicMap.ts`'s exports.

### `learnerProfilesRepo.applyMistakes(scope, patch)` — new method, `packages/db/src/repositories/learner.ts`
Same file/pattern as `applyMastery` (not `applyEvidenceMastery` — no event log to replay here, just
a merge): under a row lock, merges `patch` (an array of `{tag, count, lastSeen}`, the `known` output
above) into the scope's `mistakes` jsonb array — by tag, summing `count` and taking the later
`lastSeen` for a tag already present, appending a new entry for one that isn't. The `SET` list only
ever names `mistakes` and `updated_at` (never `mastery`/`last_summary`), same narrow-write
discipline `applyMastery`'s doc comment already requires of itself. An empty `patch` is a no-op.
No new `BktParams`-style knob; no new contracts type (`ProfileStore` is unchanged — `applyMistakes`
is a `packages/db`-internal method like `applyMastery`/`applyEvidenceMastery`/`rebuildMastery`
before it, none of which are on the public port).

### No contracts change
`LearnerProfileSchema.mistakes` already has the right shape (3.17). `StyleCard.mistakeTags` already
has the right shape (teacher.ts). Nothing in `packages/contracts` needs to change; `git diff
origin/main -- packages/contracts` must be empty. No ADR.

### No new migration
`learner_profiles.mistakes` already exists as a jsonb column (3.17); this task writes to it, same
column `applyMastery`/`save` already touch for `mastery`/full profile respectively. No new table for
proposed tags (see State of the world, above, and Open questions Q2).

## Files

- **Create:** `packages/harness/src/memory/mistakeTags.ts` — `classifyMistakeTags`.
- **Create:** `packages/harness/src/memory/mistakeTags.test.ts` — property test (adversarial
  strings) + example test (real demo-teacher tags).
- **Modify:** `packages/harness/src/memory/index.ts` — `export * from './mistakeTags.js'`.
- **Modify:** `packages/db/src/repositories/learner.ts` — add `applyMistakes` (confirm 6.2's
  `rebuildMastery` has already merged to `main` first; rebase onto it, don't hand-merge).
- **Modify:** `packages/db/test/profile-store.int.test.ts` — integration test for `applyMistakes`
  (merge semantics, scope isolation, no-clobber of `mastery`/`last_summary`).
- **Modify:** `packages/db/test/repositories.int.test.ts` — one isolation-grid case for
  `applyMistakes`, matching 3.17/6.2's own precedent for every new repo method.
- **Modify:** `docs/tasks/6.3/handoff.md` (end of task, by the builder).

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` — no contracts change (Design, above).
- `packages/harness/src/pedagogy/**` (in particular `compose.ts`'s `mistake_tags` prompt var) —
  unchanged; this task doesn't touch what the model is shown, only how a candidate tag the agent (or
  a future scoring tool) produces gets classified and stored.
- Any new table/repo for *proposed*-tag persistence or a teacher-approval endpoint — out of scope
  (Open questions, Q2); `classifyMistakeTags`'s `proposed` output is returned, not stored.
- Any new answer-checking/mistake-detecting tool in `packages/harness/src/tools/**` that would call
  this from a live turn — out of scope, same reasoning as 6.2's Q1 (no such tool exists yet; this
  ships the classifier and the storage method only, exercised by tests with direct fixtures).
- `content/demo-teacher/common-mistakes.yaml` and the rest of `packages/content` — read-only
  reference for test fixtures; not modified.
- `content/locales/**` — English-only pilot; no locale work here.

## Tests first

1. `packages/harness/src/memory/mistakeTags.test.ts`:
   - Property/fuzz case: for a fixed `allowedTags` list and randomly generated candidate tags
     (including empty string, unicode, very long strings, duplicates of allowed and disallowed
     tags), `known.every(m => allowedTags.includes(m.tag))` and every candidate not in
     `allowedTags` appears only in `proposed`, never `known`.
   - Example case: `content/demo-teacher/common-mistakes.yaml`'s real tags (`off-by-one`,
     `string-number-mixup`) plus one unseen tag (`foo-bar`) split exactly as expected; aggregation
     (two occurrences of the same known tag collapse to one entry, `count: 2`, `lastSeen` = the
     later timestamp).
2. `packages/db/test/profile-store.int.test.ts` (extended): seed an existing profile with one
   `mistakes` entry, call `applyMistakes` with a patch adding one new tag and incrementing the
   existing one; assert the merged result; assert `mastery`/`last_summary` on the same row are
   unchanged; scope violation (another student/teacher) rejected.
3. `packages/db/test/repositories.int.test.ts`: isolation-grid case for `applyMistakes`.
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/db...`
  (Postgres up via `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`).
- **Size:** 1 new harness module + 1 new db method, 4 files touched, 2 test files extended — smaller
  than 6.2, one phase.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/**` (the `applyMistakes` addition to `learner.ts`) matches the
  security-reviewer group (risk-paths.txt lines 29–39: "...keeping each teacher's and student's data
  apart"). **Reviewers for this PR: security-reviewer** (plus the default code-reviewer/
  typescript-reviewer on every PR).
- `packages/harness/src/memory/**` is **not** on the risky-path list (only `guardrails/**` and
  `pedagogy/**` under `packages/harness` are); no other group applies. No `packages/contracts/**`,
  `docs/adr/**`, `.claude/**` touched.
- Per CLAUDE.md rule 6, the handoff must log a `risk: high` decision for the repositories-layer
  touch (planned below), same as 6.2's and 3.17's own precedent.

## Open questions (each with a recommendation)

- **Q1. Is the style card's versioned `mistakeTags` the right "teacher's list" to check against at
  runtime, or should this task also surface the full `common-mistakes.yaml` catalogue (a superset,
  per content rule 7)?** Recommend: style card's `mistakeTags` — it's the only runtime-queryable
  source today, and `compose.ts` already treats it as "the teacher's list" shown to the model,
  so this keeps one source of truth instead of two that could drift. If the lead wants proposed/
  known tags checked against the full catalogue instead, that needs its own persisted,
  per-teacher table and ingest wiring — a materially larger follow-up, not this task.
- **Q2. Should this task also persist proposed tags and add a teacher-approval action (list/
  approve/reject), matching the full task title?** Recommend: no, for this task — no approval
  surface (table, repo or UI) exists anywhere yet to receive it, mirroring 6.2's Q1 precedent of
  splitting out a producer/store nothing yet calls. Ship the classifier's `proposed` output now
  (so a caller can already log/inspect it); land persistence + approval as a follow-up board task
  (e.g. "6.3a: proposed mistake-tag queue and teacher approval") once a teacher-facing approval
  surface is prioritised.

## Decisions (draft for the handoff)

### Runtime "teacher's list" is the style card's `mistakeTags`, not a new catalogue copy
Decided: `classifyMistakeTags` takes `allowedTags: readonly string[]`, the caller's job to supply
(expected to be `styleCard.mistakeTags` wherever this is eventually wired into a turn). No new
contracts type, no new persisted catalogue.
Why: the only existing runtime source; avoids a second, driftable copy of "the list".
risk: low

### Proposed tags are returned, not persisted, this task
Decided: `classifyMistakeTags`'s `proposed` output is pure data back to the caller; no new table,
no approval endpoint, in this task.
Why: no approval surface exists yet to receive one (Q2); matches 6.2's precedent for
not-yet-asked-for scope.
risk: low

### `risk: high` — new write path in `packages/db/src/repositories/learner.ts` (risky path)
Decided: ship `applyMistakes`, logged `risk: high` per the merge gate's rule for any
`packages/db/src/repositories/**` change, reviewed by security-reviewer.
Why: the risk-paths group requires it regardless of the change's actual size; matches 3.17's and
6.2's own logged precedent for the same file.
risk: high

## Budget
Budget: 55 tool calls

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test and `docker compose ... up -d postgres`
only; no network, no payment or model calls).

## Exit conditions

- Status: DONE once both test files pass, the gate command above is green, `git diff origin/main --
  packages/contracts` is empty, and the handoff logs the `risk: high` decision above.
- Status: PARTIAL if past ~55 tool calls, or if 6.2's `rebuildMastery` has not yet merged to `main`
  (the builder stops rather than hand-merging around it in `learner.ts`), or if the lead's answer to
  Q1/Q2 changes this task's scope (e.g. asks for the full catalogue or approval persistence here) —
  stop and flag rather than silently expanding scope.

## Lead answers (21 Oct 2026)
1. The style card's versioned `mistakeTags` is "the teacher's list". Use the recommended option; no second copy.
2. This task covers the classifier and `applyMistakes` only. Persisting proposed tags and the teacher-approval surface move to the new board task 6.3a (M13, MVP first). The acceptance ("never emits a tag outside the list") is met by the classifier. The lead logs this as a decision.
3. Start the build only after 6.2 has merged (both tasks edit `learner.ts`).

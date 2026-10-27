# 6.3c: Wire mistake tagging into practice turns

## Board context

- Milestone: M13. Branch: `m13/6.3c-wire-mistake-tagging`. Risk: risky.
- Deps: 6.4a (done), 6.3b (done). Note: 6.3a's own `deps` list now includes `6.3c` — 6.3a's
  planned `mistakeProposalsRepo` has not been built yet; the proposals producer this task adds is
  the gap 6.3a's plan (`docs/tasks/6.3a/plan.md`) left open (its Q1: "where a real `applyMistakes`
  caller gets `allowedTags`").
- Two phases, ~70 and ~65 tool calls (budget below). Phase A: `packages/contracts` +
  `packages/harness` (+ ADR). Phase B: `packages/db/src/repositories/ports.ts` + app adapters.

## Acceptance (verbatim)

> a wrong practice answer in a scripted turn records the classified mistake tags on the learner
> profile (only tags on the style card), and out-of-list proposals reach a port 6.3a can persist;
> no real model calls in tests.

## State of the world

- `classifyMistakeTags(candidates, allowedTags)` (`packages/harness/src/memory/mistakeTags.ts`,
  shipped by 6.3) is pure: it splits `MistakeTagCandidate[]` into `known` (members of
  `allowedTags`) and `proposed` (not members), aggregating by tag (count, latest `lastSeen`). It
  has no live caller anywhere in `packages/` or `apps/` (confirmed by grep) — 6.3 shipped the
  logic with no caller by design; 6.3a found and documented the gap; this task closes it.
- `learnerProfilesRepo.applyMistakes(scope, patch, allowedTags)` (`packages/db/src/repositories/learner.ts`,
  shipped by 6.3b, merge logged 27 Oct 2026) merges known mistakes into a profile under row lock,
  re-validates every tag against `allowedTags`, and enforces `MAX_MISTAKES_PATCH_LENGTH` (50) and
  `MAX_MISTAKES_ENTRIES` (200). It has no caller either — nothing in `packages/db`'s own port glue
  (`packages/db/src/repositories/ports.ts`) exposes it on `ProfileStore` yet.
- No mechanism anywhere classifies free text into mistake tags (no keyword matcher, no model
  step). `content/demo-teacher/common-mistakes.yaml` (13 tags, descriptions only, no matching
  data) and `content/demo-teacher/style-card.yaml`'s `mistakeTags` (4 tags: `string-number-mix`,
  `assign-vs-equals`, `integer-division`, `missing-colon-indent`) confirm the style card's list is
  a genuine subset of the full catalogue — real content, not invented, to drive "known" vs.
  "proposed" classification once a candidate tag is attached to a practice item.
- The exact architectural precedent for "per-attempt producer feeding `CommitRecord` for
  `commit.ts` to act on" is `runner.ts`'s existing `evidenceFor(e, ctx)` (6.4a): fires only when
  `ctx.attempt` is `'correct'`/`'wrong'` and the turn skill is `'practice'`, reads a loaded
  `HelpState` field (`practiceTopicId`), and returns events attached to `CommitRecord.evidence`.
  This task adds a sibling method, `mistakesFor`, following the same shape, firing only on
  `ctx.attempt === 'wrong'`.
- `practice.ts`'s `topicIdFor`/`issuedItem` pattern is the precedent for threading a new
  per-item field from the bank (`PracticeItem`) through `IssuedItem` into `HelpState`, exactly as
  `topicId` already is threaded.

## Design

1. **Candidate-tag source.** Add an optional `mistakeTag?: string` to `PracticeItem`
   (`packages/harness/src/tools/practiceItems.ts`) — a content-author-set field, like `topicId`
   already is, not a classifier output. `practice.ts` gains a `mistakeTagFor(itemId, scope)`
   helper mirroring `topicIdFor`, and `issuedItem` carries it into a new `IssuedItem.mistakeTag?`
   field (`packages/harness/src/pipeline/tools.ts`).
2. **HelpState.** Add `practiceMistakeTag?: string` to `HelpState`
   (`packages/harness/src/pedagogy/helpState.ts`), a sibling of `practiceTopicId` in the zod
   schema, `copyHelp`, and `practiceFields`; `runner.ts`'s `withPractice()` sets it from the
   issued item alongside `practiceTopicId`.
3. **Classification on a wrong answer.** `runner.ts` gains a private `mistakesFor(e, ctx)` method
   parallel to `evidenceFor`: returns `undefined` unless `ctx.attempt === 'wrong'` and
   `this.turnSkill === 'practice'`; reads `this.loadedHelp?.help.practiceMistakeTag`; if present,
   calls `classifyMistakeTags([{ tag: practiceMistakeTag, ts }], e.styleCard.mistakeTags)` and
   attaches the result's `known`/`proposed` to two new optional `CommitRecord` fields:
   `mistakesKnown?: LearnerProfile['mistakes']` and `mistakesProposed?: LearnerProfile['mistakes']`
   (`packages/harness/src/pipeline/types.ts` — `LearnerProfile` is already imported there, no new
   import needed). `ProposedMistakeTag {tag, count, lastSeen}` is structurally identical to
   `LearnerProfile['mistakes']`'s element shape, so no new contracts type is defined — reusing the
   existing type keeps the contracts diff to one new method signature.
4. **Port extension (ADR required).** `ProfileStore` (`packages/contracts/src/ports.ts`) gains an
   **optional** method: `applyMistakes?(scope: { studentId: string; teacherId: string }, known: LearnerProfile['mistakes'], proposed: LearnerProfile['mistakes']): Promise<void>`.
   Optional specifically so Phase A (contracts + harness) ships without breaking every existing
   structural implementer of `ProfileStore` in the same PR; Phase B then wires the real adapters.
   This needs an ADR at `docs/adr/0017-mistake-tag-port.md` (next free number, architect's text,
   reviewed by architect + security-reviewer + typescript-reviewer, lead logs `risk: high`).
5. **commit.ts.** `packages/harness/src/pipeline/steps/commit.ts` gains a block mirroring the
   existing `applyEvidence` call: when `record.mistakesKnown` or `record.mistakesProposed` is
   non-empty, call `profiles.applyMistakes?.(scope, known, proposed)` (scope from
   `record.entitled.entitlement`). Calling through the optional-chain means a `ProfileStore` that
   hasn't implemented it yet (any Phase-B-not-yet-landed adapter) is a safe no-op.
6. **Phase B wiring.** `packages/db/src/repositories/ports.ts`'s `profileStoreFor` implements the
   real `applyMistakes`: calls the already-shipped `learnerProfilesRepo.applyMistakes(scope, known, allowedTags)`
   for the `known` array (the acceptance's "only tags on the style card" — `allowedTags` comes
   from the same style card the classification used); the `proposed` array is handed to a port 6.3a
   will implement — this task adds a second, equally optional `ProfileStore` method,
   `recordProposedMistakes?(scope, proposed): Promise<void>`, and `commit.ts`'s new block calls it
   too when non-empty. `profileStoreFor`'s own implementation of `recordProposedMistakes` is a
   deliberate no-op for now (logged as an open question — 6.3a lands the real persistence; nothing
   is lost, since `applyMistakes`'s own classification already ran and the known half is durable).
   No-op/in-memory implementations also go into `apps/worker/src/gate/ports.ts` (no-op),
   `apps/web/src/studio/testChat/deps.ts` (no-op), and in-memory tracking additions (push to an
   array, like `MemoryProfileStore.applied` already does for evidence) in
   `packages/harness/src/testing/memoryPorts.ts`, `apps/cli/src/commands/chat/deps.ts`, and
   `apps/web/test/turn-backend.ts`.

## Files

### Phase A — contracts + harness

Create:
- `docs/adr/0017-mistake-tag-port.md` (architect's text; Accepted once the three reviewers
  approve)
- `packages/harness/src/pipeline/runner.mistakes.test.ts` (new test file, mirrors
  `runner.evidence.test.ts`'s structure exactly)

Modify:
- `packages/contracts/src/ports.ts` — `ProfileStore` gains `applyMistakes?` and
  `recordProposedMistakes?` (both optional; exported-type change)
- `packages/harness/src/tools/practiceItems.ts` — `PracticeItem.mistakeTag?: string`
- `packages/harness/src/tools/practice.ts` — `mistakeTagFor` helper; `issuedItem` carries it
- `packages/harness/src/pipeline/tools.ts` — `IssuedItem.mistakeTag?: string`
- `packages/harness/src/pedagogy/helpState.ts` — `HelpState.practiceMistakeTag?: string`
  (schema, `copyHelp`, `practiceFields`)
- `packages/harness/src/pipeline/runner.ts` — `withPractice()` sets the new field; new private
  `mistakesFor(e, ctx)` method; `finish()` attaches its result to the commit record
- `packages/harness/src/pipeline/types.ts` — `CommitRecord.mistakesKnown?`/`mistakesProposed?`
  (both `LearnerProfile['mistakes']`, already-imported type, no new import)
- `packages/harness/src/pipeline/steps/commit.ts` — calls `profiles.applyMistakes?.(...)` and
  `profiles.recordProposedMistakes?.(...)` when non-empty
- `packages/harness/src/pipeline/steps/commit.test.ts` — new cases for the above (mirrors the
  existing `applyEvidence` test triples)
- `packages/harness/src/testing/memoryPorts.ts` — `MemoryProfileStore` tracks calls to both new
  methods (e.g. `appliedMistakes`, `proposedMistakes` arrays), like `applied` already does
- `packages/harness/src/tools/demoPracticeBank.ts` — (nice-to-have, droppable if over budget) tag
  one item with a known style-card tag (e.g. `demo:algebra:2:a` → `string-number-mix`) and one
  with a catalogue-only tag (e.g. `demo:python:2:a` → a tag from `common-mistakes.yaml` not on the
  style card) so a scripted end-to-end test can exercise both `known` and `proposed` without an
  invented fixture

Read only (no edit): `content/demo-teacher/common-mistakes.yaml`,
`content/demo-teacher/style-card.yaml`, `packages/contracts/fixtures/valid/teacher.ts` (confirms
`demoStyleCard.mistakeTags = ['sign_error', 'unit_missing']` — usable directly in
`runner.mistakes.test.ts`'s scripted turns without adding new fixtures).

### Phase B — db repositories + app adapters

Modify:
- `packages/db/src/repositories/ports.ts` — `profileStoreFor` implements `applyMistakes` (calls
  `learnerProfilesRepo.applyMistakes`) and `recordProposedMistakes` (no-op, comment pointing to
  6.3a)
- `packages/db/src/repositories/ports.test.ts` — new cases for both
- `apps/worker/src/gate/ports.ts` — no-op `applyMistakes`/`recordProposedMistakes` added to the
  existing no-op `profiles` object
- `apps/web/src/studio/testChat/deps.ts` — same no-op addition
- `apps/cli/src/commands/chat/deps.ts` — in-memory tracking addition + its test
- `apps/web/test/turn-backend.ts` — in-memory tracking addition (test harness, no separate test
  file expected — covered by whatever already exercises this fixture)

Read only (no edit): `apps/web/src/turn/deps.ts` (already wires `profileStoreFor` — no change
needed, it inherits the new methods automatically through the same function).

## Files out of bounds

- `apps/web/app/api/sessions/[id]/end/route.ts` — 6.4b's file exclusively; not touched here.
- `packages/db/src/repositories/learner.ts` — `applyMistakes`'s body is already shipped (6.3b);
  this task calls it, does not change it.
- `packages/db/src/repositories/mistake-proposals.ts` and any `mistake_tag_proposals` migration —
  6.3a's future file/table; `recordProposedMistakes`'s db-side implementation is explicitly
  deferred there (this task's db-side method is a no-op, documented as such).
- `content/demo-teacher/*.yaml` — read-only reference; not modified (the design deliberately uses
  existing tags, not new content).

**Overlap with 6.4c (flagged, not excluded — both tasks genuinely need these two files):**
6.4c is slated to touch `packages/harness/src/pipeline/runner.ts` (telemetry for `evidenceFor`
skipping a turn with no topic) and `packages/harness/src/tools/practice.ts` (passing a topic map
into `pickItem`). This plan touches the same two files but different functions/regions:
`runner.ts`'s new `mistakesFor` method sits near `evidenceFor` (same file, nearby, different
method body — low line-level conflict risk but real proximity); `practice.ts`'s new
`mistakeTagFor` helper sits near `topicIdFor` (same pattern, same region) while 6.4c's
`pickItem`/`preferredModule` work is in a different part of the file. Recommend to the lead:
sequence these two tasks serially rather than running both builders on `runner.ts`/`practice.ts`
at once; land 6.3c first (smaller diff in these two files — one new method, one new helper) and
have 6.4c rebase onto it, rather than the reverse.

## Tests first

### Phase A
- `packages/harness/src/pipeline/runner.mistakes.test.ts` (new, mirrors
  `runner.evidence.test.ts`'s `heldHelp`/`turnWith` pattern exactly, but setting
  `practiceMistakeTag` instead of/alongside `practiceTopicId`):
  - a wrong practice answer with a held `practiceMistakeTag` that IS in `demoStyleCard.mistakeTags`
    (`'sign_error'`) → `commit?.mistakesKnown` contains it, `commit?.mistakesProposed` is
    `undefined`
  - a wrong practice answer with a held `practiceMistakeTag` NOT on the style card (e.g.
    `'off_by_one'`) → `commit?.mistakesProposed` contains it, `commit?.mistakesKnown` is
    `undefined`
  - a correct practice answer → no mistakes emitted (mirrors the evidence test's correct case —
    classification only fires on `wrong`)
  - a non-practice skill turn → no mistakes emitted
  - an unsettled attempt (`'partial'`/`'none'`) → no mistakes emitted
  - a held item with no `practiceMistakeTag` (defensive gap, mirrors the evidence test's "no
    stored topic" case) → no mistakes emitted, never throws
- `packages/harness/src/pipeline/steps/commit.test.ts`: new cases mirroring the existing
  `applyEvidence` triples — `record.mistakesKnown`/`mistakesProposed` non-empty calls
  `profiles.applyMistakes`/`recordProposedMistakes` with the right scope; empty/undefined calls
  neither; a `ProfileStore` lacking the optional methods (structural test double without them) is
  a safe no-op, never throws.
- `packages/contracts` — no new test file; the port's own type-level optionality is exercised by
  existing `ProfileStore` structural test doubles across the harness test suite continuing to
  typecheck unchanged (an exported-type addition, additive only).

### Phase B
- `packages/db/src/repositories/ports.test.ts`: `profileStoreFor.applyMistakes` calls through to
  `learnerProfilesRepo.applyMistakes` with the right scope/allowedTags (can assert via a stub repo
  or the existing db-test harness pattern used by neighbouring tests in this file);
  `recordProposedMistakes` is present and resolves (documented no-op).
- `apps/cli/src/commands/chat/deps.ts`'s existing test file: new case asserting the in-memory
  tracking array records a call.

No real model or payment calls in any test (all turns driven through `driveTurn`/`testSteps`, the
scripted gateway, exactly as `runner.evidence.test.ts` already does).

## Gate commands

Phase A (exported-type change in `packages/contracts` — gate dependents, per the "Gate dependents
in briefs" lesson):
```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/contracts
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...
python3 .claude/skills/merge-gate/merge_gate.py 6.3c
```

Phase B:
```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=apps-worker... --filter=apps-web... --filter=apps-cli...
python3 .claude/skills/merge-gate/merge_gate.py 6.3c
python3 .githooks/secret-scan.py --all
```
(Package names for the turbo filters should be confirmed against each `package.json`'s `name`
field before running; the builder adjusts the literal filter strings if they differ from the
guesses above — the intent is "contracts' dependents" then "db's dependents".)

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- **Phase A:**
  - `packages/contracts/**` and `docs/adr/**` → reviewers: architect, security-reviewer,
    typescript-reviewer. ADR-0017 required (architect's text). Lead logs `risk: high`.
  - `packages/harness/src/pedagogy/**` (`helpState.ts`) → reviewers: code-reviewer (MVP-first
    carve-out currently in force for this group). Lead still logs `risk: high` for this touch,
    per the group's general rule, even though only code-reviewer is required pre-pilot-gate.
  - `packages/harness/src/pipeline/**`, `packages/harness/src/tools/**` → not on
    risk-paths.txt as separate globs; no extra reviewer requirement beyond the always-required
    code-reviewer and typescript-reviewer.
- **Phase B:**
  - `packages/db/src/repositories/**` (`ports.ts`) → reviewers: security-reviewer. Lead logs
    `risk: high`.
  - `apps/worker/src/gate/ports.ts`, `apps/web/src/studio/testChat/deps.ts`,
    `apps/cli/src/commands/chat/deps.ts`, `apps/web/test/turn-backend.ts` → none of these paths
    match risk-paths.txt's globs. None (checked against risk-paths.txt).

## Open questions (non-blocking, recommendations given — builder proceeds with the recommendation
unless the lead says otherwise)

1. Should `ProfileStore.applyMistakes`/`recordProposedMistakes` be optional or required?
   Recommendation: optional, as designed above — decouples Phase A from Phase B so Phase A can
   ship and gate green on its own; every existing structural implementer keeps typechecking.
2. Is the `demoPracticeBank.ts` fixture-tagging nice-to-have in Phase A's scope, or droppable if
   the phase runs over budget? Recommendation: droppable — `runner.mistakes.test.ts` can build its
   own `HelpState`/`styleCard` fixtures directly (as `runner.evidence.test.ts` already does with
   `heldHelp`), without needing the demo bank to carry real `mistakeTag` values.
3. `recordProposedMistakes`'s db-side implementation is a documented no-op in this task, with the
   real table/write deferred to 6.3a. Recommendation: accept this — 6.3a's own deps already list
   6.3c, so 6.3a is the right place to add real persistence once this task's port shape exists for
   it to implement against.
4. Exact turbo package-name filters for Phase B's apps (guessed above) should be confirmed by the
   builder against each app's `package.json` `name` field before running the gate.

## Decisions (draft, for the lead's handoff)

- Phase A, `risk: high` — "6.3c extends `ProfileStore` (`packages/contracts/src/ports.ts`) with
  two new optional methods under ADR-0017; reviewed by architect, security-reviewer,
  typescript-reviewer." Also touches `packages/harness/src/pedagogy/helpState.ts` (code-reviewer
  under the MVP-first carve-out), logged `risk: high` per the pedagogy group's general rule.
- Phase B, `risk: high` — "6.3c wires `profileStoreFor.applyMistakes`
  (`packages/db/src/repositories/ports.ts`, a risky path) to the already-shipped
  `learnerProfilesRepo.applyMistakes`; reviewed by security-reviewer."

## Budget

Budget: 150 tool calls (2 phases: Phase A 85 tool calls — packages/contracts, packages/harness,
docs/adr; Phase B 65 tool calls — packages/db, apps/worker, apps/web, apps/cli)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test and secret-scan only — no network, model
or payment calls)

## Exit conditions

- Phase A: `Status: DONE` once `packages/contracts` and `packages/harness`'s gate (typecheck,
  lint, test, including the new `runner.mistakes.test.ts` and `commit.test.ts` cases) is green,
  ADR-0017 is written (architect's text) and referenced, and the handoff logs the two `risk: high`
  entries above. `Status: PARTIAL` past ~85 tool calls, or if the ADR's three required reviewers
  haven't signed off yet (ship the harness/contracts code with the ADR as `Status: Proposed`,
  flag for the lead).
- Phase B: `Status: DONE` once `packages/db`'s and the three apps' adapters gate green end to end
  and the handoff logs the Phase B `risk: high` entry. `Status: PARTIAL` past ~65 tool calls, or
  if Phase A hasn't merged yet (Phase B cannot start against an unmerged port signature).

## Lead answers (27 Oct 2026)
- **ADR number:** 0016 is taken by 11.4d (docs/adr/0016-ffmpeg-chunker.md, on its branch). This task's ADR is `docs/adr/0017-mistake-tag-port.md`; references above are updated. The builder writes the ADR from the Design section (status Proposed, format of docs/adr/0015-payments-port.md, `python3 docs/adr/check-headings.py` green); the architect reviews it with the code.
- **Q1:** optional methods, as recommended.
- **Q2:** the demo-bank tagging is droppable if Phase A runs over budget; say so in the handoff.
- **Q3:** accepted: `recordProposedMistakes` is a documented no-op in packages/db until 6.3a.
- **Q4:** yes, the builder confirms package names from each `package.json` before running the gate.
- **Sequencing:** 6.4c starts after 6.3c merges (both edit runner.ts and practice.ts). 6.4b runs alongside Phase A (packages/db and apps/web; Phase A doesn't touch them). Phase B starts after 6.4b merges, since both edit packages/db.

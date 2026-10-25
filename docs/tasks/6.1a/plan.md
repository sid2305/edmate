# Task 6.1a — topic-map follow-ups from the 6.1 review

Board: milestone M13 · deps `6.1` (done) · **not risky** by `risk-paths.txt` (checked below) · two
phases, one builder each (tdd-guide).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "6.1 follow-ups: topic map zod objects use .strict() so unknown keys are rejected, not
dropped; a sorted insert or heap instead of re-sorting the ready queue each round; wire
practiceItems/demoPracticeBank topic ids to validate against buildTopicMap (6.1 plan Q1); feed
ingest's OutlineDraft into buildTopicMap (6.1 plan Q2)"
Accept: "tests cover each item; harness tests pass"

Four items, from the 6.1 review (`docs/tasks/6.1/review.md`, two deferred LOWs) and the 6.1 plan's
Q1/Q2 (`docs/tasks/6.1/plan.md`, answered "out of scope" on 21 Oct 2026, now picked up here):

1. `CourseOutlineModuleInputSchema`/`CourseOutlineTopicInputSchema`/`CourseOutlineInputSchema`
   (zod objects) reject unknown keys instead of silently dropping them.
2. `topologicalOrder`'s ready queue stops re-sorting on every round (`O(n² log n)` at the 2000
   bound); a sorted insert or a heap instead.
3. `practiceItems.ts`/`demoPracticeBank.ts` wire a topic id to `buildTopicMap`'s validation (Q1).
4. `packages/ingest`'s `OutlineDraft` can be converted into a `buildTopicMap` input (Q2).

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| 1. Strict schemas | A `CourseOutlineInput` (or module/topic entry) with one extra, unknown key is rejected (`{ ok: false, reason: 'invalid', id: '' }`), proven by a new test; every existing valid-input test still passes unchanged. |
| 2. No per-round re-sort | `topologicalOrder`'s ready set is a small binary min-heap (push/pop by the existing `compareTieBreak`), not an array re-sorted every round. Every existing `topicOrder` assertion is unchanged (same output); a new, wider-tie test (10+ topics, several at once reaching degree 0) still produces the (module order, topic order, topicId) tie-break order. |
| 3. Q1 wiring | `pickItem` takes an optional `topicMap?: TopicMap` (last, optional parameter — every existing call site is unchanged); when given, a bank-picked item is `servable` only if `topicMap.getTopic(item.topicId)?.moduleId === item.moduleId`; an item with an unknown or mismatched topic id is skipped (bank retried, then the generator, which is never given `topicMap` — see Design). `demoPracticeBank.ts` exports a `DEMO_TOPIC_MAP` built by `buildTopicMap` from `DEMO_PRACTICE_RECORDS`' own module/topic ids, and a test wires it through `pickItem` end to end (a good item still served; a item whose topic id or module id is changed to not match the map is skipped). |
| 4. Q2 conversion | A new, pure function in `packages/harness/src/memory/` turns an ingest-shaped outline draft into a `CourseOutlineInput` (`courseId`/`teacherId` supplied by the caller, since a draft carries neither); every converted topic gets `skillsBuilt: []` and `prerequisiteTopicIds: []` (a draft has neither field — see Design's caveat), so `buildTopicMap` on its output can still reject `unknown_module`/`duplicate_*` but never finds a cycle. A test converts a small two-module draft and checks the result validates with the expected `topicOrder` (draft order). |
| Harness tests pass | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` is green after each phase. |

## Design

### Phase A: items 1–3, all in `packages/harness` (one builder, one PR)

**Item 1 (strict schemas).** Swap `z.object({...})` for `z.strictObject({...})` (zod 4's own
built-in, already used the same way in `packages/ingest/src/outline/draftOutline.ts`) on
`CourseOutlineModuleInputSchema`, `CourseOutlineTopicInputSchema` and `CourseOutlineInputSchema`
in `packages/harness/src/memory/topicMap.ts`. No other change: an unrecognised key anywhere in the
input already becomes a `safeParse` failure → `{ ok: false, reason: 'invalid', id: '' }`, the same
path a missing required field takes today.

**Item 2 (heap, not re-sort).** Replace the `ready: string[]` array (pushed, then
`.sort(compareTieBreak)` every round) in `topologicalOrder` with a small binary min-heap keyed by
the existing `compareTieBreak` comparator: `heapPush`/`heapPop` helpers (array-backed, standard
sift-up/sift-down), local to `topicMap.ts`, not exported. The outer loop becomes: heap-push every
topic that starts at in-degree 0 (instead of collecting then sorting once), then repeatedly
heap-pop one topic, append it to `order`, decrement its dependents' in-degree, and heap-push any
dependent that reaches 0. This is the same algorithm (Kahn's), same tie-break, same output — only
the ready-queue's data structure changes, so no existing assertion on `topicOrder` should need to
change.

**Item 3 (Q1 wiring).**
- `pickItem`'s signature gains one new, optional, last parameter: `topicMap?: TopicMap` (import
  `type { TopicMap } from '../memory/topicMap.js'` — a within-harness relative import, allowed by
  rule 3). Every existing call site (none of which passes a 7th argument) is unaffected.
- `servable(...)` gains the same optional parameter. When `topicMap` is given, add one more
  condition: `topicMap.getTopic(picked.item.topicId)?.moduleId === picked.item.moduleId`. This
  only gates the bank-read loop inside `pickItem` (the loop that calls `bank.pick`/
  `bank.answerKeyFor`) — **not** the `generateItem(...)` fallback call at the end of `pickItem`,
  which keeps using its placeholder `${moduleId}:practice` topic id exactly as today (6.1's own
  plan Q4: "no real outline yet" for the generator; unchanged here; passing `topicMap` into the
  generator's `servable` check would make every generated item fail closed, since no real topic
  map will ever contain a `:practice` placeholder id).
- `demoPracticeBank.ts` adds one new export, `DEMO_TOPIC_MAP: TopicMap`, built once at module load
  by calling `buildTopicMap` with modules/topics *derived from* `DEMO_PRACTICE_RECORDS` itself (one
  module per distinct `item.moduleId`, one topic per distinct `(item.moduleId, item.topicId)` pair,
  in first-seen order) — not a second, separately maintained list, so the fixture cannot drift from
  the records it describes. (`buildTopicMap`'s result here is always `ok: true` by construction —
  no prerequisites, no duplicates — so the export can safely read `result.value`; if a future editor
  of `DEMO_PRACTICE_RECORDS` manages to make it `ok: false`, throwing at module load is correct
  fail-closed behaviour for a fixture, not swallowed.)
- Tests (`practiceItems.test.ts`): a bank item whose `topicId` is not in a given `topicMap` is
  skipped by `pickItem` (falls through to the generator); a bank item whose `topicId` exists but
  under a *different* `moduleId` in the map is also skipped; an item that matches the map is served
  normally; `pickItem` with no `topicMap` argument is unchanged (today's behaviour, byte for byte).
- Tests (`demoPracticeBank.test.ts`): `pickItem(demoPracticeBank(), scope, level, [], undefined,
  undefined, DEMO_TOPIC_MAP)` still serves the expected demo item (positive path); a bank built from
  one mutated record (topic id changed to one absent from `DEMO_TOPIC_MAP`) is skipped when
  `DEMO_TOPIC_MAP` is passed, served when it is not.

### Phase B: item 4 (Q2), also entirely inside `packages/harness` — no new cross-package dependency

**Important finding (changes the plan from a cross-package change to a same-package one):** the
harness purity rule (`packages/config/eslint/rules/harness-purity.js`) fails closed on *every*
import source in `packages/harness`, including a `import type` from another workspace package, so
`packages/harness` can never import `@edmate/ingest`'s `OutlineDraft` type, not even for types
only. `packages/ingest`'s own `gatewayFailure.ts` already sets the precedent for this situation:
it needs `@edmate/gateway`'s `GatewayError` shape but does not depend on `@edmate/gateway`, so it
duck-types a local type instead of importing one. Phase B follows the same pattern, so **item 4
adds no package.json dependency and touches only `packages/harness`** (not `packages/ingest`),
unlike what the task title might suggest:

- New file `packages/harness/src/memory/fromOutlineDraft.ts` defines three local, structural types
  that mirror (field-for-field, only the fields actually used) `packages/ingest`'s real
  `TopicDraft`/`ModuleOutlineDraft`/`OutlineDraft` (`packages/ingest/src/outline/types.ts`):
  ```
  interface DraftLikeTopic { readonly topic: string }
  interface DraftLikeModule { readonly moduleId: string; readonly title: string; readonly topics: readonly DraftLikeTopic[] }
  interface DraftLikeOutline { readonly modules: readonly DraftLikeModule[] }
  ```
  TypeScript's structural typing means a real `OutlineDraft` value (passed in by whichever later,
  out-of-scope caller glues ingest and harness together, e.g. a studio endpoint that imports both
  packages) satisfies `DraftLikeOutline` with no import needed here.
- One function: `courseOutlineInputFromDraft(draft: DraftLikeOutline, courseId: string, teacherId:
  string): CourseOutlineInput`. `OutlineDraft` carries neither a `courseId` nor a `teacherId`
  (confirmed in `packages/ingest/src/outline/types.ts`), so the caller supplies both.
  - Module order = the module's index in `draft.modules`; `moduleId`/`title` pass through as-is.
  - Topic id = `` `${moduleId}:t${index}` `` (`index` = the topic's position within its module's
    `topics` array) — a `TopicDraft` has no id of its own (only `topic: string`, the title, and
    `chunkIds`, which this converter ignores), so a position-based composite id is synthesized,
    the same colon-joined-composite-id shape `practiceItems.ts`'s own generator already uses
    (`` `${moduleId}:practice` ``). Topic order = the same index.
  - `title` = the draft topic's `topic` string. `skillsBuilt: []` and `prerequisiteTopicIds: []`
    always (a draft has neither field).
- **Caveat, stated up front, not discovered later:** because every converted topic gets an empty
  `prerequisiteTopicIds`, `buildTopicMap` on this converter's output can only ever reject
  `unknown_module` (impossible by construction, since every topic's `moduleId` comes from its own
  parent module) or `duplicate_module`/`duplicate_topic` (possible if the draft itself repeats a
  module id, or — impossible by construction here, since topic ids are per-module-indexed and
  thus always unique) — it can **never** find a `cycle`, because nothing in an `OutlineDraft` can
  express "topic B needs topic A first" yet. This matches 6.1's own Q2 answer (no prerequisite
  data exists in a draft); the converter is honest plumbing for the id/structure half of the
  acceptance line, not a working cycle check on real outlines. A later task (likely the M8 studio
  outline editor, 8.3, where a teacher could add prerequisites) is where a cycle could first ever
  be real. Flagged as a Decision below, not a blocker.
- Export `courseOutlineInputFromDraft` and the three `DraftLike*` types from
  `packages/harness/src/memory/index.ts` (the existing barrel 6.1 created).
- Test: a small two-module, four-topic draft (module A: 2 topics, module B: 2 topics) converts to
  a `CourseOutlineInput` that `buildTopicMap` accepts, with `topicOrder` equal to draft order
  (no edges, so ties break purely on (module order, topic order, topicId), which is draft order
  here by construction); a draft with two modules sharing one `moduleId` converts to a
  `CourseOutlineInput` that `buildTopicMap` rejects as `duplicate_module`.

## Files

### Phase A
- **Modify:** `packages/harness/src/memory/topicMap.ts` (items 1–2), `packages/harness/src/memory/topicMap.test.ts` (new tests for both), `packages/harness/src/tools/practiceItems.ts` (item 3: optional `topicMap` param), `packages/harness/src/tools/practiceItems.test.ts` (new tests), `packages/harness/src/tools/demoPracticeBank.ts` (item 3: `DEMO_TOPIC_MAP` export), `packages/harness/src/tools/demoPracticeBank.test.ts` (new tests).
- **Tests first:** for item 1, a malformed input with one extra unknown key at the top level and one inside a topic entry, each → `'invalid'` (alongside the existing malformed-input test, which must still pass). For item 2, nothing new is strictly required for correctness (existing `topicOrder` assertions already pin the output), but add one wider test (≥10 topics across 2+ modules, several reaching in-degree 0 in the same round, ids chosen so insertion order ≠ final order) to exercise the heap's tie-break at a scale the 3-topic fixture doesn't reach. For item 3, see the two test bullets under "Item 3" in Design above.
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...`.
- **Size:** 6 files, one phase, an estimated 70–90 builder tool calls (three small, independent, mechanical edits in one already-familiar package).

### Phase B
- **Create:** `packages/harness/src/memory/fromOutlineDraft.ts`, `packages/harness/src/memory/fromOutlineDraft.test.ts`.
- **Modify:** `packages/harness/src/memory/index.ts` (export the new function/types).
- **Tests first:** see the Phase B test bullet in Design above (valid two-module draft converts and validates; a duplicate module id in the draft is rejected).
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...`.
- **Size:** 3 files, one phase, an estimated 30–40 builder tool calls (one small pure function with a stated caveat, no new dependency).
- **State after this phase:** both 6.1a items from Q1/Q2 are resolved; `packages/ingest` is untouched (confirmed not needed, see Design's "important finding"); a real teacher-facing cycle check on a drafted outline still waits on a later task that lets a teacher add prerequisites (unchanged from 6.1's own Q2 answer).

## Files out of bounds

- `apps/web/app/staff/**`, `packages/db/src/repositories/audit.ts`, `packages/db/src/cli.ts` — other tasks are on them (per the brief).
- `packages/ingest/**` — Phase B's "important finding" above means item 4 needs no change here at all; if a builder finds they do need to touch `packages/ingest` to make Phase B work, that is a sign the design in this plan has drifted and the builder should stop and flag it rather than improvise a new cross-package dependency.
- `packages/contracts/**`, `docs/adr/**` — no contracts change in either phase (no new port, no schema exported from `@edmate/contracts`).
- `packages/harness/src/pipeline/**`, `src/pedagogy/**`, `src/access/**`, `src/guardrails/**` — untouched by either phase.
- `packages/harness/src/tools/practice.ts`, `registry.ts` — `pickItem`'s new parameter is optional and these callers do not pass it; not modified.
- `content/demo-teacher/**` — no new fixture content; `DEMO_TOPIC_MAP` is derived from the existing `DEMO_PRACTICE_RECORDS`, not a new course.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

None in either phase. `packages/harness/src/memory/**` and `packages/harness/src/tools/**` match
no glob in `risk-paths.txt` (the risky harness groups are `guardrails/**` and `pedagogy/**` only).
Default reviewers apply: code-reviewer, typescript-reviewer (run on every PR regardless). No
`risk: high` decision is required by the gate for either phase.

## Open questions (each with a recommendation)

- **Q1 (Phase B scope).** Should `courseOutlineInputFromDraft` live in `packages/harness` (duck-typed, Design above) rather than `packages/ingest` importing `@edmate/harness` as this task's title might suggest? Recommend: yes, as designed — the harness purity rule fails closed on any import from `packages/harness`, even type-only, and `packages/ingest`'s own `gatewayFailure.ts` already sets the precedent (duck-type instead of depend). Moving the converter into `packages/ingest` instead would need promoting `@edmate/harness` from `packages/ingest`'s `devDependencies` to a runtime `dependencies` entry — a new cross-package production dependency edge the build plan never names, and the wrong direction (ingest depending on harness) for what is really harness-side validation of outline-shaped data. If the lead disagrees, this is a one-file move.
- **Q2 (Phase B's vacuous cycle check).** Is it worth building item 4 at all, given it can never actually reject a cycle until a teacher can add prerequisites to a draft (no earlier task)? Recommend: yes, build it as scoped — it still proves the id/structure half of the acceptance line ("tests cover each item") and gives whichever later task wires studio-drafted outlines into `buildTopicMap` a tested starting point; the caveat is stated plainly in the code comment and the Decisions section below, not hidden.
- **Q3 (item 3's generator).** Should `generateItem`'s placeholder topic (`` `${moduleId}:practice` ``) also be checked against `topicMap` once passed through, perhaps by special-casing that suffix as always valid? Recommend: no — leave the generator exactly as it is (Design above); special-casing a string suffix as "always valid" to satisfy a check meant to catch exactly that kind of made-up id defeats the check's purpose, and the generator is explicitly out of scope for "real outline" validation until 6.1's own Q4 is answered by a later task.

## Decisions (draft for the handoff)

### Phase B stays inside `packages/harness`; no new dependency on `@edmate/ingest` (Decision 1)
Decided: `courseOutlineInputFromDraft` duck-types a structural `DraftLikeOutline` instead of
importing `@edmate/ingest`'s `OutlineDraft`.
Why: the harness purity rule (build plan rule 3) fails closed on every import, type-only included;
`packages/ingest/src/gatewayFailure.ts` already duck-types `GatewayError` for the same reason, in
the other direction.
risk: low

### A converted draft can never fail as a cycle (Decision 2)
Decided: ship `courseOutlineInputFromDraft` with `skillsBuilt: []`/`prerequisiteTopicIds: []`
always, knowing `buildTopicMap` on its output can reject only `unknown_module`/`duplicate_*`, never
`cycle`, until a later task lets a teacher add prerequisites to a draft.
Why: `OutlineDraft` has no field to carry a prerequisite today (6.1's own Q2 answer, 21 Oct 2026);
building a converter now is still useful plumbing and does not block on that later task.
risk: low

## Budget

Budget: 130 tool calls (2 phases, packages/harness)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test for `@edmate/harness` and its dependents, and the secret scan only)

## Exit conditions

- **Phase A `Status: DONE`:** all three items 1–3 implemented as designed, every new and existing test in `packages/harness/src/memory/topicMap.test.ts`, `practiceItems.test.ts` and `demoPracticeBank.test.ts` passes, `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` is green, and the PR is committed. `Status: PARTIAL` if past ~100 tool calls with any item unfinished, or if a change outside the Files list above turns out to be needed (e.g. a caller of `pickItem` elsewhere that does need updating) — stop and hand off with what's done and what's left named.
- **Phase B `Status: DONE`:** `courseOutlineInputFromDraft` implemented as designed (duck-typed, no `packages/ingest` touched, no new dependency), its test passes, the full `@edmate/harness` gate is green, and the PR is committed. `Status: PARTIAL` if past ~50 tool calls unfinished, or if the builder finds Phase B actually needs a `packages/ingest` change or a new dependency (per "Files out of bounds" above) — stop and flag it rather than improvise.

## Lead answers (25 Oct 2026)
- Q1: agreed; if Phase B is built it stays inside packages/harness, duck-typed, with no new dependency.
- Q2: no, not now. This task builds **Phase A only** (items 1–3). Phase B (item 4, `courseOutlineInputFromDraft`) moves to board task 6.1b and waits until a task wires studio-drafted outlines into `buildTopicMap` (MVP first: an unwired converter whose cycle check cannot fire adds no pilot value). Log this as a lead `risk: low` decision in the handoff; drop the plan's draft Decisions 1 and 2 (they belong to 6.1b).
- Q3: agreed; leave `generateItem` unchanged.
- Reviewers: code-reviewer, typescript-reviewer. Budget 80 for Phase A; stop at 95 and return PARTIAL.

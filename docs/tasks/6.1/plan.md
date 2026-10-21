# Task 6.1 — Topic map from the course outline, with validation

Board: milestone M6 · deps `5.6`, `M3` · branch `m6/6.1-topic-map` · **not risky** by
`risk-paths.txt` · one phase, one builder (tdd-guide).

Package note (0.15 token budget / "one builder per package at a time"): this task's only touched
package is `packages/harness` (new `src/memory/**` module + its barrel export). **7.7 (turn traces
and health metrics) is being planned in parallel and may also touch `packages/harness`** (it
already owns `pipeline/trace.ts`). The lead must not run both builders in `packages/harness`
concurrently — whichever of 6.1/7.7 is ready first should start, the other waits. 6.1's footprint
is small (new files under `memory/`, one one-line addition to `src/index.ts`) and does not touch
`pipeline/**`, so the two should never conflict on the same file even if run back-to-back.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Topic map from the course outline, with validation"
Accept: "unknown or cyclic references rejected."

Build-plan detail (line 442): "**Topic map:** from the teacher's course outline (modules → topics
→ skills); validated for unknown ids and cycles."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Built from the course outline (modules → topics → skills) | `buildTopicMap(input)` takes a `CourseOutlineInput` (`courseId`, `teacherId`, `modules[]`, `topics[]`, each topic carrying its `moduleId`, `order`, free-text `skillsBuilt` and optional `prerequisiteTopicIds`) and returns a `TopicMap` with `getModule`/`getTopic`/`topicsOf(moduleId)` lookups and a deterministic `topicOrder` (topological, ties broken by declared order) — the "outline order" `demoPracticeBank.ts` already anticipates (its comment: "outline order once 6.1/5.11 exist"). |
| Unknown ids rejected | A topic whose `moduleId` is not one of `input.modules`' ids, or whose `prerequisiteTopicIds` names a topic id not in `input.topics`, is rejected: `buildTopicMap` returns `{ ok: false, reason: 'unknown_module' \| 'unknown_prerequisite', id }`, never a thrown error, never partial output. |
| Cyclic references rejected | A prerequisite cycle (direct self-reference, a 2-cycle, or a longer cycle, including one that crosses modules) is detected (Kahn's-algorithm style: topics with no remaining in-edges are peeled off in order; anything left over is on a cycle) and rejected as `{ ok: false, reason: 'cycle', id }` — `id` names one topic on the cycle, never the whole cycle path or any topic/skill text. |
| No real model calls | `buildTopicMap` is pure, synchronous, dependency-free logic (no `ModelGateway`, no I/O). Tests call it directly with in-memory fixtures; nothing to script. |
| No contracts change | `git diff origin/main -- packages/contracts` is empty. `CourseOutlineInput`/`TopicMap`/`TopicMapReason` are harness-internal types (not `@edmate/contracts` exports), same pattern as 5.11's `OutlineDraft` (ingest-internal) and 5.6's `PracticeItem`/`PracticeBank` (harness-internal, Decision 1). |

## Design

### Decision 1 (flag to architect — not an ADR, no contracts change): the topic map's shape is a planner's design choice, not spec-mandated

The PRD and build plan say only "modules → topics → skills" and "unknown or cyclic references
rejected" — neither names a schema. A plain module→topic tree alone cannot cycle, so for the
"cyclic" half of the acceptance line to mean anything, topics must carry *some* cross-reference to
other topics. The only existing precedent (5.6's `demoPracticeBank.ts` comment: "lowest mastery
first... else the bank's own order — 'outline order' once 6.1/5.11 exist") implies topics have a
natural teaching sequence, which is exactly what a **prerequisite graph** gives: topic B lists
topic A as a prerequisite when a student should see A first.

**Recommendation (what this plan builds):** each topic optionally declares
`prerequisiteTopicIds: string[]` (other topic ids in the *same* course outline it builds on).
`buildTopicMap` validates that every id referenced anywhere (a topic's `moduleId`, a topic's
`prerequisiteTopicIds` entries) exists in the outline, and that the prerequisite graph has no
cycles (self-reference included). `skillsBuilt` stays free-text (`readonly string[]`, default
`[]`) describing what the topic teaches (PRD: "the skills each one builds") — **not** validated
against a registry and **not** the existing `SkillSchema` enum (`explain`/`coach`/`practice`/…,
which names teaching *modes*, a different concept already used elsewhere for packages). This
keeps 6.1 scoped to structural validation only, matching the acceptance line exactly; a registry
of allowed skill tags, if ever wanted, is a separate, later decision (not blocking).

Consequence for 6.2/6.3/5.6-follow-up: `TopicMap.getTopic(topicId)` and `topicsOf(moduleId)` give
the first real "does this topic id exist, and in which module" check anything can run (5.6's Q4
said "a later task (6.1) adds real validation once the topic map exists" — this task is that
later task, though wiring `pickItem`/practice callers to actually call it is out of scope here and
not requested by this task's accept line; flagged as a follow-up, not a blocker).

### `CourseOutlineInput` / `TopicMap` (`packages/harness/src/memory/topicMap.ts`)

```
interface CourseOutlineModuleInput { moduleId: string; title: string; order: number }
interface CourseOutlineTopicInput {
  topicId: string; moduleId: string; title: string; order: number;
  skillsBuilt?: readonly string[];
  prerequisiteTopicIds?: readonly string[];
}
interface CourseOutlineInput {
  courseId: string; teacherId: string;
  modules: readonly CourseOutlineModuleInput[];
  topics: readonly CourseOutlineTopicInput[];
}

interface TopicMapTopic { topicId, moduleId, title, order, skillsBuilt, prerequisiteTopicIds }
interface TopicMap {
  courseId: string; teacherId: string;
  getModule(moduleId: string): CourseOutlineModuleInput | undefined;
  getTopic(topicId: string): TopicMapTopic | undefined;
  topicsOf(moduleId: string): readonly TopicMapTopic[];
  /** Topological order (prerequisites first), ties broken by (module order, topic order, topicId). */
  topicOrder: readonly string[];
}

type TopicMapReason =
  | 'duplicate_module' | 'duplicate_topic' | 'unknown_module' | 'unknown_prerequisite' | 'cycle';
type TopicMapResult =
  | { ok: true; value: TopicMap }
  | { ok: false; reason: TopicMapReason; id: string };

function buildTopicMap(input: CourseOutlineInput): TopicMapResult;
```

- `courseId`/`teacherId`/`moduleId`/`topicId` are validated with `@edmate/contracts`'s `id()`
  format (same pseudonymous-id shape used everywhere else) via a local zod schema
  (`CourseOutlineInputSchema`) — a `safeParse` failure is `{ ok: false, reason: 'unknown_module',
  id: '' }`... **no** — a schema failure is a distinct, simpler case: return `{ ok: false, reason:
  'unknown_module', id: '' }` is misleading. Add a sixth reason `'invalid'` for "did not parse the
  input schema at all" (malformed shape, not a missing cross-reference), mirroring
  `access/entitlement.ts`'s own `'invalid'` reason. (Builder: use `'invalid'`, not the five
  structural reasons, for a `safeParse` failure.)
- Duplicate module or topic ids are rejected (`'duplicate_module'`/`'duplicate_topic'`) before any
  cross-reference check runs, so lookups stay well-defined (a planner addition beyond the literal
  accept line — same spirit as 5.6's extra defensive checks — flagged under Decisions below).
- A local constant bounds input size defensively (e.g. 2,000 topics) so cycle detection (`O(topics
  + edges)`, Kahn's algorithm) never runs unbounded; teacher-authored input, not an adversarial
  student path, so this is a cheap safety net, not a hard requirement.
- No thrown exceptions for expected rejections (`Checked`-style result, same pattern as
  `access/entitlement.ts`'s `Checked<T, R>` — not reused directly since 6.1 needs the offending
  `id` alongside the reason, so a local, slightly richer result type is defined instead).

### Files

- **Create:** `packages/harness/src/memory/topicMap.ts` (the schema, `buildTopicMap`, topological
  sort), `packages/harness/src/memory/topicMap.test.ts`, `packages/harness/src/memory/index.ts`
  (barrel, first file in this folder — currently only `.gitkeep`).
- **Modify:** `packages/harness/src/index.ts` — add `export * from './memory/index.js';`.
- **Tests first:** valid outline (two modules, three topics, one prerequisite edge) → `ok: true`,
  correct `topicOrder` and lookups; unknown `moduleId`; unknown `prerequisiteTopicIds` entry;
  self-reference (1-cycle); a 2-topic cycle; a longer, cross-module cycle; duplicate module id;
  duplicate topic id; malformed input (`safeParse` failure, e.g. missing `teacherId`) →
  `'invalid'`; empty outline (`modules: [], topics: []`) → `ok: true`, empty `topicOrder`; a topic
  with no `prerequisiteTopicIds`/`skillsBuilt` (both optional, defaulting to `[]`).
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...`.
- **Size:** ~5 files, one phase, an estimated 60–80 builder tool calls (small, pure, well-scoped
  logic with a thorough but mechanical test list).

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` — no contract/port change (Decision 1).
- `packages/db/**` (the existing `courses`/`modules`/`topics` tables) — no migration. Those tables
  already hold `id`/`title`/`order`; adding `skills_built`/`prerequisite_topic_ids` columns (or an
  API/studio path that produces a real `CourseOutlineInput` from them) is a later, separate task
  (the studio outline editor is task 8.3, M8, after the harness exit gate) — out of scope here,
  same "no real outline yet" gap 5.6's Q4 already named for itself.
- `packages/ingest/src/outline/**` (5.11, done) — unchanged; `OutlineDraft`'s `TopicDraft` has no
  `prerequisiteTopicIds`/`skillsBuilt` fields and this task does not add them there. A later task
  may convert a teacher-edited `OutlineDraft` into a `CourseOutlineInput`; not requested here.
  Still a pending design question. (Open Q2.)
- `packages/harness/src/tools/practiceItems.ts`, `demoPracticeBank.ts` — not wired to
  `TopicMap`/`buildTopicMap` by this task (5.6's Q4 answer only promised that *a later task* adds
  real validation; this task builds the topic map itself, not the wiring). Flagged as a follow-up,
  not silently dropped. (Open Q1.)
- `packages/harness/src/pipeline/**`, `src/pedagogy/**`, `src/access/**`, `src/guardrails/**` —
  untouched; 7.7 (if it lands first) may touch `pipeline/trace.ts`, which this plan never reads or
  writes.
- `content/demo-teacher/**` — no new fixture content; tests use small in-memory outlines, not the
  real demo course (nothing in the committed demo content currently declares topic-level ids or
  prerequisites, so there is nothing realistic to reuse yet).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

None. `packages/harness/src/memory/**` matches no glob in `risk-paths.txt` (the risky harness
groups are `guardrails/**` and `pedagogy/**` only). Default reviewers apply: code-reviewer,
typescript-reviewer (run on every PR regardless). No `risk: high` decision is required by the gate;
the handoff logs Decision 1 (the topic-map shape) as `risk: low`, same convention 5.11 used for its
own local-types decisions.

## Open questions (each with a recommendation)

- **Q1. Should this task also wire `PracticeBank`/`pickItem` (5.6) to validate `topicId` against a
  real `TopicMap`?** Recommend: no — the accept line is only "unknown or cyclic references
  rejected" for the map itself; wiring a consumer is extra surface area (crosses into
  `tools/practiceItems.ts`, currently untouched and working) and isn't named by this task or
  6.2/6.3's accept lines either. Raise as a small follow-up task once a real `CourseOutlineInput`
  producer exists (today nothing builds one outside this task's own tests).
- **Q2. Should `buildTopicMap` consume `packages/ingest`'s `OutlineDraft` directly (so a drafted
  outline can be validated right after 5.11 runs)?** Recommend: not yet — `OutlineDraft`'s
  `TopicDraft` has no `prerequisiteTopicIds`/`skillsBuilt` fields, and `packages/ingest` depends on
  `packages/harness`'s rule 3 boundary the other way around is untested territory (ingest already
  imports from `@edmate/contracts`, not `@edmate/harness`). A converter, if wanted, belongs to
  whichever later task first needs a drafted outline to become a real `TopicMap` (likely a studio
  task, M8+), not this one.
- **Q3. Is "prerequisite topic" the right cross-reference for "cyclic references," or did the
  build plan mean something else (e.g. a skills-dependency graph, not a topics one)?** Recommend:
  proceed with the topic-prerequisite reading (Decision 1) — it is the only structure consistent
  with both "modules → topics → skills" (skills stay descriptive, per-topic, free text) and
  "cycles" (which needs *some* graph, and topics are the only graph-shaped thing a course outline
  naturally has). If the lead disagrees, this is a one-file, contained design to redo.

## Decisions (draft for the handoff)

### Topic map cross-references are a planner design choice (Decision 1)
Decided: `CourseOutlineTopicInput.prerequisiteTopicIds` is the cross-reference `buildTopicMap`
validates for "unknown or cyclic"; `skillsBuilt` stays free text, unvalidated.
Why: neither the PRD nor the build plan names a schema; this is the only reading consistent with
both halves of the accept line (see Decision 1 above and Q3). No contracts change, so no ADR.
risk: low

## Lead answers (21 Oct 2026)
- Decision 1 / Q3: accepted. Each topic has an optional `prerequisiteTopicIds`, which is the graph that the unknown-id and cycle checks validate. `skillsBuilt` stays free text.
- Q1 and Q2 (wiring practice items and the ingest OutlineDraft to the TopicMap): out of scope. The lead adds them as board follow-ups after merge.

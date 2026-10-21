# Task 6.1 — Topic map from the course outline, with validation

Status: DONE

## Files

- `packages/harness/src/memory/topicMap.ts` (new) — `CourseOutlineInput`/`TopicMap` schema and
  `buildTopicMap`, topological sort (Kahn's algorithm).
- `packages/harness/src/memory/topicMap.test.ts` (new) — 11 tests.
- `packages/harness/src/memory/index.ts` (new) — barrel (`export * from './topicMap.js'`).
- `packages/harness/src/index.ts` — added `export * from './memory/index.js';`.

## Tests

`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` — green (10/10 tasks).
`src/memory/topicMap.test.ts (11 tests)` covers: valid outline (lookups + topological
`topicOrder`), defaults for omitted `skillsBuilt`/`prerequisiteTopicIds`, empty outline,
`unknown_module`, `unknown_prerequisite`, self-reference (1-cycle), 2-topic cycle, a longer
cross-module cycle, `duplicate_module`, `duplicate_topic`, and malformed input → `'invalid'`.
`src/memory` coverage: 98.79% statements / 83.72% branches / 100% functions / 100% lines.

`git diff origin/main -- packages/contracts` — empty (no contracts change).
`python3 .githooks/secret-scan.py --all` — clean.

## Decisions

### 21 Oct 2026 · 6.1 Topic map cross-references are a planner design choice · decided by tdd-guide · risk: low
- Decided: `CourseOutlineTopicInput.prerequisiteTopicIds` is the cross-reference `buildTopicMap`
  validates for "unknown or cyclic"; `skillsBuilt` stays free text, unvalidated against any
  registry.
- Why: neither the PRD nor the build plan names a schema for "modules → topics → skills"; a prerequisite
  graph is the only structure consistent with both halves of the accept line ("unknown or cyclic
  references rejected") — a plain module→topic tree alone cannot cycle. Lead accepted this reading
  in the plan's "Lead answers" section (21 Oct 2026).
- risk: low

### 21 Oct 2026 · 6.1 id() is not re-exported from @edmate/contracts · decided by tdd-guide · risk: low
- Decided: the plan called for validating `courseId`/`teacherId`/`moduleId`/`topicId` with
  `@edmate/contracts`'s `id()` format via import, but `formats.ts` (where `id()` lives) is not
  re-exported from the package's public `index.ts` (only `LIMITS` is). `topicMap.ts` instead
  defines a local `idFormat()` zod schema using the same regex (`^[A-Za-z0-9_-]+$`) and the
  imported `LIMITS.idMaxLength` bound, matching the contracts format exactly without importing an
  internal module.
- Why: importing a non-exported internal module would be a contracts change (or a build error);
  this keeps the same validation shape with zero contracts diff, per rule 2 (no contracts change
  without an ADR).
- risk: low

### 21 Oct 2026 · 6.1 duplicate ids and the `'invalid'` reason (planner additions kept as written) · decided by tdd-guide · risk: low
- Decided: kept the plan's `duplicate_module`/`duplicate_topic` checks (run before any
  cross-reference check) and the `'invalid'` reason for a `safeParse` failure (distinct from the
  five structural reasons), exactly as specified in the plan's Design section.
- Why: plan already worked through the rationale (well-defined lookups; `'invalid'` is a different
  kind of failure than a missing cross-reference, mirroring `access/entitlement.ts`'s own
  `'invalid'` reason); no further human judgment call needed here.
- risk: low

Open follow-ups (not blockers, per lead answers): Q1 (wiring `practiceItems.ts`/`pickItem` to
`TopicMap`) and Q2 (a converter from `packages/ingest`'s `OutlineDraft` to `CourseOutlineInput`)
are out of scope for this task; the lead adds them as board follow-ups after merge.

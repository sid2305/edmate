# 6.1a — handoff (Phase A only)

**Status:** DONE

## What changed

Phase A of the 6.1 follow-ups, scoped entirely inside `packages/harness`:

1. **Strict schemas (item 1).** `CourseOutlineModuleInputSchema`, `CourseOutlineTopicInputSchema`
   and `CourseOutlineInputSchema` in `packages/harness/src/memory/topicMap.ts` now use
   `z.strictObject({...})` instead of `z.object({...})`, so an unknown key anywhere in the input
   (top level or inside a topic entry) is rejected (`{ ok: false, reason: 'invalid', id: '' }`)
   instead of silently dropped.
2. **Heap instead of re-sort (item 2).** `topologicalOrder`'s ready queue is now a small
   array-backed binary min-heap (`heapPush`/`heapPop`, local to the function, not exported), keyed
   by the existing `compareTieBreak` comparator, instead of an array re-sorted on every round.
   Same algorithm (Kahn's), same tie-break, same output.
3. **Q1 wiring (item 3).** `pickItem` and `servable` in `packages/harness/src/tools/practiceItems.ts`
   gain one new, optional, last parameter, `topicMap?: TopicMap` (type-only import from
   `../memory/topicMap.js`). When given, `servable` additionally requires
   `topicMap.getTopic(item.topicId)?.moduleId === item.moduleId` — this only gates the bank-read
   loop inside `pickItem`, never the `generateItem(...)` fallback (unchanged, per the plan's
   Design and the lead's Q3 answer). `demoPracticeBank.ts` adds `buildDemoTopicMap` (an exported,
   pure builder function — extracted from what would otherwise be an untestable inline IIFE, so
   its fail-closed throw path has its own test) and `DEMO_TOPIC_MAP`, built from
   `DEMO_PRACTICE_RECORDS` itself.

## Evidence

| Item | Evidence |
|---|---|
| 1. Strict schemas | `topicMap.test.ts`: `'rejects an unknown top-level key (strict schema)'` and `'rejects an unknown key inside a topic entry (strict schema)'`, both asserting `{ ok: false, reason: 'invalid', id: '' }`. Every existing valid-input test (`'builds a valid outline with correct lookups and topological topicOrder'`, etc.) is unchanged and still passes. |
| 2. No per-round re-sort | `topicMap.ts`'s `topologicalOrder` now uses a binary min-heap (`heapPush`/`heapPop`), not an array re-sorted every round. `topicMap.test.ts`: `'orders a wider outline correctly when several topics reach in-degree 0 in the same round'` (2 modules, 12 topics, declaration order deliberately not the final order) asserts the exact tie-broken `topicOrder`. Every existing `topicOrder` assertion (e.g. `['topic-1', 'topic-2', 'topic-3']` in the base fixture, the cycle tests, the duplicate tests) is unchanged. |
| 3. Q1 wiring | `practiceItems.test.ts`, describe block `'pickItem with topicMap (6.1a Q1)'`: `'serves a bank item whose topicId/moduleId match the topic map'`, `'skips a bank item whose topicId is not in the topic map; the generator steps in'`, `'skips a bank item whose topicId exists but under a different moduleId; the generator steps in'`, and `"is unchanged when no topicMap argument is given (today's behaviour)"`. `demoPracticeBank.test.ts`, describe block `'DEMO_TOPIC_MAP (6.1a Q1)'`: `'serves the expected demo item end to end through pickItem when DEMO_TOPIC_MAP is passed'`, `'skips a record whose topicId does not match DEMO_TOPIC_MAP, served when the map is not passed'`, plus `'builds the real DEMO_PRACTICE_RECORDS without throwing (fail-closed guard never fires today)'` and `'throws (fail closed) when records would build an invalid topic map'` (covers `buildDemoTopicMap`'s fail-closed throw, which is otherwise unreachable from the real fixture). |
| Harness tests pass | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1` → `Tasks: 10 successful, 10 total`, 5562 tests passed, 0 failed. `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0). |

## Decisions

### 25 Oct 2026 · 6.1a Phase B deferred to 6.1b · decided by lead · risk: low
- Decided: this task (6.1a) builds Phase A only (items 1–3: strict schemas, heap ready-queue, Q1
  topic-map wiring for practice items). Phase B (item 4, `courseOutlineInputFromDraft`, the plan's
  Q2 answer converting an ingest `OutlineDraft` into a `buildTopicMap` input) moves to board task
  6.1b and waits until a later task wires studio-drafted outlines into `buildTopicMap`.
- Why: MVP first — an unwired converter whose cycle check can never fire (no outline draft today
  can express a prerequisite) adds no pilot value yet; building it now would be plumbing ahead of
  its first real caller.

## Budget

Tool calls used: 53 (harness count across both runs: first run 3, restart 50; the builder self-reported 21 for the restart)

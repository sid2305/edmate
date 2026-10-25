// A small in-memory fixture `PracticeBank` (task 5.6 Phase A): tests, and `defaultToolRegistry`'s
// default (Phase B). NOT real teacher content — that is 5.11 (outline drafter) / 8.x (teacher
// authoring), later. Every servable record here passes `validateItem` (demoPracticeBank.test.ts).
//
// The mcq record (`algebra:3:a`) and the code_output records (`python:1:a`, `python:2:a`) are
// served since 5.6b Phase C: the leak matcher exempts a re-show of the active item. The mcq uses a
// concept prompt, so its correct option's text never shows in the prompt; each code_output item's
// output is computed from its own code (on line 2 of a multi-line prompt for `python:1:a`).
import { buildTopicMap, type TopicMap } from '../memory/topicMap.js';
import type {
  LearnerPracticeProfile,
  PracticeBank,
  PracticeItem,
  PracticeLevel,
  PracticeScope,
} from './practiceItems.js';
import { SERVABLE_KINDS } from './practiceItems.js';

export interface DemoPracticeRecord {
  readonly item: PracticeItem;
  readonly answerKey: readonly string[];
}

/**
 * The teacher every demo record belongs to (5.6c): the contracts fixture teacher, so the default
 * registry serves demo items only inside that teacher's scope.
 */
export const DEMO_PRACTICE_TEACHER_ID = 'tch_test_01';

const MODULE_ARITHMETIC = 'module-arithmetic';
const MODULE_FRACTIONS = 'module-fractions';
const MODULE_ALGEBRA = 'module-algebra';
const MODULE_PYTHON = 'module-python';

/** Fixture records across four demo modules/topics and all three levels. */
export const DEMO_PRACTICE_RECORDS: readonly DemoPracticeRecord[] = [
  {
    item: {
      id: 'demo:arithmetic:1:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'arithmetic',
      moduleId: MODULE_ARITHMETIC,
      level: 1,
      kind: 'numeric',
      prompt: 'What is 3 + 4?',
    },
    answerKey: ['7'],
  },
  {
    item: {
      id: 'demo:arithmetic:2:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'arithmetic',
      moduleId: MODULE_ARITHMETIC,
      level: 2,
      kind: 'short',
      prompt: 'A shop sells pens at 12 each. How much do 5 pens cost?',
    },
    answerKey: ['60', 'sixty'],
  },
  {
    item: {
      id: 'demo:fractions:1:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'fractions',
      moduleId: MODULE_FRACTIONS,
      level: 1,
      kind: 'short',
      prompt:
        'A pizza is cut into 4 slices. You eat 2 slices and a friend eats the other 2. ' +
        'How many whole pizzas is that in total?',
    },
    answerKey: ['1', 'one'],
  },
  {
    item: {
      id: 'demo:fractions:2:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'fractions',
      moduleId: MODULE_FRACTIONS,
      level: 2,
      kind: 'short',
      prompt: 'Simplify the fraction 4/8 to its lowest terms.',
    },
    answerKey: ['1/2'],
  },
  {
    item: {
      id: 'demo:algebra:2:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'algebra',
      moduleId: MODULE_ALGEBRA,
      level: 2,
      kind: 'short',
      prompt: 'Solve for x: x + 5 = 12.',
    },
    answerKey: ['7'],
  },
  {
    item: {
      id: 'demo:algebra:3:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'algebra',
      moduleId: MODULE_ALGEBRA,
      level: 3,
      kind: 'mcq',
      prompt: 'Which of these numbers is prime?',
      options: ['A) 6', 'B) 7', 'C) 8'],
    },
    answerKey: ['B'],
  },
  {
    item: {
      id: 'demo:python:1:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'python-loops',
      moduleId: MODULE_PYTHON,
      level: 1,
      kind: 'code_output',
      prompt: 'What does this code print?\nx = 4\nprint(x)',
    },
    answerKey: ['4'],
  },
  {
    item: {
      id: 'demo:python:2:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'python-loops',
      moduleId: MODULE_PYTHON,
      level: 2,
      kind: 'code_output',
      prompt: 'What does this code print?\ntotal = 0\nfor i in range(4):\n    total = total + i\nprint(total)',
    },
    answerKey: ['6'],
  },
] as const;

/**
 * Builds a `TopicMap` (6.1a Q1) from a list of practice records: one module per distinct
 * `item.moduleId`, one topic per distinct `(item.moduleId, item.topicId)` pair, both in
 * first-seen order, so the result can never drift from the records it describes. Exported (rather
 * than kept as an inline IIFE) so its fail-closed throw on a malformed record list is itself
 * testable.
 */
export function buildDemoTopicMap(records: readonly DemoPracticeRecord[]): TopicMap {
  const moduleOrder: string[] = [];
  const topicOrder: Array<{ topicId: string; moduleId: string }> = [];
  const seenTopics = new Set<string>();
  for (const record of records) {
    const { moduleId, topicId } = record.item;
    if (!moduleOrder.includes(moduleId)) moduleOrder.push(moduleId);
    const topicKey = `${moduleId}\u0000${topicId}`;
    if (!seenTopics.has(topicKey)) {
      seenTopics.add(topicKey);
      topicOrder.push({ topicId, moduleId });
    }
  }
  const result = buildTopicMap({
    courseId: 'demo-course',
    teacherId: DEMO_PRACTICE_TEACHER_ID,
    modules: moduleOrder.map((moduleId, index) => ({ moduleId, title: moduleId, order: index })),
    topics: topicOrder.map(({ topicId, moduleId }, index) => ({
      topicId,
      moduleId,
      title: topicId,
      order: index,
    })),
  });
  if (!result.ok) {
    throw new Error(`buildDemoTopicMap: records do not build a valid topic map (${result.reason})`);
  }
  return result.value;
}

/**
 * `buildTopicMap` on `DEMO_PRACTICE_RECORDS` is always `ok: true` by construction (no
 * prerequisites, no duplicates): if a future edit to `DEMO_PRACTICE_RECORDS` ever makes it
 * `ok: false`, `buildDemoTopicMap` throwing at module load is the correct fail-closed behaviour
 * for a fixture, not a swallowed error.
 */
export const DEMO_TOPIC_MAP: TopicMap = buildDemoTopicMap(DEMO_PRACTICE_RECORDS);

/** Lowest-mastery-first if `profile` names a tracked mastery, else `topics`' own (outline) order. */
// Only called with a non-empty `topics` (pick() checks `candidates.length > 0` first).
function chooseTopic(
  topics: readonly [string, ...string[]],
  profile: LearnerPracticeProfile | undefined,
): string {
  if (profile === undefined || profile.topics.length === 0) return topics[0];
  const masteryOf = (t: string): number =>
    profile.topics.find((m) => m.topicId === t)?.mastery ?? -Infinity;
  return [...topics].sort((a, b) => masteryOf(a) - masteryOf(b))[0] as string;
}

/**
 * A `PracticeBank` over `records`: every read is scoped to the teacher (5.6c) and to
 * `allowedModuleIds` (architect review point 1), and the bank — never the caller — chooses the topic (point 2).
 */
export function demoPracticeBank(
  records: readonly DemoPracticeRecord[] = DEMO_PRACTICE_RECORDS,
): PracticeBank {
  const byId = new Map(records.map((r) => [r.item.id, r]));
  return {
    pick(
      scope: PracticeScope,
      level: PracticeLevel,
      exclude: readonly string[],
      profile?: LearnerPracticeProfile,
    ) {
      const allowed = new Set(scope.allowedModuleIds);
      const candidates = records.filter(
        (r) =>
          r.item.teacherId === scope.teacherId &&
          allowed.has(r.item.moduleId) &&
          r.item.level === level &&
          SERVABLE_KINDS.has(r.item.kind) &&
          !exclude.includes(r.item.id),
      );
      if (candidates.length === 0) return undefined;
      // Non-empty: `candidates` is, and every candidate has a `topicId`.
      const topics = [...new Set(candidates.map((r) => r.item.topicId))] as [string, ...string[]];
      const topic = chooseTopic(topics, profile);
      return candidates.find((r) => r.item.topicId === topic)?.item;
    },
    answerKeyFor(itemId: string, scope: PracticeScope) {
      const record = byId.get(itemId);
      if (record === undefined || record.item.teacherId !== scope.teacherId) return undefined;
      if (!scope.allowedModuleIds.includes(record.item.moduleId)) return undefined;
      return record.answerKey;
    },
    itemFor(itemId: string, scope: PracticeScope) {
      const record = byId.get(itemId);
      if (record === undefined || record.item.teacherId !== scope.teacherId) return undefined;
      return scope.allowedModuleIds.includes(record.item.moduleId) ? record.item : undefined;
    },
  };
}

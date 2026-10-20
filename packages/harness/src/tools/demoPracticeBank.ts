// A small in-memory fixture `PracticeBank` (task 5.6 Phase A): tests, and `defaultToolRegistry`'s
// default (Phase B). NOT real teacher content — that is 5.11 (outline drafter) / 8.x (teacher
// authoring), later. Every servable record here passes `validateItem` (demoPracticeBank.test.ts).
//
// Two records (`algebra:3:a`, an mcq; `python:1/2:a`, code_output) are kept in the fixture to prove
// the bank's `SERVABLE_KINDS` filter actually excludes them (architect review point 4: those kinds
// are modelled, never served, until a later task reviews their leak model).
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
    // Not servable (SERVABLE_KINDS excludes 'mcq'): kept to prove the bank's filter works.
    item: {
      id: 'demo:algebra:3:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'algebra',
      moduleId: MODULE_ALGEBRA,
      level: 3,
      kind: 'mcq',
      prompt: 'Which value of x solves 2x - 3 = 11?',
      options: ['6', '7', '8'],
    },
    answerKey: ['opt-2'],
  },
  {
    // Not servable (SERVABLE_KINDS excludes 'code_output'): kept for the same reason.
    item: {
      id: 'demo:python:1:a',
      teacherId: DEMO_PRACTICE_TEACHER_ID,
      topicId: 'python-loops',
      moduleId: MODULE_PYTHON,
      level: 1,
      kind: 'code_output',
      prompt: 'What does `print(2 + 2)` print? (it prints 4)',
    },
    answerKey: ['4'],
  },
] as const;

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
  };
}

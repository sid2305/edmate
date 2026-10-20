// Task 5.6 Phase A: the demo fixture bank is well-formed and behaves like a real PracticeBank.
import { describe, expect, it } from 'vitest';
import {
  DEMO_PRACTICE_RECORDS,
  DEMO_PRACTICE_TEACHER_ID,
  demoPracticeBank,
} from './demoPracticeBank.js';
import { pickItem, validateItem, type PracticeScope } from './practiceItems.js';

const T = DEMO_PRACTICE_TEACHER_ID;
const ALL_MODULES = [...new Set(DEMO_PRACTICE_RECORDS.map((r) => r.item.moduleId))];
const scopeAll: PracticeScope = { teacherId: T, allowedModuleIds: ALL_MODULES };

describe('DEMO_PRACTICE_RECORDS', () => {
  it('every record passes validateItem', () => {
    for (const { item, answerKey } of DEMO_PRACTICE_RECORDS) {
      expect(validateItem(item, answerKey)).toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = DEMO_PRACTICE_RECORDS.map((r) => r.item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers at least three modules and more than one level', () => {
    const levels = new Set(DEMO_PRACTICE_RECORDS.map((r) => r.item.level));
    expect(ALL_MODULES.length).toBeGreaterThanOrEqual(3);
    expect(levels.size).toBeGreaterThan(1);
  });

  it('every record carries the demo teacher id (5.6c)', () => {
    expect(DEMO_PRACTICE_TEACHER_ID).toBe('tch_test_01');
    for (const { item } of DEMO_PRACTICE_RECORDS) expect(item.teacherId).toBe(T);
  });

  it('includes an mcq and a code_output record, kept to prove the bank never serves them', () => {
    const kinds = new Set(DEMO_PRACTICE_RECORDS.map((r) => r.item.kind));
    expect(kinds.has('mcq')).toBe(true);
    expect(kinds.has('code_output')).toBe(true);
  });
});

describe('demoPracticeBank: scoped reads (architect review point 1)', () => {
  it('returns a fixture item for a known (module, level) inside scope', () => {
    const bank = demoPracticeBank();
    const item = bank.pick({ teacherId: T, allowedModuleIds: ['module-arithmetic'] }, 1, []);
    expect(item?.moduleId).toBe('module-arithmetic');
    expect(item?.level).toBe(1);
  });

  it('never returns an item outside scope.allowedModuleIds, even when it exists at that level', () => {
    const bank = demoPracticeBank();
    // demo:arithmetic:1:a exists at level 1, but module-arithmetic is not in this scope.
    const item = bank.pick({ teacherId: T, allowedModuleIds: ['module-fractions'] }, 1, []);
    expect(item?.moduleId).not.toBe('module-arithmetic');
  });

  it('returns undefined when scope allows no module that has anything at that level', () => {
    const bank = demoPracticeBank();
    expect(bank.pick({ teacherId: T, allowedModuleIds: [] }, 1, [])).toBeUndefined();
    expect(
      bank.pick({ teacherId: T, allowedModuleIds: ['no-such-module'] }, 1, []),
    ).toBeUndefined();
  });

  it('respects the exclude list within scope', () => {
    const bank = demoPracticeBank();
    const scope = { teacherId: T, allowedModuleIds: ['module-arithmetic'] };
    const first = bank.pick(scope, 1, []);
    expect(bank.pick(scope, 1, [first?.id as string])).toBeUndefined();
  });

  it('answerKeyFor refuses a key when the item is outside the scope asked for', () => {
    const bank = demoPracticeBank();
    expect(
      bank.answerKeyFor('demo:arithmetic:1:a', {
        teacherId: T,
        allowedModuleIds: ['module-fractions'],
      }),
    ).toBeUndefined();
    expect(
      bank.answerKeyFor('demo:arithmetic:1:a', {
        teacherId: T,
        allowedModuleIds: ['module-arithmetic'],
      }),
    ).toEqual(['7']);
  });

  it('answerKeyFor returns undefined for an id the bank never had, regardless of scope', () => {
    const bank = demoPracticeBank();
    expect(bank.answerKeyFor('no-such-id', scopeAll)).toBeUndefined();
  });

  it('never serves the mcq or code_output fixture records (point 4)', () => {
    const bank = demoPracticeBank();
    expect(
      bank.pick({ teacherId: T, allowedModuleIds: ['module-algebra'] }, 3, []),
    ).toBeUndefined();
    expect(
      bank.pick({ teacherId: T, allowedModuleIds: ['module-python'] }, 1, []),
    ).toBeUndefined();
  });
});

describe('demoPracticeBank: teacher scope (5.6c)', () => {
  const other: PracticeScope = { teacherId: 'tch_other', allowedModuleIds: ['module-arithmetic'] };

  it('a pick for another teacher with the same module id returns nothing', () => {
    expect(demoPracticeBank().pick(other, 1, [])).toBeUndefined();
    expect(demoPracticeBank().pick({ ...scopeAll, teacherId: 'tch_other' }, 2, [])).toBeUndefined();
  });

  it('answerKeyFor returns nothing for another teacher with the same module id', () => {
    expect(demoPracticeBank().answerKeyFor('demo:arithmetic:1:a', other)).toBeUndefined();
  });

  it('pickItem for another teacher never serves a bank item (the generator steps in)', () => {
    const picked = pickItem(demoPracticeBank(), other, 1, []);
    expect(picked?.item.id).toMatch(/^gen:module-arithmetic:practice:1:/);
    expect(picked?.item.teacherId).toBe('tch_other');
  });
});

describe('demoPracticeBank: topic choice (architect review point 2)', () => {
  it('picks the lowest-mastery topic first when a profile is given', () => {
    const bank = demoPracticeBank();
    const scope = scopeAll;
    const item = bank.pick(scope, 2, [], {
      topics: [
        { topicId: 'arithmetic', mastery: 5 },
        { topicId: 'fractions', mastery: 9 },
        { topicId: 'algebra', mastery: 1 },
      ],
    });
    expect(item?.topicId).toBe('algebra');
  });

  it('treats an untracked topic as the weakest, so it is chosen over a tracked one', () => {
    const bank = demoPracticeBank();
    const item = bank.pick(scopeAll, 2, [], {
      topics: [{ topicId: 'arithmetic', mastery: 1 }],
    });
    expect(item?.topicId).not.toBe('arithmetic');
  });

  it("falls back to the bank's own order when no profile is given", () => {
    const bank = demoPracticeBank();
    const item = bank.pick(scopeAll, 2, []);
    expect(item?.topicId).toBe('arithmetic');
  });
});

describe('demoPracticeBank via pickItem', () => {
  it('is tried before the generator, when both have something', () => {
    const picked = pickItem(
      demoPracticeBank(),
      { teacherId: T, allowedModuleIds: ['module-arithmetic'] },
      1,
      [],
    );
    expect(picked?.item.id).toBe('demo:arithmetic:1:a');
    expect(picked?.answerKey).toEqual(['7']);
  });

  it('falls through to the generator for a (scope, level) it lacks', () => {
    const picked = pickItem(
      demoPracticeBank(),
      { teacherId: T, allowedModuleIds: ['module-arithmetic'] },
      3,
      [],
    );
    expect(picked?.item.moduleId).toBe('module-arithmetic');
    expect(picked?.item.kind).toBe('numeric');
  });
});

// Task 5.6 Phase A: the demo fixture bank is well-formed and behaves like a real PracticeBank.
import { describe, expect, it } from 'vitest';
import {
  buildDemoTopicMap,
  DEMO_PRACTICE_RECORDS,
  DEMO_PRACTICE_TEACHER_ID,
  DEMO_TOPIC_MAP,
  demoPracticeBank,
} from './demoPracticeBank.js';
import { pickItem, validateItem, type PracticeItem, type PracticeScope } from './practiceItems.js';

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

  it('includes an mcq and a code_output record (served since 5.6b)', () => {
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

  it('serves the mcq and code_output records at their level (5.6b Phase C)', () => {
    const bank = demoPracticeBank();
    const mcq = bank.pick({ teacherId: T, allowedModuleIds: ['module-algebra'] }, 3, []);
    expect(mcq).toMatchObject({ id: 'demo:algebra:3:a', kind: 'mcq' });
    expect(mcq?.options).toEqual(['A) 6', 'B) 7', 'C) 8']);
    const python = { teacherId: T, allowedModuleIds: ['module-python'] };
    expect(bank.pick(python, 1, [])).toMatchObject({ id: 'demo:python:1:a', kind: 'code_output' });
    expect(bank.pick(python, 2, [])).toMatchObject({ id: 'demo:python:2:a', kind: 'code_output' });
    // Served through pickItem too: each passes the runtime item checks.
    expect(pickItem(bank, python, 1, [])?.item.id).toBe('demo:python:1:a');
    expect(pickItem(bank, { teacherId: T, allowedModuleIds: ['module-algebra'] }, 3, [])?.item.id).toBe(
      'demo:algebra:3:a',
    );
  });

  it('the code_output prompts hold no giveaway, and one has its output on line 2', () => {
    const python = DEMO_PRACTICE_RECORDS.filter((r) => r.item.kind === 'code_output');
    for (const r of python) expect(r.item.prompt).not.toMatch(/it prints/iu);
    const one = python.find((r) => r.item.id === 'demo:python:1:a');
    expect(one?.item.prompt.split('\n')[1]).toContain(one?.answerKey[0]);
  });
});

describe('demoPracticeBank: itemFor (5.6b), scoped like answerKeyFor', () => {
  const bank = demoPracticeBank();
  const arithmetic = { teacherId: T, allowedModuleIds: ['module-arithmetic'] };

  it('returns the item in scope, and the mcq record with its options', () => {
    expect(bank.itemFor('demo:arithmetic:1:a', arithmetic)?.prompt).toBe('What is 3 + 4?');
    const mcq = bank.itemFor('demo:algebra:3:a', scopeAll);
    expect(mcq?.options).toEqual(['A) 6', 'B) 7', 'C) 8']);
  });

  it('returns undefined for another teacher, another module or an unknown id', () => {
    expect(bank.itemFor('demo:arithmetic:1:a', { ...arithmetic, teacherId: 'tch_other' })).toBe(
      undefined,
    );
    expect(
      bank.itemFor('demo:arithmetic:1:a', { teacherId: T, allowedModuleIds: ['module-python'] }),
    ).toBeUndefined();
    expect(bank.itemFor('demo:nope:1:a', scopeAll)).toBeUndefined();
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
        { topicId: 'python-loops', mastery: 7 },
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

describe('DEMO_TOPIC_MAP (6.1a Q1)', () => {
  const arithmeticScope: PracticeScope = { teacherId: T, allowedModuleIds: ['module-arithmetic'] };

  it('serves the expected demo item end to end through pickItem when DEMO_TOPIC_MAP is passed', () => {
    const picked = pickItem(
      demoPracticeBank(),
      arithmeticScope,
      1,
      [],
      undefined,
      undefined,
      DEMO_TOPIC_MAP,
    );
    expect(picked?.item.id).toBe('demo:arithmetic:1:a');
    expect(picked?.answerKey).toEqual(['7']);
  });

  it('skips a record whose topicId does not match DEMO_TOPIC_MAP, served when the map is not passed', () => {
    const mutated: PracticeItem = { ...DEMO_PRACTICE_RECORDS[0]!.item, topicId: 'not-a-real-topic' };
    const records = [{ item: mutated, answerKey: DEMO_PRACTICE_RECORDS[0]!.answerKey }];
    const bank = demoPracticeBank(records);

    const withMap = pickItem(bank, arithmeticScope, 1, [], undefined, undefined, DEMO_TOPIC_MAP);
    expect(withMap?.item.id).not.toBe(mutated.id);
    expect(withMap?.item.id).toMatch(/^gen:/);

    const withoutMap = pickItem(bank, arithmeticScope, 1, []);
    expect(withoutMap?.item.id).toBe(mutated.id);
  });

  it('builds the real DEMO_PRACTICE_RECORDS without throwing (fail-closed guard never fires today)', () => {
    expect(() => buildDemoTopicMap(DEMO_PRACTICE_RECORDS)).not.toThrow();
  });

  it('throws (fail closed) when records would build an invalid topic map', () => {
    // A record with an empty topicId fails `idFormat`'s min(1), so buildTopicMap returns
    // `ok: false, reason: 'invalid'`; buildDemoTopicMap must throw rather than swallow it.
    const bad: PracticeItem = {
      id: 'bad:1',
      teacherId: T,
      topicId: '',
      moduleId: 'module-bad',
      level: 1,
      kind: 'numeric',
      prompt: 'What is 1 + 1?',
    };
    expect(() => buildDemoTopicMap([{ item: bad, answerKey: ['2'] }])).toThrow(
      /do not build a valid topic map/,
    );
  });
});

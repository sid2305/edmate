// Task 5.6 Phase A: the item model, bank interface and generator (pure, no pipeline wiring).
import { describe, expect, it } from 'vitest';
import { PRACTICE_ID_MAX } from '../pedagogy/helpState.js';
import { prng } from '../testing/prng.js';
import {
  GEN_VARIANTS,
  generatedAnswerKeyFor,
  generatedPrompt,
  PRACTICE_OPTION_MAX,
  PRACTICE_PROMPT_MAX,
  parseGeneratedId,
  generateItem,
  pickItem,
  SERVABLE_KINDS,
  validateItem,
  type PracticeBank,
  type PracticeItem,
  type PracticeLevel,
  type PracticeScope,
} from './practiceItems.js';

/** A tiny in-test bank over fixed records: the caller only ever asks by scope/level. */
function fixedBank(
  records: readonly { item: PracticeItem; answerKey: readonly string[] }[],
): PracticeBank {
  return {
    pick(scope, level, exclude) {
      const allowed = new Set(scope.allowedModuleIds);
      return records.find(
        (r) =>
          allowed.has(r.item.moduleId) &&
          r.item.level === level &&
          SERVABLE_KINDS.has(r.item.kind) &&
          !exclude.includes(r.item.id),
      )?.item;
    },
    answerKeyFor(itemId, scope) {
      const r = records.find((rec) => rec.item.id === itemId);
      if (r === undefined || !scope.allowedModuleIds.includes(r.item.moduleId)) return undefined;
      return r.answerKey;
    },
    itemFor(itemId, scope) {
      const r = records.find((rec) => rec.item.id === itemId);
      return r === undefined || !scope.allowedModuleIds.includes(r.item.moduleId)
        ? undefined
        : r.item;
    },
  };
}

const BANK_ITEM: PracticeItem = {
  id: 'bank:1',
  teacherId: 'teacher-1',
  topicId: 'fractions',
  moduleId: 'module-fractions',
  level: 2,
  kind: 'short',
  prompt: 'Simplify 4/8.',
};
const BANK_RECORD = { item: BANK_ITEM, answerKey: ['1/2'] };

const SCOPE: PracticeScope = { teacherId: 'teacher-1', allowedModuleIds: ['module-fractions'] };
const OTHER_SCOPE: PracticeScope = { teacherId: 'teacher-1', allowedModuleIds: ['module-other'] };
const LEVELS = [1, 2, 3] as const satisfies readonly PracticeLevel[];

describe('generateItem (scoped generator fallback)', () => {
  it('never serves outside scope: empty allowedModuleIds yields nothing', () => {
    expect(generateItem({ teacherId: 't', allowedModuleIds: [] }, 1)).toBeUndefined();
  });

  it('is deterministic for the same scope and level', () => {
    const a = generateItem({ teacherId: 't', allowedModuleIds: ['m1'] }, 1);
    const b = generateItem({ teacherId: 't', allowedModuleIds: ['m1'] }, 1);
    expect(a).toEqual(b);
  });

  it("the item's moduleId is always one of scope.allowedModuleIds", () => {
    const r = prng(1);
    for (let i = 0; i < 200; i++) {
      const moduleIds = [`m-${r.int(10)}`, `m-${r.int(10)}`];
      const level = r.pick(LEVELS);
      const picked = generateItem({ teacherId: 't', allowedModuleIds: moduleIds }, level);
      expect(moduleIds).toContain(picked?.item.moduleId);
      expect(picked?.item.level).toBe(level);
    }
  });

  it('is numeric/arithmetic and passes validateItem', () => {
    const r = prng(2);
    for (let i = 0; i < 200; i++) {
      const scope = { teacherId: 't', allowedModuleIds: [`m-${r.int(50)}`] };
      const level = r.pick(LEVELS);
      const picked = generateItem(scope, level);
      expect(picked?.item.kind).toBe('numeric');
      expect(validateItem(picked!.item, picked!.answerKey)).toBe(true);
    }
  });

  it('never leaks its own answer key as a whole word/number inside its prompt (validateItem)', () => {
    // A single-digit answer may coincidentally appear as a substring of a larger operand (e.g.
    // "7" inside "37") without that being a real leak — validateItem (word/number-bounded) is the
    // right check here, not a raw substring scan.
    const r = prng(3);
    for (let i = 0; i < 200; i++) {
      const scope = { teacherId: 't', allowedModuleIds: [`m-${r.int(50)}`] };
      const level = r.pick(LEVELS);
      const picked = generateItem(scope, level);
      expect(validateItem(picked!.item, picked!.answerKey)).toBe(true);
    }
  });

  it('level 2 (subtraction) never lets the answer equal either operand, over a wide scan', () => {
    for (let i = 0; i < 500; i++) {
      const picked = generateItem({ teacherId: 't', allowedModuleIds: [`m-${i}`] }, 2)!;
      const answer = Number(picked.answerKey[0]);
      const [, aStr, bStr] = /^What is (\d+) - (\d+)\?$/.exec(picked.item.prompt) ?? [];
      const a = Number(aStr);
      const b = Number(bStr);
      expect(a - b).toBe(answer);
      expect(answer).not.toBe(a);
      expect(answer).not.toBe(b);
      expect(validateItem(picked.item, picked.answerKey)).toBe(true);
    }
  });

  // Found by scanning moduleIds offline (a === 2b before the nudge: 43 - 43 would equal 43).
  it('nudges a up by 1 when the un-nudged answer would equal b (a === 2b)', () => {
    const picked = generateItem({ teacherId: 't', allowedModuleIds: ['m-65'] }, 2)!;
    expect(picked.item.prompt).toBe('What is 87 - 43?');
    expect(picked.answerKey).toEqual(['44']);
  });
});

describe('generatedAnswerKeyFor', () => {
  it('recomputes the same key a generated item was given, from its id alone', () => {
    const picked = generateItem({ teacherId: 't', allowedModuleIds: ['m1'] }, 1)!;
    expect(generatedAnswerKeyFor(picked.item.id)).toEqual(picked.answerKey);
  });

  it('returns undefined for an id it did not produce', () => {
    expect(generatedAnswerKeyFor('demo:arithmetic:1:a')).toBeUndefined();
    expect(generatedAnswerKeyFor('not-a-real-id')).toBeUndefined();
  });
});

describe('pickItem', () => {
  it('tries the bank before the generator', () => {
    const bank = fixedBank([BANK_RECORD]);
    const picked = pickItem(bank, SCOPE, 2, []);
    expect(picked?.item).toEqual(BANK_ITEM);
    expect(picked?.answerKey).toEqual(['1/2']);
  });

  it('falls back to the generator when the bank has nothing for that (scope, level)', () => {
    const bank = fixedBank([BANK_RECORD]);
    const picked = pickItem(bank, SCOPE, 3, []);
    expect(picked?.item.moduleId).toBe('module-fractions');
    expect(picked?.item.level).toBe(3);
    expect(picked?.item.kind).toBe('numeric');
  });

  it('respects the bank exclusion list and falls through to the generator', () => {
    const bank = fixedBank([BANK_RECORD]);
    const picked = pickItem(bank, SCOPE, 2, [BANK_ITEM.id]);
    expect(picked?.item.id).not.toBe(BANK_ITEM.id);
    expect(picked?.item.moduleId).toBe('module-fractions');
  });

  it('falls through to the generator when the bank picks an item but refuses its own key', () => {
    // A bank bug (or a stale index) can return an item from `pick` yet refuse `answerKeyFor` for
    // that same id/scope; `pickItem` must not hand out an item with no key, so it falls through.
    const noKeyBank: PracticeBank = {
      pick: () => BANK_ITEM,
      itemFor: () => undefined,
      answerKeyFor: () => undefined,
    };
    const picked = pickItem(noKeyBank, SCOPE, 2, []);
    expect(picked?.item.id).not.toBe(BANK_ITEM.id);
    expect(picked?.item.kind).toBe('numeric');
  });

  it('never returns a bank item whose moduleId is outside scope.allowedModuleIds', () => {
    const bank = fixedBank([BANK_RECORD]);
    const picked = pickItem(bank, OTHER_SCOPE, 2, []);
    // The bank has nothing in module-other, so it falls through to the generator, scoped there.
    expect(picked?.item.moduleId).toBe('module-other');
    expect(picked?.item.id).not.toBe(BANK_ITEM.id);
  });

  it('returns undefined when scope allows no module and the bank has nothing either', () => {
    const bank = fixedBank([BANK_RECORD]);
    const picked = pickItem(bank, { teacherId: 't', allowedModuleIds: [] }, 2, []);
    expect(picked).toBeUndefined();
  });

  it("every item's moduleId is always inside the scope asked for, over a wide scan", () => {
    const bank = fixedBank([BANK_RECORD]);
    const r = prng(4);
    for (let i = 0; i < 100; i++) {
      const moduleIds = [r.pick(['module-fractions', 'module-a', 'module-b', 'module-c'])];
      const level = r.pick(LEVELS);
      const picked = pickItem(bank, { teacherId: 't', allowedModuleIds: moduleIds }, level, []);
      expect(moduleIds).toContain(picked?.item.moduleId);
    }
  });
});

describe('teacher scope (5.6c)', () => {
  /** A bank that ignores teacherId (a careless or buggy bank): scope checks are the caller's. */
  const teacherBlind: PracticeBank = {
    pick: (scope, level, exclude) =>
      [BANK_ITEM].find(
        (i) =>
          scope.allowedModuleIds.includes(i.moduleId) &&
          i.level === level &&
          !exclude.includes(i.id),
      ),
    itemFor: () => undefined,
    answerKeyFor: (id) => (id === BANK_ITEM.id ? ['1/2'] : undefined),
  };

  it("never serves another teacher's bank item with the same module id; the generator steps in", () => {
    const other: PracticeScope = { ...SCOPE, teacherId: 'teacher-2' };
    const picked = pickItem(teacherBlind, other, 2, []);
    expect(picked?.item.id).not.toBe(BANK_ITEM.id);
    expect(picked?.item.id).toMatch(/^gen:module-fractions:practice:2:/);
    expect(picked?.item.teacherId).toBe('teacher-2');
    // The same bank serves its own teacher.
    expect(pickItem(teacherBlind, SCOPE, 2, [])?.item).toEqual(BANK_ITEM);
  });

  it("a generated item carries the scope's teacherId", () => {
    expect(generateItem({ teacherId: 'tch-9', allowedModuleIds: ['m1'] }, 3)?.item.teacherId).toBe(
      'tch-9',
    );
  });
});

describe('parseGeneratedId (5.6c: one bounded parser)', () => {
  it.each([
    [
      'gen:m1:practice:1:3+4',
      { topicId: 'm1:practice', moduleId: 'm1', level: 1, a: 3, op: '+', b: 4 },
    ],
    [
      'gen:m1:practice:2:87-43',
      { topicId: 'm1:practice', moduleId: 'm1', level: 2, a: 87, op: '-', b: 43 },
    ],
    [
      'gen:m1:practice:3:12*11',
      { topicId: 'm1:practice', moduleId: 'm1', level: 3, a: 12, op: '*', b: 11 },
    ],
    [
      'gen:a:b:c:practice:1:1+999',
      { topicId: 'a:b:c:practice', moduleId: 'a:b:c', level: 1, a: 1, op: '+', b: 999 },
    ],
  ])('parses %s', (id, want) => {
    expect(parseGeneratedId(id)).toEqual(want);
  });

  it.each([
    ['a 4-digit operand', 'gen:m1:practice:1:1000+4'],
    ['a leading zero', 'gen:m1:practice:1:03+4'],
    ['a zero operand', 'gen:m1:practice:1:0+4'],
    ['the wrong op for level 1', 'gen:m1:practice:1:3*4'],
    ['the wrong op for level 2', 'gen:m1:practice:2:30+4'],
    ['the wrong op for level 3', 'gen:m1:practice:3:3-4'],
    ['a topic without :practice', 'gen:m1:1:3+4'],
    ['an empty module id', 'gen::practice:1:3+4'],
    ['level 4', 'gen:m1:practice:4:3+4'],
    ['a bank id', 'demo:arithmetic:1:a'],
    ['an id over PRACTICE_ID_MAX', `gen:${'m'.repeat(PRACTICE_ID_MAX)}:practice:1:3+4`],
  ])('rejects %s', (_label, id) => {
    expect(parseGeneratedId(id)).toBeUndefined();
  });

  it('every generated id parses back to its own module and level', () => {
    for (const level of LEVELS) {
      const picked = generateItem({ teacherId: 't', allowedModuleIds: ['a:b'] }, level)!;
      expect(parseGeneratedId(picked.item.id)).toMatchObject({ moduleId: 'a:b', level });
    }
  });

  it('generatedAnswerKeyFor: undefined for a 25-digit operand id (bounded operands)', () => {
    expect(generatedAnswerKeyFor(`gen:m1:practice:1:${'9'.repeat(25)}+1`)).toBeUndefined();
    expect(generatedAnswerKeyFor('gen:m1:practice:3:3-4')).toBeUndefined();
  });
});

describe('pickItem validates every item at runtime (5.6 review)', () => {
  /** A bank that hands out its records in order, ignoring kind (a careless or buggy bank). */
  function carelessBank(
    records: readonly { item: PracticeItem; answerKey: readonly string[] }[],
  ): PracticeBank {
    return {
      pick: (_scope, level, exclude) =>
        records.find((r) => r.item.level === level && !exclude.includes(r.item.id))?.item,
      answerKeyFor: (itemId) => records.find((r) => r.item.id === itemId)?.answerKey,
      itemFor: (itemId) => records.find((r) => r.item.id === itemId)?.item,
    };
  }
  const leaky: PracticeItem = { ...BANK_ITEM, id: 'bank:leaky', prompt: 'Is 1/2 the answer?' };
  const mcq: PracticeItem = {
    ...BANK_ITEM,
    id: 'bank:mcq',
    kind: 'mcq',
    prompt: 'Which is half?',
    options: ['a', 'b'],
  };

  it('never serves a bank item whose prompt holds its own key; the generator steps in', () => {
    const picked = pickItem(carelessBank([{ item: leaky, answerKey: ['1/2'] }]), SCOPE, 2, []);
    expect(picked?.item.id).not.toBe(leaky.id);
    expect(picked?.item.id).toMatch(/^gen:module-fractions:practice:2:/);
  });

  it('never serves an mcq (or code_output) item, even from a bank that offers one', () => {
    const code: PracticeItem = { ...BANK_ITEM, id: 'bank:code', kind: 'code_output' };
    const bank = carelessBank([
      { item: mcq, answerKey: ['opt-1'] },
      { item: code, answerKey: ['42'] },
    ]);
    const picked = pickItem(bank, SCOPE, 2, []);
    expect(picked?.item.kind).toBe('numeric');
    expect([mcq.id, code.id]).not.toContain(picked?.item.id);
  });

  it('skips an invalid bank item and serves the next valid one from the bank', () => {
    const bank = carelessBank([
      { item: leaky, answerKey: ['1/2'] },
      { item: BANK_ITEM, answerKey: ['1/2'] },
    ]);
    expect(pickItem(bank, SCOPE, 2, [])?.item).toEqual(BANK_ITEM);
  });

  it('never serves a bank item outside scope, or one whose id is over PRACTICE_ID_MAX', () => {
    const outside: PracticeItem = { ...BANK_ITEM, id: 'bank:out', moduleId: 'module-other' };
    const long: PracticeItem = { ...BANK_ITEM, id: `bank:${'x'.repeat(PRACTICE_ID_MAX)}` };
    const bank = carelessBank([
      { item: outside, answerKey: ['1/2'] },
      { item: long, answerKey: ['1/2'] },
    ]);
    expect(pickItem(bank, SCOPE, 2, [])?.item.id).toMatch(/^gen:/);
  });

  it('stops asking a bank that keeps returning the same rejected item', () => {
    const stuck: PracticeBank = {
      pick: () => leaky,
      itemFor: () => undefined,
      answerKeyFor: () => ['1/2'],
    };
    expect(pickItem(stuck, SCOPE, 2, [])?.item.id).toMatch(/^gen:/);
  });

  it('skips items the caller does not accept (an earlier key in the prompt)', () => {
    const bank = fixedBank([BANK_RECORD]);
    const picked = pickItem(bank, SCOPE, 2, [], undefined, (item) => item.id !== BANK_ITEM.id);
    expect(picked?.item.id).toMatch(/^gen:/);
  });

  it('accept receives the item and its answer key (5.6a), bank and generated alike', () => {
    const seen: [string, readonly string[]][] = [];
    const bank = fixedBank([BANK_RECORD]);
    const picked = pickItem(bank, SCOPE, 2, [], undefined, (item, key) => {
      seen.push([item.id, key]);
      return item.id !== BANK_ITEM.id;
    });
    expect(seen[0]).toEqual([BANK_ITEM.id, ['1/2']]);
    expect(seen[1]?.[0]).toBe(picked?.item.id);
    expect(seen[1]?.[1]).toEqual(picked?.answerKey);
  });

  it('fails closed when nothing is valid: no bank item, no generated variant accepted', () => {
    const bank = fixedBank([BANK_RECORD]);
    expect(pickItem(bank, SCOPE, 2, [], undefined, () => false)).toBeUndefined();
  });
});

describe('generateItem honours the exclude list (5.6 review)', () => {
  it('serves a different item for each excluded one, deterministically', () => {
    const scope: PracticeScope = { teacherId: 't', allowedModuleIds: ['m1'] };
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const picked = generateItem(scope, 1, ids);
      expect(picked).toBeDefined();
      expect(ids).not.toContain(picked?.item.id);
      expect(generatedAnswerKeyFor(picked?.item.id ?? '')).toEqual(picked?.answerKey);
      ids.push(picked?.item.id ?? '');
    }
    // The same exclude list gives the same next item.
    expect(generateItem(scope, 1, ids.slice(0, 3))).toEqual(
      generateItem(scope, 1, ids.slice(0, 3)),
    );
  });

  it('the first variant is unchanged when nothing is excluded', () => {
    const scope: PracticeScope = { teacherId: 't', allowedModuleIds: ['m1'] };
    expect(generateItem(scope, 1, [])).toEqual(generateItem(scope, 1));
  });

  it('gives up after GEN_VARIANTS tries (fail closed)', () => {
    const scope: PracticeScope = { teacherId: 't', allowedModuleIds: ['m1'] };
    let tries = 0;
    const picked = generateItem(scope, 1, [], () => {
      tries++;
      return false;
    });
    expect(picked).toBeUndefined();
    expect(tries).toBe(GEN_VARIANTS);
  });

  it('never makes an id over PRACTICE_ID_MAX: a very long module id fails closed', () => {
    const scope: PracticeScope = {
      teacherId: 't',
      allowedModuleIds: ['m'.repeat(PRACTICE_ID_MAX)],
    };
    expect(generateItem(scope, 1)).toBeUndefined();
  });
});

describe('validateItem', () => {
  it('rejects an item with an empty answerKey', () => {
    const item: PracticeItem = {
      id: 'x',
      teacherId: 't',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'short',
      prompt: 'Say hi.',
    };
    expect(validateItem(item, [])).toBe(false);
  });

  it('rejects an item whose only answer form the matcher could never catch (blank)', () => {
    const item: PracticeItem = {
      id: 'x',
      teacherId: 't',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'short',
      prompt: 'Say hi.',
    };
    expect(validateItem(item, ['   '])).toBe(false);
  });

  it('rejects an item whose key appears verbatim inside its own prompt', () => {
    const item: PracticeItem = {
      id: 'x',
      teacherId: 't',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'short',
      prompt: 'The answer is Warm. What is the answer?',
    };
    expect(validateItem(item, ['Warm'])).toBe(false);
  });

  it('accepts a code_output item whose key legitimately appears in the prompt', () => {
    const item: PracticeItem = {
      id: 'x',
      teacherId: 't',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'code_output',
      prompt: 'What does `print(6)` print? (hint: it prints 6)',
    };
    expect(validateItem(item, ['6'])).toBe(true);
  });

  it("a code_output item's own key still trips the shared, kind-unaware answerKey.ts matcher", async () => {
    // Architect review point 4: the code_output exemption lives only in validateItem. Proven by
    // reusing the same primitive the shared matcher is built on (normaliseForMatch), the key is
    // still found verbatim in the prompt — so any other call site that checks model-visible
    // context without validateItem's exemption (e.g. Phase C's full-turn leak scan) still catches
    // it if a future kind or path slips past this one.
    const { normaliseForMatch } = await import('../pipeline/generate/answerKey.js');
    const prompt = 'What does `print(6)` print? (hint: it prints 6)';
    expect(normaliseForMatch(prompt).includes(normaliseForMatch('6'))).toBe(true);
  });

  it('refuses an mcq item with no options, or with an opaque option-id key (5.6b shape)', () => {
    const item: PracticeItem = {
      id: 'x',
      teacherId: 't',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'mcq',
      prompt: 'Which of these numbers is prime?',
    };
    expect(validateItem(item, ['opt-2'])).toBe(false);
    expect(validateItem({ ...item, options: ['4', '7', '9'] }, ['opt-2'])).toBe(false);
    // '7' is the correct option's own visible text, not a label: refused too.
    expect(validateItem({ ...item, options: ['4', '7', '9'] }, ['7'])).toBe(false);
  });

  const short = (fields: Partial<PracticeItem>): PracticeItem => ({
    id: 'x',
    teacherId: 't',
    topicId: 't',
    moduleId: 'm',
    level: 1,
    kind: 'short',
    prompt: 'Pick a value.',
    ...fields,
  });

  it.each(['short', 'numeric', 'code_output'] as const)(
    'rejects a %s item whose key is in one of its options (5.6c)',
    (kind) => {
      const item = short({ kind, options: ['maybe Warm', 'cold'] });
      expect(validateItem(item, ['opt-1', 'Warm'])).toBe(false);
      expect(validateItem({ ...item, options: ['hot', 'cold'] }, ['opt-1', 'Warm'])).toBe(true);
    },
  );

  it('rejects an id holding a non-exempt key (5.6c)', () => {
    // Only a short whole number written in digits is exempt in an id: the word "one" is checked.
    expect(validateItem(short({ id: 'bank:one:a' }), ['1', 'one'])).toBe(false);
    expect(validateItem(short({ id: 'bank:1:a' }), ['1', 'one'])).toBe(true);
    expect(validateItem(short({ id: 'bank:42:a' }), ['42'])).toBe(true);
    expect(validateItem(short({ id: 'bank:warm:a' }), ['Warm'])).toBe(false);
    expect(validateItem(short({ id: 'bank:4321:a' }), ['4321'])).toBe(false);
    expect(validateItem(short({ id: 'bank:43210:a' }), ['4321'])).toBe(true);
  });

  it('accepts an id holding only exempt short numeric keys (demo:fractions:1:a with 1/one)', () => {
    expect(validateItem(short({ id: 'demo:fractions:1:a' }), ['1', 'one'])).toBe(true);
  });

  it('accepts a well-formed numeric item', () => {
    const item: PracticeItem = {
      id: 'x',
      teacherId: 't',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'numeric',
      prompt: 'What is 2 + 2?',
    };
    expect(validateItem(item, ['4'])).toBe(true);
  });
});

describe('validateItem: the mcq item rules (5.6b)', () => {
  // A concept question: its prompt neither shows nor computes to the correct option.
  const mcq = (fields: Partial<PracticeItem> = {}): PracticeItem => ({
    id: 'bank:loops:1:a',
    teacherId: 't',
    topicId: 'loops',
    moduleId: 'm',
    level: 1,
    kind: 'mcq',
    prompt: 'Which loop always runs its body at least once?',
    options: ['A) do-while loop', 'B) for loop', 'C) while loop'],
    ...fields,
  });
  const six = ['A) one', 'B) two', 'C) three', 'D) four', 'E) five', 'F) six'];

  it('accepts a well-formed mcq: 3 labelled options, one bare capital key in range', () => {
    expect(validateItem(mcq(), ['A'])).toBe(true);
    expect(validateItem(mcq(), ['B'])).toBe(true);
    expect(validateItem(mcq(), ['C'])).toBe(true);
  });

  it('accepts 6 options; refuses 2 and 7', () => {
    const p = 'Which word names how many legs an insect has?';
    expect(validateItem(mcq({ prompt: p, options: six }), ['F'])).toBe(true);
    expect(validateItem(mcq({ options: ['A) do-while loop', 'B) for loop'] }), ['A'])).toBe(false);
    expect(validateItem(mcq({ prompt: p, options: [...six, 'G) seven'] }), ['F'])).toBe(false);
  });

  it('refuses unlabelled, out-of-order or badly labelled options', () => {
    for (const options of [
      ['do-while loop', 'for loop', 'while loop'],
      ['B) do-while loop', 'A) for loop', 'C) while loop'],
      ['A) do-while loop', 'C) for loop', 'D) while loop'],
      ['A. do-while loop', 'B. for loop', 'C. while loop'],
      ['a) do-while loop', 'b) for loop', 'c) while loop'],
      ['A) do-while loop', 'B) ', 'C) while loop'],
    ]) {
      expect(validateItem(mcq({ options }), ['A'])).toBe(false);
    }
  });

  it('refuses any key that is not exactly one bare capital label in range', () => {
    for (const key of [['(B)'], ['b'], ['B)'], ['opt-2'], ['D'], ['Z'], ['A', 'B'], ['']]) {
      expect(validateItem(mcq(), key)).toBe(false);
    }
  });

  it("refuses a prompt holding the correct option's text, in any form the matcher reads", () => {
    const options = ['A) 6', 'B) 7', 'C) 8'];
    expect(validateItem(mcq({ prompt: 'Which equals 7?', options }), ['B'])).toBe(false);
    expect(validateItem(mcq({ prompt: 'Which equals seven?', options }), ['B'])).toBe(false);
    // Phase A note (lead answer): a sum prompt computes to its option, so it is refused too.
    expect(validateItem(mcq({ prompt: 'What is 3 + 4?', options }), ['B'])).toBe(false);
    expect(validateItem(mcq({ prompt: 'Which of these is a prime number?', options }), ['B'])).toBe(
      true,
    );
  });

  it("refuses a prompt naming the correct option's position in an answer context", () => {
    expect(validateItem(mcq({ prompt: 'Is the second one right?' }), ['B'])).toBe(false);
    expect(validateItem(mcq({ prompt: 'Is the second option right?' }), ['A'])).toBe(true);
  });

  it('checks the key in the prompt, options and id with the label matcher', () => {
    // The article "a" and an id ending ":a" do not refuse key A.
    const prime = mcq({
      id: 'bank:primes:3:a',
      prompt: 'Which is a prime?',
      options: ['A) 7', 'B) 8', 'C) 9'],
    });
    expect(validateItem(prime, ['A'])).toBe(true);
    // A real mention does.
    const hinted = mcq({ prompt: 'Hint: B. Which loop runs its body at least once?' });
    expect(validateItem(hinted, ['B'])).toBe(false);
    const inOption = mcq({ options: ['A) do-while loop', 'B) for loop', 'C) not B'] });
    expect(validateItem(inOption, ['B'])).toBe(false);
    expect(validateItem(mcq({ id: 'bank:answer-is-b' }), ['B'])).toBe(false);
  });

  it('a label key on another kind is checked with the label matcher too', () => {
    const shortA: PracticeItem = {
      id: 'bank:shapes:1:a',
      teacherId: 't',
      topicId: 'shapes',
      moduleId: 'm',
      level: 1,
      kind: 'short',
      prompt: 'Is a square a rectangle?',
    };
    expect(validateItem(shortA, ['A'])).toBe(true);
    expect(validateItem({ ...shortA, prompt: 'The answer is A.' }, ['A'])).toBe(false);
  });

  it('caps the prompt and every option, for every kind', () => {
    const long = (n: number) => 'x'.repeat(n);
    expect(validateItem(mcq({ prompt: `${long(PRACTICE_PROMPT_MAX - 1)}?` }), ['A'])).toBe(true);
    expect(validateItem(mcq({ prompt: `${long(PRACTICE_PROMPT_MAX)}?` }), ['A'])).toBe(false);
    const options = (n: number) => ['A) do-while loop', 'B) for loop', `C) ${long(n - 3)}`];
    expect(validateItem(mcq({ options: options(PRACTICE_OPTION_MAX) }), ['A'])).toBe(true);
    expect(validateItem(mcq({ options: options(PRACTICE_OPTION_MAX + 1) }), ['A'])).toBe(false);
    const numeric: PracticeItem = {
      id: 'bank:sum:1:a',
      teacherId: 't',
      topicId: 'sum',
      moduleId: 'm',
      level: 1,
      kind: 'numeric',
      prompt: 'What is 2 + 2?',
    };
    expect(validateItem(numeric, ['4'])).toBe(true);
    const longPrompt = `${long(PRACTICE_PROMPT_MAX)} 2 + 2?`;
    expect(validateItem({ ...numeric, prompt: longPrompt }, ['4'])).toBe(false);
    const longOption = [long(PRACTICE_OPTION_MAX + 1)];
    expect(validateItem({ ...numeric, options: longOption }, ['4'])).toBe(false);
  });

  it('code_output keeps its key-in-prompt exemption, still checked against options and id', () => {
    const code: PracticeItem = {
      id: 'bank:py:1:a',
      teacherId: 't',
      topicId: 'py',
      moduleId: 'm',
      level: 1,
      kind: 'code_output',
      prompt: 'What does this print?\nprint(4)\n# one line',
    };
    expect(validateItem(code, ['4'])).toBe(true);
    expect(validateItem({ ...code, options: ['it prints 4'] }, ['4'])).toBe(false);
    expect(validateItem({ ...code, id: 'bank:py:hello' }, ['hello'])).toBe(false);
  });
});

describe('generatedPrompt (5.6b: one source for a generated prompt)', () => {
  it("rebuilds every generated item's prompt from its id", () => {
    for (const level of LEVELS) {
      const exclude: string[] = [];
      for (let v = 0; v < 8; v++) {
        const picked = generateItem(SCOPE, level, exclude);
        if (picked === undefined) throw new Error('no item');
        const g = parseGeneratedId(picked.item.id);
        if (g === undefined) throw new Error('unparsed');
        expect(generatedPrompt(g)).toBe(picked.item.prompt);
        exclude.push(picked.item.id);
      }
    }
  });
});

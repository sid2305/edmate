// Task 5.6 Phase A: the item model, bank interface and generator (pure, no pipeline wiring).
import { describe, expect, it } from 'vitest';
import { prng } from '../testing/prng.js';
import {
  generatedAnswerKeyFor,
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
  };
}

const BANK_ITEM: PracticeItem = {
  id: 'bank:1',
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

describe('validateItem', () => {
  it('rejects an item with an empty answerKey', () => {
    const item: PracticeItem = {
      id: 'x',
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

  it('accepts an mcq item with no options field at all (nothing to collide with)', () => {
    const item: PracticeItem = {
      id: 'x',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'mcq',
      prompt: 'Which of these numbers is prime?',
    };
    expect(validateItem(item, ['opt-2'])).toBe(true);
  });

  it('accepts a well-formed mcq item whose key is an opaque option id, not its text', () => {
    const item: PracticeItem = {
      id: 'x',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'mcq',
      prompt: 'Which of these numbers is prime?',
      options: ['4', '7', '9'],
    };
    expect(validateItem(item, ['opt-2'])).toBe(true);
  });

  it('rejects an mcq item whose key is a bare label equal to one of the option texts', () => {
    const item: PracticeItem = {
      id: 'x',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'mcq',
      prompt: 'Which of these numbers is prime?',
      options: ['4', '7', '9'],
    };
    // '7' is the correct option's own visible text, not an opaque id: rejected (point 4).
    expect(validateItem(item, ['7'])).toBe(false);
  });

  it('accepts a well-formed numeric item', () => {
    const item: PracticeItem = {
      id: 'x',
      topicId: 't',
      moduleId: 'm',
      level: 1,
      kind: 'numeric',
      prompt: 'What is 2 + 2?',
    };
    expect(validateItem(item, ['4'])).toBe(true);
  });
});

// Task 4.7 (grounding, Rule C): an arithmetic expression directly followed by a claimed result
// ("7 // 2 is 4") is recomputed with the shared evaluator; a wrong claim is found and can be fixed
// surgically. Pairing is strict (lead answer 9): only "expr is/=/== N" and the same few connector
// words; anything looser is left to the judge.
import { describe, expect, it } from 'vitest';
import {
  arithmeticClaims,
  arithmeticExpressions,
  correctArithmeticClaims,
  statedNumbers,
} from './numbers.js';

const wrong = (text: string) => arithmeticClaims(text).filter((c) => !c.correct);

describe('arithmeticClaims: the pairing table (lead answer 9)', () => {
  it.each([
    // [text, computed text, claim correct?]
    ['-7 // 2 is -4', '-4', true],
    ['-7 // 2 is -3', '-4', false],
    ['2 ** 3 ** 2 = 512', '512', true],
    ['2 ** 3 ** 2 = 64', '512', false],
    ['7 / 2 = 3.5', '3.5', true],
    ['7 / 2 = 3', '3.5', false],
    ['0.1 + 0.2 == 0.3', '0.3', true],
    ['0.1 + 0.2 is 0.4', '0.3', false],
    ['7 // 2 is 4', '3', false],
    ['7 // 2 is 3', '3', true],
    ['2 + 3 * 4 equals 20', '14', false],
    ['10 / 3 = 3.33', '3.33333333333', true],
    ['7 % 3 gives 1', '1', true],
  ])('%s', (text, computed, correct) => {
    const claims = arithmeticClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ computedText: computed, correct });
  });

  it('reads digits in any script and the Hindi connector words', () => {
    expect(wrong('7 // 2 का जवाब ४ होता है ना?')).toHaveLength(1);
    expect(wrong('7 // 2 ka answer 4 hota hai na?')).toHaveLength(1);
    expect(wrong('7 // 2 ka answer 3 hota hai')).toEqual([]);
  });

  it('leaves loose or unpaired claims to the judge', () => {
    for (const text of [
      'Is 7 // 2 4 or 3?', // no connector
      '7 // 2. Is the answer 4?', // not directly after
      'Try 7 // 2 and tell me what you get.', // no claim
      '7 // 2 is 4 - 1', // the claim goes on as arithmetic
      'The answer is 4.', // no expression
      '-2 ** 2 is -4', // unary sign with ** (Python binds ** first): not evaluated here
      '7 / 0 is 0', // no value
      `${'9'.repeat(16)} * 10 is 1`, // past the evaluator's range
    ]) {
      expect(arithmeticClaims(text), text).toEqual([]);
    }
  });

  it('finds every claim in a longer reply', () => {
    const text = 'First, 2 + 3 * 4 is 20 [1]. Then 7 // 2 is 3. And 8 - 2 = 5.';
    expect(arithmeticClaims(text).map((c) => [c.computedText, c.correct])).toEqual([
      ['14', false],
      ['3', true],
      ['6', false],
    ]);
  });
});

describe('correctArithmeticClaims', () => {
  it('replaces only the wrong numbers with the computed value', () => {
    const text = 'First, 2 + 3 * 4 is 20 [1]. Then 7 // 2 is 3. And -7 // 2 = -3.';
    expect(correctArithmeticClaims(text)).toEqual({
      text: 'First, 2 + 3 * 4 is 14 [1]. Then 7 // 2 is 3. And -7 // 2 = -4.',
      fixed: 2,
    });
  });

  it('is idempotent: the corrected text recomputes to itself', () => {
    const once = correctArithmeticClaims('So 7 // 2 is 4, and 2 ** 3 ** 2 = 64.');
    expect(once.fixed).toBe(2);
    expect(correctArithmeticClaims(once.text)).toEqual({ text: once.text, fixed: 0 });
  });

  it('maps folded spans back to the original text (other scripts, invisible characters)', () => {
    expect(correctArithmeticClaims('7 // 2 का जवाब ४ है')).toEqual({
      text: '7 // 2 का जवाब 3 है',
      fixed: 1,
    });
    expect(correctArithmeticClaims('7 // 2 is 1​4!')).toEqual({
      text: '7 // 2 is 3!',
      fixed: 1,
    });
  });

  it('leaves a text with nothing wrong as it is', () => {
    expect(correctArithmeticClaims('Nothing to fix here.')).toEqual({
      text: 'Nothing to fix here.',
      fixed: 0,
    });
  });
});

describe('fix round 1: expressions and stated numbers (task 4.7, safety HIGH 1)', () => {
  it('each claim carries its expression, spaces dropped', () => {
    expect(arithmeticClaims('6 - 3 is 2, and 7  //  2 = 3').map((c) => c.expr)).toEqual([
      '6-3',
      '7//2',
    ]);
  });

  it('lists every arithmetic expression, claimed or not', () => {
    expect(arithmeticExpressions('Yes, 6 - 3 rounds to 2, and 2 * 1 = 3.')).toEqual(['6-3', '2*1']);
    expect(arithmeticExpressions('No maths here, step 3.')).toEqual([]);
  });

  it('stated numbers leave out every number inside an arithmetic expression', () => {
    expect([...statedNumbers('Yes, 6 - 3 is 2. Well done!')]).toEqual(['2']);
    expect([...statedNumbers('Correct, 2 * 1 = 3.')]).toEqual(['3']);
    expect([...statedNumbers('That is step 3 in your notes.')]).toEqual(['3']);
    expect(statedNumbers('Not quite: it is three.').has('3')).toBe(true);
    expect(statedNumbers('7 // 2').size).toBe(0);
  });
});

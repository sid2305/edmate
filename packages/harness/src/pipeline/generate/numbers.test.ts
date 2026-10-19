import { describe, expect, it } from 'vitest';
import { evaluateArithmetic, MAX_EXPRESSION_LENGTH } from './arithmetic.js';
import { numberWord, scaleSuffix } from './numberWords.js';
import { canonicalNumber, numberMentions, numbersMentioned, numericKeyValue } from './numbers.js';

const has = (text: string, value: string) => numbersMentioned(text).has(value);

describe('numbersMentioned: digits and literals', () => {
  it.each([
    ['plain', 'x ends up as 16.'],
    ['Devanagari digits', 'उत्तर १६ है'],
    ['Bengali digits', 'it is ১৬'],
    ['zero-width split', '1\u200B6'],
    ['fullwidth', '１６'],
    ['decimal', '16.0'],
    ['signed', '+16'],
    ['leading zero', '016'],
    ['hex', '0x10'],
    ['binary', '0b10000'],
    ['octal', '0o20'],
    ['exponent', '1.6e1'],
    ['spaced single digits', '1 6'],
    ['inside code', 'print(16)'],
    ['ordinal suffix', 'the 16th'],
  ])('reads %s as 16', (_n, text) => {
    expect(has(text, '16')).toBe(true);
  });

  it.each([
    ['thousands comma', '24,000', '24000'],
    ['Indian grouping', '2,40,000', '240000'],
    ['k suffix', '24k', '24000'],
    ['lakh with a decimal', '2.4 lakh', '240000'],
    ['hazaar', '24 hazaar', '24000'],
    ['Devanagari scale', '२४ हज़ार', '24000'],
    ['crore', '3 crore', '30000000'],
    ['spaced long', '2 4 0 0 0', '24000'],
    ['a fraction stays a fraction', '16.5', '16.5'],
  ])('reads %s', (_n, text, value) => {
    expect(has(text, value)).toBe(true);
  });

  it('matches whole numbers only, never substrings', () => {
    for (const text of ['160', '2016', '1.6', '116', 'x16', 'v1.16', '16.5', '1,600']) {
      expect(has(text, '16'), text).toBe(false);
    }
  });

  it('does not read a unit word as a scale suffix', () => {
    expect(has('16 kg', '16')).toBe(true);
    expect(has('16 kg', '16000')).toBe(false);
    expect(has('a list 1,2,3', '123')).toBe(false);
  });
});

describe('numbersMentioned: words', () => {
  it.each([
    ['English', 'it is sixteen', '16'],
    ['English capitalised', 'Sixteen!', '16'],
    ['English compound', 'twenty-four', '24'],
    ['English with scale', 'two thousand sixteen', '2016'],
    ['English hundred and', 'one hundred and six', '106'],
    ['bare hundred', 'a hundred', '100'],
    ['Hindi Latin', 'x solah hai', '16'],
    ['Hindi Latin tens', 'pachaas', '50'],
    ['Hindi Latin scale', 'do sau', '200'],
    ['Hindi Latin compound', 'ek sau solah', '116'],
    ['Devanagari', 'उत्तर सोलह है', '16'],
    ['Devanagari above twenty', 'चौबीस', '24'],
    ['Devanagari hundred', 'सौ', '100'],
    ['Devanagari nukta variant', 'दो हज़ार', '2000'],
    ['Devanagari chandrabindu variant', 'पाँच', '5'],
    ['digits plus scale word', '16 hundred', '1600'],
  ])('%s', (_n, text, value) => {
    expect(has(text, value)).toBe(true);
  });

  it('splits words that do not combine into separate numbers', () => {
    expect([...numbersMentioned('one six')].sort()).toEqual(['1', '6']);
    expect([...numbersMentioned('four twenty')].sort()).toEqual(['20', '4']);
    expect(has('sixteen. hundred', '1600')).toBe(false);
    expect(has('sixteen, hundred', '1600')).toBe(false);
  });

  it('reads no number in ordinary words', () => {
    expect(numbersMentioned('Trace each line and tell me what x holds.').size).toBe(0);
  });
});

describe('numbersMentioned: arithmetic', () => {
  it.each([
    ['print(8*2)', '16'],
    ['f"{5+3}"', '8'],
    ['(2 + 6) * 2', '16'],
    ['2 ** 4', '16'],
    ['33 // 2', '16'],
    ['17 % 5', '2'],
    ['8 × 2', '16'],
    ['32 ÷ 2', '16'],
    ['-4 * -4', '16'],
    ['Line 1. 8*2', '16'],
  ])('%s', (text, value) => {
    expect(has(text, value)).toBe(true);
  });

  it('reads no expression in code with names or in comparisons', () => {
    expect(numberMentions('x = x * 2').filter((m) => m.kind === 'expr')).toEqual([]);
    expect(numberMentions('25 > 20').filter((m) => m.kind === 'expr')).toEqual([]);
  });
});

describe('evaluateArithmetic', () => {
  it('needs a binary operator and well-formed input', () => {
    expect(evaluateArithmetic('16')).toBeUndefined();
    expect(evaluateArithmetic('-16')).toBeUndefined();
    expect(evaluateArithmetic('8 *')).toBeUndefined();
    expect(evaluateArithmetic('(8 * 2')).toBeUndefined();
    expect(evaluateArithmetic('8 2 +')).toBeUndefined();
    expect(evaluateArithmetic('8 * x')).toBeUndefined();
    expect(evaluateArithmetic('(8) 2')).toBeUndefined();
    expect(evaluateArithmetic(')8(')).toBeUndefined();
    expect(evaluateArithmetic('8 + (')).toBeUndefined();
    expect(evaluateArithmetic('+8 - +2')).toBe(6);
    expect(evaluateArithmetic('2 ** 3 ** 2')).toBe(512);
    expect(evaluateArithmetic('10 - 4 - 3')).toBe(3);
    expect(evaluateArithmetic('-7 % 3')).toBe(2);
  });

  it('is bounded: division by zero, overflow, length, tokens and nesting all give undefined', () => {
    expect(evaluateArithmetic('1 / 0')).toBeUndefined();
    expect(evaluateArithmetic('10 ** 999')).toBeUndefined();
    expect(evaluateArithmetic('1+'.repeat(40) + '1')).toBeUndefined();
    expect(evaluateArithmetic('1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1')).toBeUndefined();
    expect(evaluateArithmetic('-'.repeat(12) + '1+1')).toBeUndefined();
    expect('1+'.repeat(40).length).toBeGreaterThan(MAX_EXPRESSION_LENGTH);
  });
});

describe('answer context', () => {
  const ctxOf = (text: string) =>
    numberMentions(text)
      .filter((m) => m.kind === 'word')
      .map((m) => m.answerContext);

  it('is true near an answer word, in any of the three scripts, or when the number stands alone', () => {
    expect(ctxOf('the answer is three')).toEqual([true]);
    expect(ctxOf('x = three')).toEqual([true]);
    expect(ctxOf('three is what it prints')).toEqual([true]);
    expect(ctxOf('jawab teen hai')).toEqual([true]);
    expect(ctxOf('उत्तर तीन है')).toEqual([true]);
    expect(ctxOf('Three.')).toEqual([true]);
  });

  it('is false in ordinary lesson text', () => {
    expect(ctxOf('Take one step at a time and look at the code.')).toEqual([false]);
    expect(ctxOf('Is it right? Now try three more examples on your own.')).toEqual([false]);
    expect(ctxOf('Ek baar code ko line by line padho.')).toEqual([false]);
  });
});

describe('numericKeyValue', () => {
  it.each([
    ['16', '16'],
    [' 16. ', '16'],
    ['`16`', '16'],
    ['१६', '16'],
    ['16.0', '16'],
    ['24,000', '24000'],
    ['sixteen', '16'],
    ['two thousand and sixteen', '2016'],
    ['solah', '16'],
  ])('%s is the number %s', (key, value) => {
    expect(numericKeyValue(key)).toBe(value);
  });

  it.each(['Warm', 'n >= 1 and n <= 10', '16 apples', 'x = 16', 'one six', '', '   ', 'and'])(
    '%s is not a number key',
    (key) => {
      expect(numericKeyValue(key)).toBeUndefined();
    },
  );
});

describe('helpers', () => {
  it('canonicalNumber', () => {
    expect(canonicalNumber(-16)).toBe('16');
    expect(canonicalNumber(0.1 + 0.2)).toBe('0.3');
    expect(canonicalNumber(1e16)).toBeUndefined();
    expect(canonicalNumber(Number.NaN)).toBeUndefined();
  });

  it('number words and suffixes', () => {
    expect(numberWord('constructor')).toBeUndefined();
    expect(numberWord('lakh')).toEqual({ kind: 'scale', value: 100_000 });
    expect(scaleSuffix('k')).toBe(1_000);
    expect(scaleSuffix('toString')).toBeUndefined();
  });
});

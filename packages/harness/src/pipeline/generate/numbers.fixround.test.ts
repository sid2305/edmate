// Task 4.5 fix round 1: Hindi-Latin 21-99, count and confirmation words, decimals and fractions,
// space-grouped thousands. Keys are synthetic.
import { describe, expect, it } from 'vitest';
import { compileAnswerKeys } from './answerKey.js';
import { AMBIGUOUS_LATIN_FOLDS, latinFold, numberWord } from './numberWords.js';
import { numbersMentioned, numericKey } from './numbers.js';

const leaks = (key: string, text: string) => compileAnswerKeys([key]).leaks(text);

describe('Hindi in Latin letters, 21-99', () => {
  it.each([
    ['Jawab chaubees hai', '24'],
    ['jawab chaubis hai', '24'],
    ['chobis', '24'],
    ['pachchees', '25'],
    ['pachees', '25'],
    ['pachpan', '55'],
    ['ninyaanave', '99'],
    ['ikkis', '21'],
    ['chaubees hazaar', '24000'],
    ['do lakh chaubees hazaar', '224000'],
  ])('%s names %s', (text, value) => {
    expect(numbersMentioned(text).has(value)).toBe(true);
  });

  it('a key and its Hinglish words', () => {
    expect(leaks('24', 'Jawab chaubees hai')).toBe(true);
    expect(leaks('24000', 'chaubees hazaar')).toBe(true);
  });

  it('folding is only for long words and never guesses between two values', () => {
    expect(latinFold('chaubees')).toBe(latinFold('chobis'));
    expect(numberWord('no')).toBeUndefined();
    expect(numberWord('these')).toBeUndefined();
    for (const f of AMBIGUOUS_LATIN_FOLDS) expect(numberWord(f)).toBeUndefined();
  });
});

describe('one-digit keys: count and confirmation words (fix round 1)', () => {
  it.each(['It runs three times.', "It's three.", 'Loop teen baar chalega.', 'तीन बार चलेगा।'])(
    '%s trips key 3',
    (text) => {
      expect(leaks('3', text)).toBe(true);
    },
  );
});

describe('one-digit keys: a weak marker at the very start or end of the text (4.5c)', () => {
  it('a weak marker as the first word still checks its own right-hand neighbour', () => {
    expect(leaks('3', 'Baar chalega teen.')).toBe(true);
  });

  it('a weak marker as the last word still checks its own left-hand neighbour', () => {
    expect(leaks('3', 'Teen baar.')).toBe(false);
  });

  it('a run verb across a sentence break is not "next to" the weak marker', () => {
    expect(leaks('3', 'Loop teen baar. Chalega.')).toBe(false);
  });
});

describe('Hindi in Latin letters, spellings latinFold would fold to a different value (4.5c)', () => {
  it.each([
    ['Jawab baiyaalis hai', '42'],
    ['jawab byalis hai', '42'],
    ['jawab beyalis hai', '42'],
    ['unatees students in class', '29'],
  ])('%s names %s', (text, value) => {
    expect(numbersMentioned(text).has(value)).toBe(true);
  });
});

describe('spoken fractions, percentages and digit-by-digit decimals (4.5c)', () => {
  it('a spoken fraction names the fraction key', () => {
    expect(leaks('5/6', 'It is five sixths')).toBe(true);
    expect(leaks('5/6', 'It is 5 out of 6')).toBe(true);
  });

  it('a spoken fraction names the equivalent decimal key', () => {
    expect(leaks('0.83', 'It is five sixths')).toBe(true);
    expect(leaks('0.83', 'It is 5 out of 6')).toBe(true);
  });

  it('a percentage names the decimal key at its own precision', () => {
    expect(leaks('0.83', 'It is 83%')).toBe(true);
    expect(leaks('0.835', 'It is 83.5%')).toBe(true);
    expect(leaks('0.83', 'It is 82%')).toBe(false);
  });

  it('a decimal read digit by digit names the decimal key', () => {
    expect(leaks('0.83', 'It is zero point eight three')).toBe(true);
    expect(leaks('0.83', 'It is zero point eight two')).toBe(false);
  });

  it('ordinary lesson text with "out of" or "point" but no number is never a mention', () => {
    expect(numbersMentioned('Read the point I made out of context.').size).toBe(0);
    expect(numbersMentioned('We made it out of clay.').size).toBe(0);
  });

  it('"point" after a non-number word is never a spoken decimal', () => {
    expect(numbersMentioned('the point eight three').has('0.83')).toBe(false);
  });

  it('a spoken decimal reads only the digit words right after "point"', () => {
    expect(numbersMentioned('zero point eight teen').has('0.8')).toBe(true);
  });
});

describe('decimals, fractions and grouped thousands (fix round 1)', () => {
  it('a decimal key matches at its precision, with or without a leading zero', () => {
    expect(leaks('0.83', 'It is .83')).toBe(true);
    expect(leaks('0.83', 'roughly 0.833')).toBe(true);
    expect(leaks('0.83', 'about 0.8')).toBe(false);
    expect(leaks('0.83', 'we have 83 apples')).toBe(false);
  });

  it('a fraction key is its value', () => {
    expect(numericKey('5/6')).toMatchObject({ decimals: -1 });
    expect(leaks('5/6', 'It is 0.83')).toBe(true);
    expect(leaks('5/6', 'print(5/6)')).toBe(true);
    expect(leaks('5/6', 'It is 0.8')).toBe(false);
    expect(leaks('6/3', 'It is 2')).toBe(true);
  });

  it('thousands grouped with a space, no-break space or narrow no-break space', () => {
    for (const sep of [' ', '\u00A0', '\u202F']) {
      expect(leaks('24000', `It is 24${sep}000.`), JSON.stringify(sep)).toBe(true);
    }
  });
});

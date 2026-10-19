// Task 4.5: the forms the shared answer-key matcher catches, its word boundaries, the short-key
// policy, the student-quote rule and the tail it holds back. Keys here are synthetic.
import { describe, expect, it } from 'vitest';
import { compileAnswerKeys, normaliseForMatch, revealsAnswerKey } from './answerKey.js';

const leaks = (keys: string[], text: string, studentText?: string) =>
  compileAnswerKeys(keys, studentText === undefined ? {} : { studentText }).leaks(text);

describe('compileAnswerKeys: number keys', () => {
  it.each([
    ['digits', 'x is 16'],
    ['Devanagari digits', 'x १६ है'],
    ['zero-width split', 'x is 1\u200B6'],
    ['words', 'x is sixteen'],
    ['Hindi in Latin letters', 'x solah hai'],
    ['Devanagari words', 'x सोलह है'],
    ['decimal', '16.0'],
    ['hex', 'try 0x10'],
    ['arithmetic', 'print(8*2)'],
    ['base64', 'MTY='],
    ['base64 of a sentence', 'VGhlIGZpbmFsIHZhbHVlIGlzIDE2'],
  ])('catches 16 as %s', (_n, text) => {
    expect(leaks(['16'], text)).toBe(true);
  });

  it('a number-word key is a number key', () => {
    expect(leaks(['sixteen'], 'it is 16')).toBe(true);
  });

  it('never matches a number inside another number', () => {
    for (const text of ['160 lines', 'in 2016', 'about 1.6', 'line 116']) {
      expect(leaks(['16'], text), text).toBe(false);
    }
  });

  it('a one-digit key: digits count anywhere, words and arithmetic only as an answer', () => {
    expect(leaks(['3'], 'Look at line 3.')).toBe(true);
    expect(leaks(['3'], 'Try three more examples on your own.')).toBe(false);
    expect(leaks(['3'], 'The answer is three.')).toBe(true);
    expect(leaks(['3'], 'jawab teen hai')).toBe(true);
    expect(leaks(['3'], 'Three.')).toBe(true);
    expect(leaks(['3'], 'What does 1 + 2 give you?')).toBe(false);
    expect(leaks(['3'], 'Think about 1 + 2 and 4 + 5 together')).toBe(false);
    expect(leaks(['3'], 'so x = 1 + 2')).toBe(true);
    expect(leaks(['1'], 'Take one step at a time.')).toBe(false);
  });

  it('a number the student wrote is still never repeated', () => {
    expect(leaks(['16'], 'Yes, 16.', 'is it 16?')).toBe(true);
  });
});

describe('compileAnswerKeys: text keys', () => {
  it.each([
    ['plain', 'It prints Warm.'],
    ['upper case', 'WARM'],
    ['zero-width inside', 'W\u200Barm'],
    ['soft hyphen inside', 'Wa\u00ADrm'],
    ['fullwidth letters', 'Ｗａｒｍ'],
    ['base64', 'V2FybQ=='],
    ['base64 unpadded', 'V2FybQ'],
    ['quoted', '"Warm"'],
  ])('catches Warm as %s', (_n, text) => {
    expect(leaks(['Warm'], text)).toBe(true);
  });

  it('matches at word boundaries only', () => {
    expect(leaks(['Warm'], 'warmer weather')).toBe(false);
    expect(leaks(['Warm'], 'lukewarm')).toBe(false);
    expect(leaks(['if marks >= 80:'], 'Look at elif marks >= 80: in your code')).toBe(false);
    expect(leaks(['if marks >= 80:'], 'Write if marks>=80: first')).toBe(true);
  });

  it('matches code across spacing, newlines, quote styles and JSON escaping', () => {
    const key = 'print(f"Total: {total}")';
    expect(leaks([key], "print(f'Total: {total}')")).toBe(true);
    expect(leaks([key], JSON.stringify({ mustNotReveal: [key] }))).toBe(true);
    expect(leaks(['n % 2 == 0'], 'if n %\n  2 ==\n0:')).toBe(true);
    expect(leaks(['n % 2 == 0'], 'if n % 3 == 0:')).toBe(false);
  });

  it('lets the student’s own code be quoted back, but not plain words', () => {
    const student = 'if marks >= 50 print Pass, elif marks >= 80 print Distinction';
    expect(leaks(['marks >= 80'], 'You wrote marks >= 80 second.', student)).toBe(false);
    expect(leaks(['marks >= 80'], 'You wrote marks >= 80 second.')).toBe(true);
    expect(leaks(['if marks >= 80:'], 'if marks >= 80:', student)).toBe(true);
    expect(leaks(['Warm'], 'It prints Warm', 'elif temp > 20 print Warm')).toBe(true);
    expect(leaks(['marks >= 80'], 'marks >= 80', '')).toBe(true);
  });

  it('only code the student wrote as code: a code line, a ``` fence, or after elif/while/return', () => {
    const quote = 'Your line calls .lower() on the answer first.';
    const fence = 'my code:\n```\nif answer.lower() == "yes":\n```';
    expect(leaks(['.lower()'], 'Your code calls .lower() there.', fence)).toBe(false);
    expect(leaks(['n % 2 == 0'], 'n % 2 == 0', '  if n % 2 == 0')).toBe(false); // indented
    expect(leaks(['n % 2 == 0'], 'n % 2 == 0', 'x = n % 2 == 0')).toBe(false); // assignment
    expect(leaks(['n % 2 == 0'], 'n % 2 == 0', 'check n % 2 == 0:')).toBe(false); // colon end
    expect(leaks(['marks >= 80'], 'marks >= 80', 'Pass first, elif marks >= 80 next')).toBe(false);
    // Not code: prose, a proposal, or no boundary.
    expect(leaks(['.lower()'], quote, 'is .lower() the fix?')).toBe(true);
    expect(leaks(['n % 2 == 0'], 'n % 2 == 0', 'n % 2 == 0 is it?')).toBe(true);
    expect(leaks(['n % 2 == 0'], 'n % 2 == 0', 'nn % 2 == 0')).toBe(true);
    expect(leaks(['n % 2 == 0'], 'n % 2 == 0', 'my code: if n % 2 == 0 print')).toBe(true);
  });

  it('offering options never makes the answer the student’s own code (fix round probes)', () => {
    const reply = 'It is .lower().';
    expect(leaks(['.lower()'], reply, 'Is it .upper() or .lower()? Just say which one.')).toBe(
      true,
    );
    expect(leaks(['.lower()'], reply, 'is it `.upper()` or `.lower()`?')).toBe(true);
    expect(leaks(['n % 2 == 0'], 'n % 2 == 0', 'n % 2 == 1 or n % 2 == 0?')).toBe(true);
    expect(leaks(['n % 2 == 0'], 'n % 2 == 0', 'is it not n % 2 == 0')).toBe(true);
    // An apostrophe inside a word does not make a key code-shaped.
    expect(leaks(["it's False"], "it's False", "x = it's False")).toBe(true);
  });

  it('a quote of the student’s code in an answer or confirmation context is a leak', () => {
    const own = 'if answer.lower() == "yes":';
    expect(leaks(['.lower()'], 'Your line calls .lower() on the input.', own)).toBe(false);
    expect(leaks(['.lower()'], 'Yes, .lower() is the fix.', own)).toBe(true);
    expect(leaks(['.lower()'], 'Just use .lower() there.', own)).toBe(true);
    expect(leaks(['.lower()'], 'Haan, .lower() sahi hai.', own)).toBe(true);
    expect(leaks(['.lower()'], 'Yes. Your line calls .lower() too.', own)).toBe(false);
    // Encoded, it is never a quote.
    expect(leaks(['.lower()'], 'Lmxvd2VyKCk=', own)).toBe(true);
    // A confirmation in the student's own line is not their code either.
    expect(leaks(['.lower()'], 'You call .lower() there.', 'x = s.lower() is right?')).toBe(true);
  });

  it('ignores empty and non-string keys and empty text', () => {
    const m = compileAnswerKeys(['', ' ', '\u200B', 16 as unknown as string]);
    expect(m.empty).toBe(true);
    expect(m.leaks('16')).toBe(false);
    expect(m.tailStart('16')).toBe(-1);
    expect(compileAnswerKeys(['16']).leaks('')).toBe(false);
    expect(compileAnswerKeys(['16']).tailStart('')).toBe(-1);
  });
});

describe('compileAnswerKeys: tailStart', () => {
  it('points at a tail that could grow into a text key', () => {
    const m = compileAnswerKeys(['n % 2 == 0']);
    expect(m.tailStart('First, if n % 2')).toBe('First, if '.length);
    expect(m.tailStart('First, if n % 3')).toBe(-1);
    // The whole key is a leak, not a tail.
    expect(m.tailStart('nothing here')).toBe(-1);
  });

  it('needs a word boundary before the tail', () => {
    expect(compileAnswerKeys(['Warm']).tailStart('Then a swa')).toBe(-1);
    expect(compileAnswerKeys(['Warm']).tailStart('It prints wa')).toBe('It prints '.length);
  });

  it('holds a number at the very end for number keys', () => {
    const m = compileAnswerKeys(['16']);
    expect(m.tailStart('x is 1')).toBe(5);
    expect(m.tailStart('x is 1 ')).toBe(5);
    expect(m.tailStart('x is 1. ')).toBe(5);
    expect(m.tailStart('x is one.')).toBe(-1);
  });

  it('takes the earliest tail over all keys', () => {
    const m = compileAnswerKeys(['abc', 'bcd', '16']);
    expect(m.tailStart('x ab')).toBe(2);
    expect(m.tailStart('9 bc')).toBe(2);
    expect(m.tailStart('x 1 ab')).toBe(4);
  });
});

describe('revealsAnswerKey (shared by skill payloads, tool outputs and sources)', () => {
  it('uses the full matcher on every leaf and on the JSON', () => {
    expect(revealsAnswerKey({ hint: 'MTY=' }, ['16'])).toBe(true);
    expect(revealsAnswerKey({ hint: 'solah' }, ['16'])).toBe(true);
    expect(revealsAnswerKey({ n: 160 }, ['16'])).toBe(false);
    expect(revealsAnswerKey({ code: 'print(f\\"x\\")' }, ['print(f"x")'])).toBe(true);
    expect(revealsAnswerKey({ a: 'safe' }, [])).toBe(false);
  });

  it('normaliseForMatch folds digits in every script and drops backslashes', () => {
    expect(normaliseForMatch('१६')).toBe('16');
    expect(normaliseForMatch('a\\"b')).toBe('a"b');
    expect(normaliseForMatch('‘x’')).toBe('"x"');
  });
});

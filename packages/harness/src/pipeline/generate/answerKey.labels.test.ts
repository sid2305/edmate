// Task 5.6b, design 1 and 4: label keys (one letter, optionally bracketed) leak unless they sit
// in an exempt shape, with no item context; practice keys never get the own-code exemption; and
// look-alike letters fold to their label. Keys here are synthetic.
import { describe, expect, it } from 'vitest';
import { compileAnswerKeys, revealsAnswerKey } from './answerKey.js';
import { labelOf } from './labelKeys.js';

const leaks = (key: string, text: string) => compileAnswerKeys([key]).leaks(text);

describe('labelOf', () => {
  it.each([
    ['B', 'B'],
    ['b', 'B'],
    ['(B)', 'B'],
    ['B)', 'B'],
    [' c ', 'C'],
  ])('%j is the label %s', (key, label) => {
    expect(labelOf(key)).toBe(label);
  });

  it.each(['7', 'BB', 'B.', '(B', 'opt-2', '', 'é'])('%j is not a label key', (key) => {
    expect(labelOf(key)).toBeUndefined();
  });
});

describe('label keys, no item context: a mention leaks by default', () => {
  it.each([
    'The answer is B.',
    'Answer: B',
    "It's B.",
    'B is correct.',
    'The correct option is (B).',
    'Go with B.',
    'B',
    'b.',
    'Definitely B.',
    'Try B.',
    "I'd lean towards B",
    'Hint: B',
    'B, for sure',
    'Is it B?',
    'B, right?',
    'The answer is A or B',
    'B, B, B!',
    'A ✗ B ✓ C ✗',
    'A, **B**, C',
    'A, __B__, C',
    'A, B ✓, C',
    'Option B says 7.',
    'the answer is b because 7 is prime',
    // No item context: the override words apply to a full list too (lead answer 1).
    'Is it A, B or C?',
    'Which is correct: A, B or C?',
  ])('key B: %j leaks', (text) => {
    expect(leaks('B', text)).toBe(true);
  });

  it.each([
    'the answer is a because it loops',
    "it's a since it loops",
    "it's a — yes",
    'the answer is a or b',
    'A',
    'The answer is a.',
  ])('key A: %j leaks (the article rule does not apply)', (text) => {
    expect(leaks('A', text)).toBe(true);
  });

  it.each(['A, B or C', 'A/B/C', 'a, b, or c', 'A and B', 'Options: A, B, C, D.'])(
    'key B: the separator-only list %j does not leak',
    (text) => {
      expect(leaks('B', text)).toBe(false);
    },
  );

  it.each([
    'the answer is a fraction',
    'Take a look at the loop.',
    'This is a fraction, a big one.',
    'There is no letter here.',
  ])('key A: %j does not leak (article or no mention)', (text) => {
    expect(leaks('A', text)).toBe(false);
  });

  it('a letter inside a word is never a mention', () => {
    expect(leaks('B', 'Bob bought a bobcat.')).toBe(false);
    expect(leaks('B', 'see b2 and xb')).toBe(false);
  });

  it('"I think so" does not leak a key that is not "i"', () => {
    expect(leaks('B', 'I think so')).toBe(false);
  });

  it('a list of letters that are not labels (A-F) is no exempt list', () => {
    expect(leaks('X', 'x, y or z')).toBe(true);
  });

  it('a label key and ordinary keys are checked together', () => {
    const m = compileAnswerKeys(['B', '16']);
    expect(m.empty).toBe(false);
    expect(m.leaks('It is 16.')).toBe(true);
    expect(m.leaks('A, B or C')).toBe(false);
    expect(m.leaks('It is B.')).toBe(true);
  });
});

describe('look-alike labels', () => {
  it.each([
    ['Cyrillic', 'The answer is В.'],
    ['Greek', 'The answer is Β.'],
    ['negative circled', 'The answer is \u{1F151}.'],
    ['negative squared', 'The answer is \u{1F171}.'],
    ['regional indicator', 'The answer is \u{1F1E7}.'],
    ['fullwidth', 'The answer is Ｂ.'],
    ['circled', 'The answer is Ⓑ.'],
    ['mathematical bold', 'The answer is \u{1D401}.'],
    ['zero-width split', 'The answer is ​B​.'],
  ])('%s B leaks', (_name, text) => {
    expect(leaks('B', text)).toBe(true);
  });

  it('a look-alike list of labels is still a list', () => {
    expect(leaks('B', 'A, В or C')).toBe(false);
  });
});

describe('label keys inside base64', () => {
  it('a decoded label counts in an answer context or standing alone', () => {
    // "The answer is B." and "B".
    expect(leaks('B', 'VGhlIGFuc3dlciBpcyBCLg==')).toBe(true);
    expect(leaks('B', 'Here: Qg==')).toBe(true);
  });
});

describe('practice keys never get the own-code exemption (design 4)', () => {
  const student = 'my code:\n```\nprint("Hello, World!")\n```';
  const reply = 'It prints Hello, World!';

  it('without practiceKeys, the student own code may be quoted back (today)', () => {
    expect(compileAnswerKeys(['Hello, World!'], { studentText: student }).leaks(reply)).toBe(false);
  });

  it('a practice key is guarded even when the student wrote it as code', () => {
    const m = compileAnswerKeys(['Hello, World!'], {
      studentText: student,
      practiceKeys: ['Hello, World!'],
    });
    expect(m.leaks(reply)).toBe(true);
  });

  it('an item key is guarded even when the student wrote it as code', () => {
    const m = compileAnswerKeys(['Hello, World!'], {
      studentText: student,
      items: [{ prompt: 'What does print("Hi") print?', answerKey: ['Hello, World!'] }],
    });
    expect(m.leaks(reply)).toBe(true);
  });
});

describe('revealsAnswerKey with a label key', () => {
  it('reads a plain string once (its JSON form adds only escapes)', () => {
    expect(revealsAnswerKey('A) 6\nB) 7\nC) 8', ['B'])).toBe(true);
    expect(revealsAnswerKey('Options: A, B or C', ['B'])).toBe(false);
    expect(revealsAnswerKey(['B) 7'], ['B'])).toBe(true);
  });
});

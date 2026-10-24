// Task 5.6b, designs 2 and 3: the active item's exempt spans (its prompt and its exact option
// listing), the keys derived from the item (the correct option's text, its position, ruling the
// other options out), and `reach`. Items and keys here are synthetic.
import { describe, expect, it } from 'vitest';
import { compileAnswerKeys, revealsAnswerKey } from './answerKey.js';
import { type ItemContext, issueCheckContext, itemContextOf } from './itemContext.js';

const MCQ: ItemContext = {
  prompt: 'What is 3 + 4?',
  options: ['A) 6', 'B) 7', 'C) 8'],
  answerKey: ['B'],
};
const LISTING = 'A) 6\nB) 7\nC) 8';
/** Key A, its correct option listed first. */
const MCQ_A: ItemContext = {
  prompt: 'What is 2 + 5?',
  options: ['A) 7', 'B) 6', 'C) 8'],
  answerKey: ['A'],
};
const SUM: ItemContext = { prompt: 'What is 3 + 4?', answerKey: ['7'] };
const CODE: ItemContext = {
  prompt: 'What does this code print?\nprint(4)\n# it runs once',
  answerKey: ['4'],
};

const mcqLeaks = (text: string) =>
  compileAnswerKeys(['B'], { items: [MCQ], practiceKeys: ['B'] }).leaks(text);

describe('leak table (key B; item "What is 3 + 4?", options A) 6, B) 7, C) 8)', () => {
  it.each([
    // Answer forms
    'The answer is B.',
    'Answer: B',
    "It's B.",
    'B is correct.',
    'The correct option is (B).',
    'Go with B.',
    'B',
    'b.',
    // Answer words, any position
    'Definitely B.',
    'Try B.',
    "I'd lean towards B",
    'Hint: B',
    'B, for sure',
    'Is it B?',
    'B, right?',
    'The answer is A or B',
    // Gamed lists
    'B, B, B!',
    'A ✗ B ✓ C ✗',
    'A, **B**, C',
    'B) 7 A) 6 C) 8',
    'B) 7\nA) 6\nC) 8',
    'A) 6 B) 7',
    'A) 6\nB) 7',
    // The correct option shown alone
    'The answer is B) 7.',
    '✅ B) 7',
    '**B) 7**',
    'B) 7 (correct)',
    'B) 7 ←',
    'Option B says 7.',
    // Lowercase after an answer word
    'the answer is b because 7 is prime',
    // Look-alikes
    'The answer is В.',
    'The answer is Β.',
    'The answer is \u{1F171}.',
    'The answer is \u{1F151}.',
    'The answer is \u{1F1E7}.',
    // Position
    "It's the second option.",
    'Go with option 2.',
    'The 2nd one.',
    'Number two!',
    // Option text
    'The answer is 7.',
    '7 works.',
    'Plug in 7.',
    // Ruling out (over the whole reply, lead answer 4)
    "It's not A or C.",
    'A and C are wrong.',
    'Not 6 or 8.',
    'A is wrong. C is wrong.',
    // A restated item plus its answer
    "What is 3 + 4? It's 7.",
    `${LISTING}\nB.`,
    'A) 6\nB) 7 ← this one\nC) 8',
    `${LISTING} ←`,
    `**${LISTING}**`,
    `What is 3 + 4?\n${LISTING}\nThe answer is B.`,
    // A look-alike padding before the listing (lead answer 2)
    `\u{1F171}\n${LISTING}\nB.`,
    `\u{1F171}${LISTING}`,
    // Base64: "The answer is B." and "B"
    'VGhlIGFuc3dlciBpcyBCLg==',
    'Qg==',
  ])('%j leaks', (text) => {
    expect(mcqLeaks(text)).toBe(true);
  });

  it('key A, its option first: lowercase "a" after an answer word leaks', () => {
    const m = compileAnswerKeys(['A'], { items: [MCQ_A] });
    expect(m.leaks('the answer is a because it adds up')).toBe(true);
    expect(m.leaks("it's a since it adds up")).toBe(true);
    expect(m.leaks("it's a — yes")).toBe(true);
    expect(m.leaks('the answer is a or b')).toBe(true);
  });

  it('an x = 7 style option text leaks wherever it appears', () => {
    const item: ItemContext = {
      prompt: 'Which value solves 2x - 3 = 11?',
      options: ['A) x = 6', 'B) x = 7', 'C) x = 8'],
      answerKey: ['B'],
    };
    expect(compileAnswerKeys(['B'], { items: [item] }).leaks('x = 7 makes both sides 11')).toBe(
      true,
    );
  });

  it('a prompt ending "x = 5" never swallows part of the key "57"', () => {
    const item: ItemContext = { prompt: 'If x = 5', answerKey: ['57'] };
    expect(compileAnswerKeys(['57'], { items: [item] }).leaks('If x = 57')).toBe(true);
    expect(compileAnswerKeys(['57'], { items: [item] }).leaks('If x = 5')).toBe(false);
  });

  it('code_output: the key outside the prompt leaks', () => {
    const m = compileAnswerKeys(['4'], { items: [CODE], practiceKeys: ['4'] });
    expect(m.leaks('It prints 4.')).toBe(true);
    expect(m.leaks(`${CODE.prompt}\nIt prints 4.`)).toBe(true);
    const list: ItemContext = { prompt: 'What does print([1, 2, 3]) show?', answerKey: ['[1, 2, 3]'] };
    expect(
      compileAnswerKeys(['[1, 2, 3]'], { items: [list], practiceKeys: ['[1, 2, 3]'] }).leaks(
        'The output is [1, 2, 3]',
      ),
    ).toBe(true);
  });

  it('a held key from another item is not exempt inside this item’s prompt', () => {
    // "2 + 3" shows 5; 5 is not this item's key.
    const item: ItemContext = { prompt: 'What is 2 + 3?', answerKey: ['5'] };
    expect(compileAnswerKeys(['9', '5'], { items: [item] }).leaks('What is 2 + 3?')).toBe(false);
    expect(
      compileAnswerKeys(['5'], { items: [{ prompt: 'What is 2 + 3?', answerKey: ['4'] }] }).leaks(
        'What is 2 + 3?',
      ),
    ).toBe(true);
  });

  it('an item key is guarded even when it is not in mustNotReveal', () => {
    expect(compileAnswerKeys([], { items: [MCQ] }).leaks('The answer is B.')).toBe(true);
    expect(compileAnswerKeys([], { items: [MCQ] }).empty).toBe(false);
  });
});

describe('not-a-leak table', () => {
  it.each([
    LISTING,
    `What is 3 + 4?\n${LISTING}`,
    `What is 3 + 4?\n\n  ${LISTING.replace(/\n/g, '\n  ')}`,
    `Here it is again:\nWhat is 3 + 4?\n${LISTING}\nTake your time.`,
    'Which is correct: A, B or C?',
    'Is it A, B or C?',
    'A, B or C',
    'A/B/C',
    'I think so',
    'What is 3 + 4?',
    // The base64 of the prompt alone.
    'V2hhdCBpcyAzICsgND8=',
  ])('key B: %j is delivered', (text) => {
    expect(mcqLeaks(text)).toBe(false);
  });

  it('key A listed first ("A) 7" on the first line) is delivered', () => {
    const m = compileAnswerKeys(['A'], { items: [MCQ_A], practiceKeys: ['A'] });
    expect(m.leaks('A) 7\nB) 6\nC) 8')).toBe(false);
    expect(m.leaks('What is 2 + 5?\nA) 7\nB) 6\nC) 8')).toBe(false);
    expect(m.leaks('the answer is a fraction')).toBe(false);
  });

  it('a generated sum restated is delivered; with its answer it leaks', () => {
    const m = compileAnswerKeys(['7'], { items: [SUM], practiceKeys: ['7'] });
    expect(m.leaks('What is 3 + 4?')).toBe(false);
    expect(m.leaks('Try this one: What is 3 + 4?')).toBe(false);
    expect(m.leaks("What is 3 + 4? It's 7.")).toBe(true);
    // "What is 3 + 4? It's 7." in base64.
    expect(m.leaks('V2hhdCBpcyAzICsgND8gSXQncyA3Lg==')).toBe(true);
    expect(m.leaks('V2hhdCBpcyAzICsgND8=')).toBe(false);
  });

  it('a 3-line code_output prompt holding its output on line 2 is delivered', () => {
    const m = compileAnswerKeys(['4'], { items: [CODE], practiceKeys: ['4'] });
    expect(m.leaks(CODE.prompt)).toBe(false);
    expect(m.leaks(`Look again:\n${CODE.prompt}`)).toBe(false);
  });

  it('an MCQ issued after an MCQ with the same key is served; one that says the key is not', () => {
    const next: ItemContext = {
      prompt: 'What is 4 + 5?',
      options: ['A) 8', 'B) 9', 'C) 10'],
      answerKey: ['B'],
    };
    const joined = [next.prompt, ...(next.options ?? [])].join('\n');
    expect(revealsAnswerKey(joined, ['B'], { items: [next] })).toBe(false);
    expect(revealsAnswerKey(`${joined}\nThe answer is B.`, ['B'], { items: [next] })).toBe(true);
  });
});

describe('itemContextOf and issueCheckContext', () => {
  const issued = {
    itemId: 'i',
    moduleId: 'm',
    answerKey: ['B'],
    shown: ['What is 3 + 4?', 'A) 6', 'B) 7', 'C) 8'],
  };

  it('builds the item from its shown text and key', () => {
    expect(itemContextOf(issued)).toEqual(MCQ);
    expect(itemContextOf({ ...issued, answerKey: ['7'], shown: ['What is 3 + 4?'] })).toEqual(SUM);
    expect(itemContextOf({ ...issued, shown: [] })).toEqual({ prompt: '', answerKey: ['B'] });
  });

  it('the issue-time context has the listing only: no prompt span, no key', () => {
    expect(issueCheckContext(issued)).toEqual({ ...MCQ, prompt: '', answerKey: [] });
    const joined = issued.shown.join('\n');
    const ctx = { items: [issueCheckContext(issued)] };
    expect(revealsAnswerKey(joined, ['B'], ctx)).toBe(false);
    const said = { ...issued, shown: ['What is 3 + 4? Last time it was B.', 'A) 6', 'B) 7', 'C) 8'] };
    expect(revealsAnswerKey(said.shown.join('\n'), ['B'], { items: [issueCheckContext(said)] })).toBe(
      true,
    );
  });

  it('an issue-time check never exempts an earlier key that this item happens to share', () => {
    // A held "7" from an earlier item: the new item's prompt shows 3 + 4.
    const joined = 'What is 3 + 4?';
    const item = issueCheckContext({ ...issued, answerKey: ['7'], shown: [joined] });
    expect(revealsAnswerKey(joined, ['7'], { items: [item] })).toBe(true);
  });
});

describe('span edges', () => {
  it('a reordered or partial listing gets no span', () => {
    expect(mcqLeaks('C) 8\nB) 7\nA) 6')).toBe(true);
    expect(mcqLeaks('B) 7\nC) 8')).toBe(true);
  });

  it('a listing separated by commas is not the exact listing', () => {
    expect(mcqLeaks('A) 6, B) 7, C) 8')).toBe(true);
  });

  it('a listing whose case differs is still the listing (folded)', () => {
    expect(mcqLeaks('a) 6\nb) 7\nc) 8')).toBe(false);
  });

  it('an item without options has no listing span', () => {
    const m = compileAnswerKeys(['B'], { items: [{ prompt: 'Pick a letter.', answerKey: ['B'] }] });
    expect(m.leaks('A) 6\nB) 7')).toBe(true);
  });

  it('an empty prompt has no prompt span', () => {
    const m = compileAnswerKeys(['7'], { items: [{ prompt: '', answerKey: ['7'] }] });
    expect(m.leaks('It is 7.')).toBe(true);
  });

  it('two items: each one’s spans exempt its own key', () => {
    const hello: ItemContext = { prompt: 'What does print("Hello") show?', answerKey: ['Hello'] };
    const m = compileAnswerKeys(['7', 'Hello'], { items: [SUM, hello] });
    expect(m.leaks(`What is 3 + 4?\n${hello.prompt}`)).toBe(false);
    expect(m.leaks(`What is 3 + 4?\n${hello.prompt}\nIt's 7.`)).toBe(true);
    expect(m.leaks(`What is 3 + 4?\n${hello.prompt}\nIt shows Hello.`)).toBe(true);
    // One item's span never exempts the other item's key: SUM's prompt shows CODE's "4".
    expect(compileAnswerKeys(['4'], { items: [SUM, CODE] }).leaks('What is 3 + 4?')).toBe(true);
  });

  it('a key out of range or a non-label key derives nothing from the options', () => {
    const odd: ItemContext = { prompt: 'Pick one.', options: ['A) 6', 'B) 7'], answerKey: ['D'] };
    const m = compileAnswerKeys([], { items: [odd] });
    expect(m.leaks('It is 7.')).toBe(false);
    expect(m.leaks('It is D.')).toBe(true);
  });
});

describe('reach', () => {
  it('covers the longest span of a capped item', () => {
    const item: ItemContext = {
      prompt: 'p'.repeat(600),
      options: ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => `${l}) ${'o'.repeat(157)}`),
      answerKey: ['B'],
    };
    const m = compileAnswerKeys(['B'], { items: [item] });
    expect(m.reach).toBeGreaterThanOrEqual(600 + 6 * 161);
    expect(compileAnswerKeys(['B']).reach).toBeLessThan(600);
  });
});

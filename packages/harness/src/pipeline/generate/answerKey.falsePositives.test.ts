// Task 4.5, lead revision 6: ordinary lesson text must pass the answer-leak checks (both the
// stream gate and the final check use this matcher). Each row is a key and a hint a tutor would
// plausibly send for that question without giving the answer. The `STRICT` rows are known trips,
// kept here so a change to them is a decision, not an accident.
import { describe, expect, it } from 'vitest';
import { ANSWER_LEAK_SAFE_HINT } from '../../guardrails/answerLeak.js';
import { compileAnswerKeys } from './answerKey.js';
import { sentenceGate } from './streamGate.js';

const CLEAN: readonly [string, string, string][] = [
  ['number key', '16', 'x starts at 5, then becomes 8. What happens on the third line?'],
  ['number key', '16', 'Numbers like 1.6, 160 or 2016 are not what we want here.'],
  ['number key', '16', 'x = x * 2 doubles whatever x holds.'],
  ['number key', '16', 'x पहले 5 है, फिर 8 होता है। अगली लाइन क्या करती है?'],
  ['number key', '15', 'You typed 14. What does input() give back, a number or text?'],
  ['one-digit key', '3', 'Take it one step at a time; there are three lines to read.'],
  ['one-digit key', '3', 'Teen lines hain, pehli line dekho.'],
  ['one-digit key', '3', 'तीन लाइनें हैं, पहली लाइन देखो।'],
  ['one-digit key', '2', 'Do you want to try it yourself first?'],
  ['one-digit key', '1', 'Pehle code ko line by line padho.'],
  ['one-digit key', '3', 'Take it one step at a time and look at the loop.'],
  ['one-digit key', '0', 'Together we can debug it. Look at the loop first.'],
  ['word key', 'Warm', 'Is 25 greater than 30? What about 20? Check them in order.'],
  ['word key', 'Warm', 'The weather words are just labels; focus on the comparisons.'],
  ['code key', 'n % 2 == 0', 'Which operator gives the remainder, % or //?'],
  ['code key', 'n % 2 == 0', 'n % 3 == 0 checks for multiples of three; what checks for even?'],
  ['code key', '.lower()', 'Use a string method that changes the case of every letter.'],
  ['code key', 'print(f"Total: {total}")', 'An f-string starts with f before the quotes.'],
  ['code key', 'if marks >= 80:', 'Look at your line elif marks >= 80: when does it run?'],
  ['code key', 'hahaha', 'Multiplying a string by 3 repeats it. How many copies?'],
  // "baar"/"times" next to an imperative, not a run/print verb, are ordinary count words (4.5c).
  ['one-digit key', '1', 'Ek baar code ko line by line padho.'],
  ['one-digit key', '3', 'Read it three times slowly.'],
  ['one-digit key', '1', 'Ek baar try karo.'],
  ['one-digit key', '2', 'Do baar socho.'],
];

/** Known trips, by design: a one-digit key's digits count anywhere; a word key at a boundary. */
const STRICT: readonly [string, string, string][] = [
  ['one-digit digits anywhere', '3', 'Look at line 3 first.'],
  ['word key in a compound', 'Warm', 'Start with a quick warm-up question.'],
  ['spaced repetition', 'hahaha', 'It prints ha ha ha, right?'],
];

function gateShows(key: string, text: string): string {
  const g = sentenceGate(compileAnswerKeys([key]));
  return [...g.push(text), ...g.flush()].join('');
}

describe('answer-leak false positives (ordinary lesson text)', () => {
  it.each(CLEAN.map(([kind, key, text], i) => ({ row: i, kind, key, text })))(
    'row $row ($kind): passes the matcher and the stream gate unchanged',
    ({ key, text }) => {
      expect(compileAnswerKeys([key]).leaks(text)).toBe(false);
      expect(gateShows(key, text)).toBe(text);
    },
  );

  it.each(STRICT.map(([kind, key, text], i) => ({ row: i, kind, key, text })))(
    'strict row $row ($kind): trips, by design',
    ({ key, text }) => {
      expect(compileAnswerKeys([key]).leaks(text)).toBe(true);
    },
  );

  it('the fixed hint passes every key above', () => {
    for (const [, key] of [...CLEAN, ...STRICT]) {
      expect(compileAnswerKeys([key]).leaks(ANSWER_LEAK_SAFE_HINT)).toBe(false);
    }
  });
});

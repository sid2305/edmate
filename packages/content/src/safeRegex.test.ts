import { IN_PII_PATTERNS } from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { checkSafeRegex, probeTiming, structuralIssues } from './safeRegex.js';

const NESTED = 'nests a quantifier inside a repeated group';
const OVERLAP = 'repeats an alternation whose branches can start the same way';
const BACKREF = 'uses a backreference';
const BEHIND = 'has a lookbehind longer than one character';

describe('structuralIssues', () => {
  it.each([
    ['(a+)+$', NESTED],
    ['(\\d+)*', NESTED],
    ['(?:a?)+', NESTED],
    ['(?:a{2}){3}', NESTED],
    ['(?:x(?:y*))+', NESTED],
    ['(?=(a+)+)b', NESTED],
    ['(a|a)+', OVERLAP],
    ['(a|aa)+c', OVERLAP],
    ['(?:ab|ac)+', OVERLAP],
    ['(?:[ab]|c)+', OVERLAP],
    ['(?:a|)+', OVERLAP],
    ['(?:\\d|x)+', OVERLAP],
    ['(?:(?:a|a)b){2}', OVERLAP],
    ['(a)\\1', BACKREF],
    ['(?<n>a)\\k<n>', BACKREF],
    ['(?<=ab)x', BEHIND],
    ['(?<!\\d+)x', BEHIND],
    ['(?<!a|b)x', BEHIND],
    ['(?<!(?:a))x', BEHIND],
  ])('%s → %s', (source, issue) => {
    expect(structuralIssues(source)).toContain(issue);
  });

  it.each([
    'x{2,}',
    '\\d{4}[ -]?\\d{4}',
    '(?:ab){3}',
    '(?:ab|cd)+',
    '(?:(?:a|b)c)+',
    '(?<!\\d)x',
    '(?<![A-Za-z0-9])x',
    '(?<!.)x',
    '(?<!\\u{1F600})x',
    '[(a+)+]',
    '\\(a+\\)+',
    '(?:\\+?91[ \\-]?|0)?[6-9]\\d{9}',
    '\\p{L}+\\s\\P{N}?',
    '\\x41\\u0042\\cJ\\0\\n.^$\\b\\B',
    '(?<name>a)b+?c*?d??e{1,2}?',
    'a|b|c',
  ])('%s → no issue', (source) => {
    expect(structuralIssues(source)).toEqual([]);
  });

  it('reports each kind of issue once', () => {
    expect(structuralIssues('(a+)+(b+)+(a)\\1\\1')).toEqual([NESTED, BACKREF]);
  });

  it('the real India patterns pass', () => {
    for (const source of Object.values(IN_PII_PATTERNS)) {
      expect(structuralIssues(source)).toEqual([]);
    }
  });
});

describe('probeTiming', () => {
  it('passes a linear pattern on the real clock', () => {
    expect(probeTiming(new RegExp('\\d{4}x', 'gu'))).toBeUndefined();
  });

  it('flags a pattern whose probes blow the budget', () => {
    let t = 0;
    const now = () => (t += 1_000);
    expect(probeTiming(new RegExp('a', 'gu'), { now, budgetMs: 100 })).toBe(
      'took longer than 100 ms on a probe input',
    );
  });

  it('each attempt stops at the first slow probe (later, longer inputs never run)', () => {
    let calls = 0;
    const now = () => {
      calls++;
      return calls * 1_000;
    };
    probeTiming(new RegExp('a', 'gu'), { now, budgetMs: 100, attempts: 1 });
    expect(calls).toBe(2);
    calls = 0;
    probeTiming(new RegExp('a', 'gu'), { now, budgetMs: 100 });
    expect(calls).toBe(6); // three attempts by default
  });

  it('one stalled attempt (a loaded machine) is not enough to flag a pattern', () => {
    // The clock jumps 1 s once, during the first attempt, then stands still.
    let calls = 0;
    const now = () => (++calls >= 2 ? 1_000 : 0);
    expect(probeTiming(new RegExp('a', 'gu'), { now, budgetMs: 100 })).toBeUndefined();
    expect(calls).toBeGreaterThan(3); // the second attempt ran every input
    // Stalled on every attempt, it is flagged.
    let t = 0;
    const always = () => (t += 1_000);
    expect(probeTiming(new RegExp('a', 'gu'), { now: always, budgetMs: 100 })).toBe(
      'took longer than 100 ms on a probe input',
    );
  });

  it('the real India patterns pass on the real clock', () => {
    for (const source of Object.values(IN_PII_PATTERNS)) {
      expect(probeTiming(new RegExp(source, 'gu'))).toBeUndefined();
    }
  });
});

describe('checkSafeRegex', () => {
  it('runs the structural check first and skips timing when it fails', () => {
    let calls = 0;
    const now = () => ++calls;
    expect(checkSafeRegex('(a+)+$', { now })).toEqual([NESTED]);
    expect(calls).toBe(0);
  });

  it('runs the timing probe on a structurally clean pattern', () => {
    let t = 0;
    const now = () => (t += 1_000);
    expect(checkSafeRegex('a', { now, budgetMs: 50 })).toEqual([
      'took longer than 50 ms on a probe input',
    ]);
    expect(checkSafeRegex('a')).toEqual([]);
  });

  it('a source that does not compile with gu is not its concern (reported elsewhere)', () => {
    expect(checkSafeRegex('\\a')).toEqual([]);
  });
});

import { IN_PII_PATTERNS } from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { checkSafeRegex, extractProbeUnits, probeTiming, structuralIssues } from './safeRegex.js';

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
    // fix round 1 (security review of PR #57): a manually unrolled ambiguous alternation,
    // two or more adjacent unquantified copies of the same group, is just as dangerous as the
    // quantified form and was not caught by the earlier check.
    ['(x|xx)'.repeat(25) + 'z', OVERLAP],
    ['(a|aa)'.repeat(25) + 'z', OVERLAP],
    ['(ab|ac)(ab|ac)x', OVERLAP],
    ['(a|b)(b|c)x', OVERLAP], // groups whose branches overlap each other, not identical groups
    // fix round 2 (architect re-review): cheap bypasses of the unrolled-overlap scan.
    ['(a|aa){1}'.repeat(25) + 'z', OVERLAP], // a {1} quantifier is no quantifier at all
    ['((a|aa))'.repeat(25) + 'z', OVERLAP], // a plain one-branch group wrapping the alternation
    ['(a|aa)b?'.repeat(25) + 'z', OVERLAP], // an optional term interleaved between groups
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

  it('two adjacent non-overlapping groups are fine (not flagged as unrolled)', () => {
    expect(structuralIssues('(ab|cd)(ef|gh)x')).toEqual([]);
    expect(structuralIssues('(?:ab|cd){3}')).toEqual([]);
  });
});

describe('extractProbeUnits', () => {
  it('collects every distinct literal and class/escape sample used', () => {
    expect(extractProbeUnits('(x|xx)z')).toEqual(expect.arrayContaining(['x', 'z']));
    expect(extractProbeUnits(String.raw`\d[a-z]\s`)).toEqual(
      expect.arrayContaining(['1', 'a', ' ']),
    );
  });

  it('is empty for a pattern it cannot parse usefully, never throws', () => {
    expect(extractProbeUnits('[')).toEqual([]);
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

  // fix round 2 (architect re-review): `a?` x25 then `a` x25 is a classic catastrophic pattern
  // with no group and no alternation, so the structural check cannot catch it without false
  // positives on ordinary optional-then-literal patterns (the real IN mobile pattern has one).
  // Anchored so the engine must explore the full failure space instead of returning a cheap
  // substring match; the timing probe catches it on the real clock, well within budget.
  it('the timing probe (not the structural check) catches `a?` x25 then `a` x25, anchored', () => {
    const source = '^' + 'a?'.repeat(25) + 'a'.repeat(25) + '$';
    expect(structuralIssues(source)).toEqual([]);
    expect(checkSafeRegex(source)).toEqual(['took longer than 100 ms on a probe input']);
  });
});

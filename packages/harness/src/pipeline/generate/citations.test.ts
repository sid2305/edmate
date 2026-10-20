import type { SourceRef } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { citedSources, invalidCitations } from './citations.js';

const src = (n: number): SourceRef => ({ title: `Doc ${n}`, locator: `p. ${n}`, kind: 'material' });
const sources = [src(1), src(2), src(3)];

describe('citedSources', () => {
  it('returns only the cited sources, in n order, once each', () => {
    expect(citedSources('See [3] and [1], and again [3].', sources)).toEqual([src(1), src(3)]);
  });

  it('is empty when nothing is cited', () => {
    expect(citedSources('No citations here.', sources)).toEqual([]);
    expect(citedSources('', sources)).toEqual([]);
  });

  it('ignores out-of-range and malformed numbers', () => {
    expect(citedSources('[0] [4] [12] [-1] [1.5] [ 2 ] [x]', sources)).toEqual([]);
    expect(citedSources('[2]', [])).toEqual([]);
  });

  it('returns copies', () => {
    const out = citedSources('[1]', sources);
    expect(out[0]).not.toBe(sources[0]);
  });

  it('handles a very long draft', () => {
    const draft = '[2] '.repeat(10_000);
    expect(citedSources(draft, sources)).toEqual([src(2)]);
  });
});

describe('invalidCitations (task 4.7, grounding Rule B)', () => {
  it('is empty when every [n] names one of the numbered sources', () => {
    expect(invalidCitations('See [1] and [3], then [2].', 3)).toEqual([]);
    expect(invalidCitations('No citations at all.', 0)).toEqual([]);
  });

  it('lists made-up and out-of-range numbers once each, in order', () => {
    expect(invalidCitations('As [4] says, and [0], and [4] again, [1].', 3)).toEqual([4, 0]);
    expect(invalidCitations('Per my notes [1].', 0)).toEqual([1]);
  });

  it('ignores indexing and code: pets[0], x[3], `nums[2]`, fenced blocks', () => {
    const text =
      'Use pets[0] for the first, x[3] and grid[1][2] too, f(x)[1], "ab"[1]. ' +
      'Inline `nums[2]` is code.\n```\nprint(items[7])\n[9]\n```\nAnd [1].';
    expect(invalidCitations(text, 1)).toEqual([]);
  });

  it('still counts a citation right after a space or punctuation', () => {
    expect(invalidCitations('Floor division rounds down [5]. (see [6])', 1)).toEqual([5, 6]);
  });

  it('an unclosed fence hides the rest (it is all code)', () => {
    expect(invalidCitations('Look:\n```\nx = [5]\n', 0)).toEqual([]);
  });
});

import type { SourceRef } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { citedSources } from './citations.js';

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

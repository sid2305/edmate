// Task 5.3 Phase D: the pure parts of the search score (no Postgres needed).
import { describe, expect, it } from 'vitest';
import {
  ftsQuery,
  pivotScale,
  queryTerms,
  stemTerm,
  termCoverage,
  TEXT_PIVOT,
} from '../src/repositories/retrieval.js';

describe('stemTerm', () => {
  it.each([
    ['dividing', 'divid'],
    ['dictionaries', 'dictionar'],
    ['printed', 'print'],
    ['classes', 'class'],
    ['capitals', 'capital'],
    ['types', 'type'],
    ['values', 'valu'],
    ['class', 'class'],
    ['photosynthesis', 'photosynthesis'],
    ['status', 'status'],
    ['typing', 'typing'],
    ['is', 'is'],
    ['100', '100'],
    ['3rds', '3rds'],
  ])('%s -> %s', (word, stem) => {
    expect(stemTerm(word)).toBe(stem);
  });

  it('only widens: the stem is a prefix of the word', () => {
    for (const w of ['loops', 'numbers', 'returned', 'counting', 'entries']) {
      expect(w.startsWith(stemTerm(w))).toBe(true);
    }
  });
});

describe('queryTerms', () => {
  it('drops stop words and question fillers, stems, and keeps each term once', () => {
    expect(queryTerms('What does return ACTUALLY do? Returns, returning...')).toEqual([
      'return',
    ]);
    expect(queryTerms('How should I stop the loops early')).toEqual(['stop', 'loop', 'early']);
    expect(queryTerms('the a of')).toEqual([]);
    expect(ftsQuery('the a of')).toBeNull();
  });
});

describe('termCoverage', () => {
  const df = new Map([
    ['loop', 9],
    ['csv', 0],
  ]);

  it('is the IDF-weighted share of matched terms: a term no chunk has weighs most', () => {
    const both = termCoverage(['loop', 'csv'], df, 10);
    const common = termCoverage(['loop'], df, 10);
    const rare = termCoverage(['csv'], df, 10);
    expect(both).toBe(1);
    expect(common).toBeGreaterThan(0);
    expect(common).toBeLessThan(0.1);
    expect(rare).toBeGreaterThan(0.9);
    expect(common + rare).toBeCloseTo(1, 10);
  });

  it('ignores matched terms the query does not have, and counts repeats once', () => {
    expect(termCoverage(['loop', 'loop', 'zebra'], df, 10)).toBe(termCoverage(['loop'], df, 10));
    expect(termCoverage([], df, 10)).toBe(0);
  });

  it('is positive even when every chunk has the term (n = df)', () => {
    expect(termCoverage(['x'], new Map([['x', 4]]), 4)).toBe(1);
    expect(termCoverage(['x'], new Map([['x', 0]]), 0)).toBe(1);
  });
});

describe('pivotScale', () => {
  it('sends 0 to 0, the pivot to 0.5 and 1 to 1, monotonically', () => {
    expect(pivotScale(0, TEXT_PIVOT)).toBe(0);
    expect(pivotScale(TEXT_PIVOT, TEXT_PIVOT)).toBe(0.5);
    expect(pivotScale(1, TEXT_PIVOT)).toBe(1);
    let last = -1;
    for (let x = 0; x <= 1; x += 0.05) {
      const y = pivotScale(x, TEXT_PIVOT);
      expect(y).toBeGreaterThan(last);
      last = y;
    }
  });

  it('clamps outside 0-1', () => {
    expect(pivotScale(-0.2, TEXT_PIVOT)).toBe(0);
    expect(pivotScale(1.5, TEXT_PIVOT)).toBe(1);
  });
});

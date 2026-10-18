import { describe, expect, it } from 'vitest';
import { checkMaxChars, checkMaxWords, checkMustCiteSource, countWords } from './structure.js';

describe('max_words', () => {
  it('passes exactly at the limit and fails one over', () => {
    expect(checkMaxWords('one two  three\nfour', 4)).toEqual({ name: 'max_words', pass: true });
    expect(checkMaxWords('one two three four five', 4)).toEqual({
      name: 'max_words',
      pass: false,
      detail: '5 words > 4',
    });
  });

  it('counts an empty or blank reply as zero words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });
});

describe('max_chars', () => {
  it('passes exactly at the limit and fails one over', () => {
    expect(checkMaxChars('abcde', 5)).toEqual({ name: 'max_chars', pass: true });
    expect(checkMaxChars('abcdef', 5)).toEqual({
      name: 'max_chars',
      pass: false,
      detail: '6 chars > 5',
    });
  });

  it('counts an astral character (emoji) as one, not two UTF-16 units', () => {
    expect(checkMaxChars('ab\u{1F600}', 3).pass).toBe(true);
  });
});

describe('must_cite_source', () => {
  const src = [{ title: 'Lesson 3 notes', locator: 'p. 2' }];

  it('true: passes with sources, fails without', () => {
    expect(checkMustCiteSource({ text: 'x', sources: src }, true)).toEqual({
      name: 'must_cite_source',
      pass: true,
    });
    expect(checkMustCiteSource({ text: 'x' }, true)).toEqual({
      name: 'must_cite_source',
      pass: false,
      detail: 'expected at least one source, got none',
    });
    expect(checkMustCiteSource({ text: 'x', sources: [] }, true).pass).toBe(false);
  });

  it('false: passes without sources, fails with', () => {
    expect(checkMustCiteSource({ text: 'x' }, false).pass).toBe(true);
    expect(checkMustCiteSource({ text: 'x', sources: src }, false)).toEqual({
      name: 'must_cite_source',
      pass: false,
      detail: 'expected no sources, got 1',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { normaliseForMatch, revealsAnswerKey } from './answerKey.js';

describe('normaliseForMatch', () => {
  it('NFKC-folds, lower-cases and strips spaces, separators, commas and zero-width characters', () => {
    expect(normaliseForMatch('24,000')).toBe('24000');
    expect(normaliseForMatch('２４０００')).toBe('24000');
    expect(normaliseForMatch('24​000')).toBe('24000');
    expect(normaliseForMatch('24 000')).toBe('24000');
    expect(normaliseForMatch('Five  Sixths')).toBe('fivesixths');
    expect(normaliseForMatch('﻿5/6⁠')).toBe('5/6');
  });
});

describe('revealsAnswerKey', () => {
  const keys = ['24000', '5/6', 'five sixths'];

  it.each([
    ['plain', 'the answer is 24000'],
    ['thousands comma', 'it is 24,000'],
    ['fullwidth digits', 'it is ２４０００'],
    ['zero-width split', '24​000'],
    ['spaced', '2 4 0 0 0'],
    ['case and spaces', 'FIVE SIXTHS'],
    ['fraction', 'so 5/6'],
  ])('catches %s', (_n, text) => {
    expect(revealsAnswerKey(text, keys)).toBe(true);
  });

  it('looks into nested values, keys and numbers', () => {
    expect(revealsAnswerKey({ steps: [{ t: 'x' }, { [`${'5/6'}`]: 1 }] }, keys)).toBe(true);
    expect(revealsAnswerKey({ value: 24000 }, keys)).toBe(true);
    expect(revealsAnswerKey({ a: 'x "q" y' }, ['"q"'])).toBe(true);
  });

  it('is false for clean values and ignores empty keys', () => {
    expect(revealsAnswerKey({ hint: 'find a common denominator' }, keys)).toBe(false);
    expect(revealsAnswerKey('anything', ['', ' ', '​'])).toBe(false);
    expect(revealsAnswerKey(undefined, keys)).toBe(false);
  });
});

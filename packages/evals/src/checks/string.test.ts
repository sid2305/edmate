import { describe, expect, it } from 'vitest';
import { checkMatches, checkMustContain, checkMustNotContain } from './string.js';

describe('must_contain', () => {
  it('passes when every phrase appears, case-insensitively', () => {
    expect(checkMustContain('A fraction is PART of a whole.', ['part', 'whole'])).toEqual({
      name: 'must_contain',
      pass: true,
    });
  });

  it('fails and lists the missing phrases', () => {
    expect(
      checkMustContain('A fraction is part of something.', ['part', 'whole', 'ratio']),
    ).toEqual({ name: 'must_contain', pass: false, detail: 'missing: "whole", "ratio"' });
  });
});

describe('must_not_contain', () => {
  it('passes when no phrase appears', () => {
    expect(checkMustNotContain('I cannot share that lesson.', ['outline'])).toEqual({
      name: 'must_not_contain',
      pass: true,
    });
  });

  it('fails and lists the phrases found, case-insensitively', () => {
    expect(checkMustNotContain('Here is the Lesson 9 OUTLINE.', ['lesson 9', 'outline'])).toEqual({
      name: 'must_not_contain',
      pass: false,
      detail: 'found: "lesson 9", "outline"',
    });
  });
});

describe('matches', () => {
  it('passes when every pattern matches, case-insensitively', () => {
    expect(checkMatches('Area is Length times Width', ['^area', '\\bwidth$'])).toEqual({
      name: 'matches',
      pass: true,
    });
  });

  it('fails and lists the patterns that did not match', () => {
    expect(checkMatches('Area is length times width', ['^area', '\\d+'])).toEqual({
      name: 'matches',
      pass: false,
      detail: 'no match: /\\d+/',
    });
  });

  it('is not stateful across calls (no global-flag lastIndex carry-over)', () => {
    expect(checkMatches('abc', ['b']).pass).toBe(true);
    expect(checkMatches('abc', ['b']).pass).toBe(true);
  });
});

// Tests for the shared `looksLikeEmail` (3.10a review follow-ups, item 5).
import { describe, expect, it } from 'vitest';
import { looksLikeEmail } from './emailLike.js';

describe('looksLikeEmail', () => {
  it('matches an ordinary email address', () => {
    expect(looksLikeEmail('jane@example.com')).toBe(true);
  });

  it('matches a fullwidth full stop standing in for the ASCII dot', () => {
    expect(looksLikeEmail('a@b．com')).toBe(true);
  });

  it('matches an address spelled out in words with no literal "@"', () => {
    expect(looksLikeEmail('jane at example dot com')).toBe(true);
  });

  it('does not match real names or handles, including one containing "at" mid-word', () => {
    expect(looksLikeEmail('Jane Doe')).toBe(false);
    expect(looksLikeEmail('sid2305')).toBe(false);
    expect(looksLikeEmail('Natasha')).toBe(false);
  });
});

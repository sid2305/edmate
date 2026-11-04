// Tests for the shared `isPending` (3.10a review follow-ups, item 3).
import { describe, expect, it } from 'vitest';
import { isPending } from './pendingText.js';

describe('isPending', () => {
  it('matches the literal word "pending" and "tbd", case-insensitively and padded', () => {
    expect(isPending('pending')).toBe(true);
    expect(isPending('Pending')).toBe(true);
    expect(isPending('  PENDING  ')).toBe(true);
    expect(isPending('TBD')).toBe(true);
    expect(isPending('tbd')).toBe(true);
  });

  it('treats blank, whitespace-only and invisible-only strings as pending', () => {
    expect(isPending('')).toBe(true);
    expect(isPending('   ')).toBe(true);
    expect(isPending(' ')).toBe(true);
    expect(isPending('​')).toBe(true); // zero-width space only
  });

  it('matches a one-edit typo of "pending"', () => {
    expect(isPending('Pendingg')).toBe(true); // extra letter
    expect(isPending('Pendng')).toBe(true); // missing letter
    expect(isPending('Pedning')).toBe(true); // adjacent-letter swap
  });

  it('does not match real names, handles, or longer text containing "pending"', () => {
    expect(isPending('sid2305')).toBe(false);
    expect(isPending('Dr. Patel')).toBe(false);
    expect(isPending('Nat')).toBe(false);
    expect(isPending('pending review requested')).toBe(false);
  });
});

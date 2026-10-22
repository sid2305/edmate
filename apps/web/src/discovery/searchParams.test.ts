// Task 9.2 Phase B. Written and red before searchParams.ts exists (TDD).
import { describe, expect, it } from 'vitest';
import { parseDiscoveryParams } from './searchParams';

describe('parseDiscoveryParams', () => {
  it('defaults to page 1 with no q or language on an empty object', () => {
    expect(parseDiscoveryParams({})).toEqual({ page: 1 });
  });

  it('trims q and keeps it under the limit', () => {
    expect(parseDiscoveryParams({ q: '  finance  ' })).toEqual({ q: 'finance', page: 1 });
  });

  it('drops an empty or whitespace-only q', () => {
    expect(parseDiscoveryParams({ q: '   ' })).toEqual({ page: 1 });
  });

  it('cuts q at 100 characters', () => {
    const long = 'a'.repeat(150);
    expect(parseDiscoveryParams({ q: long }).q).toHaveLength(100);
  });

  it('keeps a valid lang as language', () => {
    expect(parseDiscoveryParams({ lang: 'en' })).toEqual({ language: 'en', page: 1 });
  });

  it('drops a bad lang instead of throwing', () => {
    expect(parseDiscoveryParams({ lang: '!!not-a-tag!!' })).toEqual({ page: 1 });
  });

  it('keeps a valid page', () => {
    expect(parseDiscoveryParams({ page: '3' })).toEqual({ page: 3 });
  });

  it('falls back to page 1 for a non-numeric, zero, negative, fractional or over-max page', () => {
    expect(parseDiscoveryParams({ page: 'abc' })).toEqual({ page: 1 });
    expect(parseDiscoveryParams({ page: '0' })).toEqual({ page: 1 });
    expect(parseDiscoveryParams({ page: '-1' })).toEqual({ page: 1 });
    expect(parseDiscoveryParams({ page: '1.5' })).toEqual({ page: 1 });
    expect(parseDiscoveryParams({ page: '51' })).toEqual({ page: 1 });
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parseDiscoveryParams({ q: ['first', 'second'], lang: ['en', 'pt'], page: ['2', '3'] })).toEqual({
      q: 'first',
      language: 'en',
      page: 2,
    });
  });

  it('never throws on extra or odd keys', () => {
    expect(() => parseDiscoveryParams({ bogus: 'x', q: undefined })).not.toThrow();
  });
});

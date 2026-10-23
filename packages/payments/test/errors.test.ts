import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  PAYMENTS_ERROR_CODES,
  PaymentsError,
  isPaymentsError,
  type PaymentsErrorCode,
} from '../src/errors.js';
import { fakeSecret, leaks } from './helpers/fake-secret.js';

// ADR-0015 §7, verbatim order. A new code needs an ADR that amends 0015.
const ADR_0015_CODES = [
  'invalid_signature',
  'stale_signature',
  'malformed_event',
  'unsupported',
  'not_found',
  'conflict',
  'validation',
  'rate_limited',
  'provider_error',
] as const;

describe('PaymentsError', () => {
  it('has exactly the ADR-0015 §7 codes', () => {
    expect([...PAYMENTS_ERROR_CODES]).toEqual([...ADR_0015_CODES]);
    // The union and the ADR list match both ways at compile time.
    const fromAdr: readonly PaymentsErrorCode[] = ADR_0015_CODES;
    const toAdr: readonly (typeof ADR_0015_CODES)[number][] = PAYMENTS_ERROR_CODES;
    expect(fromAdr.length).toBe(toAdr.length);
  });

  it.each(PAYMENTS_ERROR_CODES)('%s has fixed words and a fixed retry rule', (code) => {
    const err = new PaymentsError(code);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PaymentsError');
    expect(err.code).toBe(code);
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.retryable).toBe(code === 'rate_limited' || code === 'provider_error');
    expect(isPaymentsError(err)).toBe(true);
    expect(isPaymentsError(err, code)).toBe(true);
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      name: 'PaymentsError',
      code,
      retryable: err.retryable,
      message: err.message,
    });
  });

  it('provider_error is not retryable for a bad key (401/403)', () => {
    expect(new PaymentsError('provider_error', { retryable: false }).retryable).toBe(false);
    expect(new PaymentsError('provider_error', { retryable: true }).retryable).toBe(true);
  });

  it('only provider_error takes a retry choice', () => {
    expect(new PaymentsError('rate_limited', { retryable: false }).retryable).toBe(true);
    expect(new PaymentsError('conflict', { retryable: true }).retryable).toBe(false);
  });

  it('isPaymentsError refuses other errors and other codes', () => {
    expect(isPaymentsError(new Error('x'))).toBe(false);
    expect(isPaymentsError({ code: 'conflict' })).toBe(false);
    expect(isPaymentsError(new PaymentsError('conflict'), 'not_found')).toBe(false);
  });

  it('never keeps a cause, and nothing secret reaches message, stack, JSON or inspect', () => {
    const secret = fakeSecret();
    const err = new PaymentsError('invalid_signature', {
      cause: new Error(`body had ${secret}`),
    } as never);
    expect('cause' in err).toBe(false);
    const texts = [
      err.message,
      String(err.stack),
      JSON.stringify(err),
      inspect(err, { showHidden: true, depth: 5 }),
      String(err),
    ];
    for (const text of texts) expect(leaks(text, secret)).toBe(false);
  });
});

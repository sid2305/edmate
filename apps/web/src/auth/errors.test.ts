// Task 9.4e item 8: `apiError` gains an optional 4th `headers` param so a 429 can carry
// `Retry-After`, without changing any existing call site (backward compatible).
import { describe, expect, it } from 'vitest';
import { apiError, errorBody } from './errors';

describe('errorBody', () => {
  it('marks a provider_error or rate_limited code as retryable', () => {
    expect(errorBody('provider_error', 'oops').retryable).toBe(true);
    expect(errorBody('rate_limited', 'slow down').retryable).toBe(true);
  });

  it('marks any other code as not retryable', () => {
    expect(errorBody('validation', 'bad input').retryable).toBe(false);
  });
});

describe('apiError', () => {
  it('always sets cache-control: no-store, with no extra headers by default', async () => {
    const res = apiError('validation', 'bad input', 400);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      error: { code: 'validation', message: 'bad input', retryable: false },
    });
  });

  it('merges extra headers (e.g. Retry-After) without dropping cache-control', async () => {
    const res = apiError('rate_limited', 'slow down', 429, { 'Retry-After': '60' });
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toEqual({
      error: { code: 'rate_limited', message: 'slow down', retryable: true },
    });
  });

  it('overrides a caller-supplied Cache-Control with no-store, regardless of case (9.4f item 4)', async () => {
    const res = apiError('rate_limited', 'slow down', 429, {
      'Cache-Control': 'public, max-age=3600',
      'Retry-After': '60',
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('Retry-After')).toBe('60');
  });
});

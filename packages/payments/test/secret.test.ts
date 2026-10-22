import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { isPaymentsError } from '../src/errors.js';
import { Secret } from '../src/secret.js';
import { fakeSecret, leaks } from './helpers/fake-secret.js';

describe('Secret (local copy)', () => {
  it('reveals only through reveal()', () => {
    const value = fakeSecret();
    const s = Secret.of(value);
    expect(s.reveal() === value).toBe(true);
    const texts = [
      String(s),
      s.toString(),
      `${s}`,
      JSON.stringify({ s }),
      inspect(s, { showHidden: true, depth: 5 }),
      String(s.valueOf()),
      JSON.stringify(structuredClone({ ...s })),
    ];
    for (const t of texts) expect(leaks(t, value)).toBe(false);
    expect(inspect(s)).toBe('Secret([redacted])');
  });

  it('reveal on a non-Secret throws, and the class cannot be patched', () => {
    expect(() => Secret.prototype.reveal.call({} as Secret)).toThrow(TypeError);
    expect(Object.isFrozen(Secret.prototype)).toBe(true);
    expect(Object.isFrozen(Secret.of('x'))).toBe(true);
  });

  it('refuses an empty or whitespace-only value with validation (an HMAC under it is forgeable)', () => {
    for (const value of ['', ' ', '  \t\n ', undefined as unknown as string]) {
      let code: unknown;
      try {
        Secret.of(value);
      } catch (err) {
        code = isPaymentsError(err) ? err.code : err;
      }
      expect(code).toBe('validation');
    }
    expect(Secret.of(' padded ').reveal()).toBe(' padded ');
  });
});

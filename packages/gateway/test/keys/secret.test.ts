import { format, inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Secret } from '../../src/keys/secret.js';
import { fakeKey, leaks } from '../helpers/fake-key.js';

describe('Secret', () => {
  it('reveal() returns the value', () => {
    const value = fakeKey();
    expect(Secret.of(value).reveal() === value).toBe(true);
  });

  it('keeps separate values for separate instances', () => {
    const a = fakeKey();
    const b = fakeKey();
    const sa = Secret.of(a);
    const sb = Secret.of(b);
    expect(sa.reveal() === a && sb.reveal() === b).toBe(true);
  });

  it('is frozen', () => {
    const s = Secret.of(fakeKey());
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('prints as [redacted] through string conversions', () => {
    const s = Secret.of(fakeKey());
    expect(String(s)).toBe('[redacted]');
    expect(`${s}`).toBe('[redacted]');
    expect(s + '').toBe('[redacted]');
    expect(s.toString()).toBe('[redacted]');
    expect(s.valueOf()).toBe('[redacted]');
    expect(s.toJSON()).toBe('[redacted]');
  });

  it('never exposes the value through serialisation, inspection or reflection', () => {
    const value = fakeKey();
    const s = Secret.of(value);
    const nested = { a: { b: [s, { s }] } };
    const outputs: string[] = [
      String(s),
      `${s}`,
      s + '',
      JSON.stringify(s),
      JSON.stringify(nested),
      inspect(s),
      inspect(nested, { depth: Infinity }),
      inspect(s, { showHidden: true }),
      inspect(s, { showHidden: true, customInspect: false, depth: Infinity }),
      inspect(nested, { showHidden: true, customInspect: false, depth: Infinity }),
      format('%s %o %j %O', s, s, s, nested),
      format('%s', nested),
      JSON.stringify(Object.keys(s)),
      JSON.stringify(Object.entries(s)),
      JSON.stringify({ ...s }),
      JSON.stringify(Object.getOwnPropertyNames(s)),
      inspect(structuredClone(s), { showHidden: true, customInspect: false }),
    ];
    for (const out of outputs) expect(leaks(out, value)).toBe(false);
  });

  it('inspects as Secret([redacted])', () => {
    expect(inspect(Secret.of(fakeKey()))).toBe('Secret([redacted])');
  });

  it('returns [redacted] for every primitive hint', () => {
    const s = Secret.of(fakeKey());
    const toPrimitive = s[Symbol.toPrimitive].bind(s);
    expect(toPrimitive('string')).toBe('[redacted]');
    expect(toPrimitive('number')).toBe('[redacted]');
    expect(toPrimitive('default')).toBe('[redacted]');
  });

  it('a structured clone carries no value and cannot be revealed', () => {
    const clone = structuredClone(Secret.of(fakeKey()));
    expect(clone instanceof Secret).toBe(false);
  });

  it('reveal() on a non-Secret receiver throws without a value', () => {
    const s = Secret.of(fakeKey());
    const reveal = s.reveal;
    expect(() => reveal.call({} as Secret)).toThrow('not a Secret');
  });
});

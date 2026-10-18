import { describe, expect, it } from 'vitest';
import { envKeySource } from '../../src/keys/source.js';
import { fakeKey } from '../helpers/fake-key.js';

describe('envKeySource', () => {
  it('is named environment', () => {
    expect(envKeySource({}).name).toBe('environment');
  });

  it('returns only the requested variables', async () => {
    const value = fakeKey();
    const other = fakeKey();
    const source = envKeySource({ EDMATE_A: value, EDMATE_OTHER: other, PATH: '/bin' });
    const read = await source.read(['EDMATE_A', 'EDMATE_MISSING']);
    expect(Object.keys(read).sort()).toEqual(['EDMATE_A', 'EDMATE_MISSING']);
    expect(read['EDMATE_A'] === value).toBe(true);
    expect(read['EDMATE_MISSING']).toBeUndefined();
    expect(Object.values(read).includes(other)).toBe(false);
  });

  it('returns a frozen result and does not see later changes to the env object', async () => {
    const env: Record<string, string | undefined> = { EDMATE_A: fakeKey() };
    const source = envKeySource(env);
    const first = await source.read(['EDMATE_A']);
    expect(Object.isFrozen(first)).toBe(true);
    env['EDMATE_A'] = undefined;
    expect(first['EDMATE_A']).toBeDefined();
  });

  it('ignores inherited properties of the env object', async () => {
    const env = Object.create({ EDMATE_A: 'inherited' }) as Record<string, string | undefined>;
    const read = await envKeySource(env).read(['EDMATE_A']);
    expect(read['EDMATE_A']).toBeUndefined();
  });
});

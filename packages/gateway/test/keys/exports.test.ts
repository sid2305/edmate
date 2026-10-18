import { describe, expect, it } from 'vitest';
import * as gateway from '../../src/index.js';

describe('package exports', () => {
  it('exports the key module and keeps the schema internal', () => {
    expect(Object.keys(gateway).sort()).toEqual(
      ['KeyConfigError', 'PROVIDER_KEYS', 'Secret', 'envKeySource', 'loadProviderKeys'].sort(),
    );
    expect('keyValueSchema' in gateway).toBe(false);
  });
});

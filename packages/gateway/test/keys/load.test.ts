import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { KeyConfigError, loadProviderKeys } from '../../src/keys/load.js';
import { PROVIDER_KEYS, type ProviderId } from '../../src/keys/providers.js';
import { Secret } from '../../src/keys/secret.js';
import { envKeySource, type KeySource } from '../../src/keys/source.js';
import { fakeKey, leaks } from '../helpers/fake-key.js';

const VAR = PROVIDER_KEYS['openai-compatible'].apiKey.variable;

/** Every text form of an error a log line, a trace or an API response could carry. */
function errorTexts(err: unknown): string[] {
  const e = err as Error;
  return [
    e.message,
    String(e.stack),
    JSON.stringify(e),
    inspect(e),
    inspect(e, { showHidden: true }),
    String(e),
  ];
}

async function failure(
  source: KeySource,
  required: readonly ProviderId[],
): Promise<KeyConfigError> {
  try {
    await loadProviderKeys({ source, required });
  } catch (err) {
    expect(err).toBeInstanceOf(KeyConfigError);
    return err as KeyConfigError;
  }
  throw new Error('expected loadProviderKeys to throw');
}

function assertNoLeak(err: KeyConfigError, value: string): void {
  for (const text of errorTexts(err)) expect(leaks(text, value)).toBe(false);
  expect('cause' in err).toBe(false);
}

describe('PROVIDER_KEYS', () => {
  it('names the openai-compatible key variable with the EDMATE_ prefix', () => {
    expect(VAR).toBe('EDMATE_OPENAI_COMPATIBLE_API_KEY');
  });

  it('names the anthropic (main provider) key variable with the EDMATE_ prefix', () => {
    expect(PROVIDER_KEYS.anthropic.apiKey.variable).toBe('EDMATE_ANTHROPIC_API_KEY');
  });

  it('loads both providers through the same door', async () => {
    const anthropic = fakeKey();
    const compatible = fakeKey();
    const keys = await loadProviderKeys({
      source: envKeySource({
        [PROVIDER_KEYS.anthropic.apiKey.variable]: anthropic,
        [VAR]: compatible,
      }),
      required: ['anthropic'],
    });
    expect([...keys.providers()].sort()).toEqual(['anthropic', 'openai-compatible']);
    expect(keys.get('anthropic').apiKey.reveal() === anthropic).toBe(true);
    expect(keys.get('openai-compatible').apiKey.reveal() === compatible).toBe(true);
  });

  it('names the anthropic variable when it is required but missing', async () => {
    const err = await failure(envKeySource({}), ['anthropic']);
    expect(err.problems).toEqual([{ variable: 'EDMATE_ANTHROPIC_API_KEY', problem: 'missing' }]);
  });
});

describe('loadProviderKeys: happy path', () => {
  it('gives typed access to a Secret holding the key', async () => {
    const value = fakeKey();
    const keys = await loadProviderKeys({
      source: envKeySource({ [VAR]: value }),
      required: ['openai-compatible'],
    });
    const apiKey = keys.get('openai-compatible').apiKey;
    expect(apiKey).toBeInstanceOf(Secret);
    expect(apiKey.reveal() === value).toBe(true);
    expect(keys.has('openai-compatible')).toBe(true);
    expect(keys.providers()).toEqual(['openai-compatible']);
  });

  it('returns a frozen object with no prototype', async () => {
    const keys = await loadProviderKeys({
      source: envKeySource({ [VAR]: fakeKey() }),
      required: ['openai-compatible'],
    });
    expect(Object.isFrozen(keys)).toBe(true);
    expect(Object.getPrototypeOf(keys)).toBeNull();
    expect(Object.isFrozen(keys.get('openai-compatible'))).toBe(true);
    expect(Object.isFrozen(keys.providers())).toBe(true);
  });

  it('toJSON and toString name the providers only', async () => {
    const value = fakeKey();
    const keys = await loadProviderKeys({
      source: envKeySource({ [VAR]: value }),
      required: ['openai-compatible'],
    });
    expect(keys.toJSON()).toEqual({ providers: ['openai-compatible'] });
    expect(JSON.stringify(keys)).toBe('{"providers":["openai-compatible"]}');
    expect(String(keys)).toBe('ProviderKeys(openai-compatible)');
    expect(leaks(inspect(keys, { depth: Infinity, showHidden: true }), value)).toBe(false);
  });

  it('loads an optional provider whose key is set and valid', async () => {
    const keys = await loadProviderKeys({
      source: envKeySource({ [VAR]: fakeKey() }),
      required: [],
    });
    expect(keys.has('openai-compatible')).toBe(true);
  });

  it('accepts a key with quotes inside it (only wrapping quotes are a mistake)', async () => {
    const value = 'fake' + '"' + fakeKey() + "'";
    const keys = await loadProviderKeys({
      source: envKeySource({ [VAR]: value }),
      required: ['openai-compatible'],
    });
    expect(keys.get('openai-compatible').apiKey.reveal() === value).toBe(true);
  });
});

describe('loadProviderKeys: optional providers', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('skips an optional provider whose key is %s', async (_label, value) => {
    const keys = await loadProviderKeys({ source: envKeySource({ [VAR]: value }), required: [] });
    expect(keys.has('openai-compatible')).toBe(false);
    expect(keys.providers()).toEqual([]);
    expect(String(keys)).toBe('ProviderKeys()');
  });

  it('fails fast on an optional provider that is set but malformed', async () => {
    const err = await failure(envKeySource({ [VAR]: 'changeme' }), []);
    expect(err.problems).toEqual([{ variable: VAR, problem: 'placeholder' }]);
  });

  it('get() on a provider that was not loaded throws KeyConfigError naming it', async () => {
    const keys = await loadProviderKeys({ source: envKeySource({}), required: [] });
    expect(() => keys.get('openai-compatible')).toThrow(KeyConfigError);
    expect(() => keys.get('openai-compatible')).toThrow('no keys loaded for openai-compatible');
  });
});

// Each case builds its bad value at runtime around a fresh fake key, then checks the error
// names the variable and the problem, and shows no part of the value anywhere.
const problemCases: [string, () => string | undefined][] = [
  ['missing', () => undefined],
  ['empty', () => ''],
  ['empty', () => ' \t\n '],
  ['whitespace', () => ' ' + fakeKey()],
  ['whitespace', () => fakeKey() + '\n'],
  ['whitespace', () => fakeKey() + ' ' + fakeKey()],
  ['quoted', () => '"' + fakeKey() + '"'],
  ['quoted', () => "'" + fakeKey() + "'"],
  ['placeholder', () => 'changeme'],
  ['placeholder', () => 'CHANGE-ME'],
  ['placeholder', () => 'replace-me'],
  ['placeholder', () => 'replace_me'],
  ['placeholder', () => '<your-key>'],
  ['placeholder', () => 'your-' + 'k'.repeat(20)],
  ['placeholder', () => 'YOUR_' + 'k'.repeat(20)],
  ['placeholder', () => 'x'.repeat(20)],
  ['placeholder', () => 'XXX-' + 'x'.repeat(20)],
  ['placeholder', () => 'todo'],
  ['too_short', () => fakeKey().slice(0, 15)],
];

describe('loadProviderKeys: problem codes', () => {
  it.each(problemCases)('reports %s without showing the value', async (problem, make) => {
    const value = make();
    const err = await failure(envKeySource({ [VAR]: value }), ['openai-compatible']);
    expect(err.name).toBe('KeyConfigError');
    expect(err.problems).toEqual([{ variable: VAR, problem }]);
    expect(err.message.includes(VAR)).toBe(true);
    expect(err.message.includes('docker/env.example')).toBe(true);
    if (value !== undefined && value.length >= 8) assertNoLeak(err, value);
  });

  it('a value of exactly 16 characters is long enough', async () => {
    const value = fakeKey().slice(0, 16);
    const keys = await loadProviderKeys({
      source: envKeySource({ [VAR]: value }),
      required: ['openai-compatible'],
    });
    expect(keys.has('openai-compatible')).toBe(true);
  });

  it('treats a non-string value from a source as missing', async () => {
    const source: KeySource = {
      name: 'odd',
      read: async () => ({ [VAR]: 42 as unknown as string }),
    };
    const err = await failure(source, ['openai-compatible']);
    expect(err.problems).toEqual([{ variable: VAR, problem: 'missing' }]);
  });

  it('the message says which problem it is, in words', async () => {
    const err = await failure(envKeySource({}), ['openai-compatible']);
    expect(err.message).toBe(
      'Provider keys are not configured correctly: EDMATE_OPENAI_COMPATIBLE_API_KEY is missing. ' +
        'Set it in the environment or the secret manager (see docker/env.example).',
    );
  });
});

describe('loadProviderKeys: several problems', () => {
  it('collects every problem into one error that lists every variable', async () => {
    const source: KeySource = {
      name: 'test',
      read: async () => ({ [VAR]: undefined }),
    };
    // Require the provider twice: each problem is still reported once per variable.
    const err = await failure(source, ['openai-compatible', 'openai-compatible']);
    expect(err.problems).toEqual([{ variable: VAR, problem: 'missing' }]);
  });

  it('lists several problems and says "them"', async () => {
    // The MVP table has one variable, so an unknown provider id (possible from plain JS) plus
    // a missing key gives two problems in one error.
    const err = await failure(envKeySource({}), ['openai-compatible', 'nope' as ProviderId]);
    expect(err.problems).toEqual([
      { variable: VAR, problem: 'missing' },
      { variable: 'nope', problem: 'unknown_provider' },
    ]);
    expect(err.message.includes('EDMATE_OPENAI_COMPATIBLE_API_KEY is missing')).toBe(true);
    expect(err.message.includes('nope is not a known provider')).toBe(true);
    expect(err.message.includes('Set them')).toBe(true);
  });
});

describe('loadProviderKeys: a failing source', () => {
  it('names the source, drops the original error and leaks nothing', async () => {
    const value = fakeKey();
    const source: KeySource = {
      name: 'vault-test',
      read: () => Promise.reject(new Error(`backend said ${value}`, { cause: value })),
    };
    const err = await failure(source, ['openai-compatible']);
    expect(err.message).toBe('could not read provider keys from vault-test');
    expect(err.problems).toEqual([]);
    assertNoLeak(err, value);
  });

  it('handles a source that throws synchronously', async () => {
    const value = fakeKey();
    const source: KeySource = {
      name: 'sync-thrower',
      read: () => {
        throw new Error(value);
      },
    };
    const err = await failure(source, []);
    expect(err.message).toBe('could not read provider keys from sync-thrower');
    assertNoLeak(err, value);
  });
});

describe('KeyConfigError', () => {
  it('is an Error with a frozen problems list', () => {
    const err = new KeyConfigError('x', [{ variable: VAR, problem: 'missing' }]);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('KeyConfigError');
    expect(Object.isFrozen(err.problems)).toBe(true);
    expect(new KeyConfigError('y').problems).toEqual([]);
  });
});

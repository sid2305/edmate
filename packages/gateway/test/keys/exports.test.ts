import { describe, expect, it } from 'vitest';
import * as gateway from '../../src/index.js';

describe('package exports', () => {
  it('exports the key module and the adapters, and keeps internals internal', () => {
    expect(Object.keys(gateway).sort()).toEqual(
      [
        'ANTHROPIC_CAPABILITIES',
        'GatewayError',
        'KeyConfigError',
        'OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES',
        'PROVIDER_KEYS',
        'Secret',
        'createAnthropicAdapter',
        'createOpenAICompatibleAdapter',
        'envKeySource',
        'loadProviderKeys',
        'mapProviderError',
      ].sort(),
    );
    expect('keyValueSchema' in gateway).toBe(false);
    expect('createSdkAdapter' in gateway).toBe(false);
  });
});

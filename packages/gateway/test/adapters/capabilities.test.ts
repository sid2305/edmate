// Each adapter declares the full capability shape the router (task 2.3) reads.
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_CAPABILITIES, createAnthropicAdapter } from '../../src/adapters/anthropic.js';
import {
  OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
  createOpenAICompatibleAdapter,
} from '../../src/adapters/openai-compatible.js';
import type { AdapterCapabilities } from '../../src/adapters/types.js';
import { Secret } from '../../src/keys/secret.js';
import { fakeKey } from '../helpers/fake-key.js';

const FLAGS = ['tools', 'streaming', 'json', 'vision', 'embeddings'] as const;

function expectFullShape(c: AdapterCapabilities): void {
  expect(Object.keys(c).sort()).toEqual([...FLAGS, 'maxContextTokens'].sort());
  for (const flag of FLAGS) expect(typeof c[flag]).toBe('boolean');
  expect(Number.isSafeInteger(c.maxContextTokens) && c.maxContextTokens > 0).toBe(true);
}

describe('capabilities', () => {
  it('anthropic: fixed, frozen, no embeddings', () => {
    const adapter = createAnthropicAdapter({ apiKey: Secret.of(fakeKey()) }, { model: 'm' });
    expectFullShape(adapter.capabilities);
    expect(adapter.capabilities).toEqual(ANTHROPIC_CAPABILITIES);
    expect(adapter.capabilities.embeddings).toBe(false);
    expect(Object.isFrozen(ANTHROPIC_CAPABILITIES)).toBe(true);
  });

  it('openai-compatible: conservative defaults, overridable per deployment', () => {
    const keys = { apiKey: Secret.of(fakeKey()) };
    const plain = createOpenAICompatibleAdapter(keys, {
      model: 'm',
      baseURL: 'https://compatible.example.invalid/v1',
    });
    expectFullShape(plain.capabilities);
    expect(plain.capabilities).toEqual({
      ...OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
      embeddings: false,
    });
    expect(plain.capabilities.vision).toBe(false);
    expect(Object.isFrozen(OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES)).toBe(true);

    const raised = createOpenAICompatibleAdapter(keys, {
      model: 'm',
      baseURL: 'https://compatible.example.invalid/v1',
      embeddingModel: 'e',
      capabilities: { tools: false, maxContextTokens: 200_000 },
    });
    expectFullShape(raised.capabilities);
    expect(raised.capabilities).toMatchObject({
      tools: false,
      embeddings: true,
      maxContextTokens: 200_000,
    });
  });
});

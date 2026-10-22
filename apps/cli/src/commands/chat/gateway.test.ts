import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KeyConfigError, type ModelAdapter } from '@edmate/gateway';
import { createChatGateway, gatewayFor, meterSinkFor } from './gateway.js';

const fakeKey = () => 'fake-' + randomBytes(24).toString('hex');

describe('createChatGateway (builds an adapter factory only; no call is made)', () => {
  it('builds an Anthropic adapter for any model the policy names', async () => {
    const key = fakeKey();
    const factories = await createChatGateway({ EDMATE_ANTHROPIC_API_KEY: key });
    const adapter = factories.anthropic?.('claude-haiku-4-5') as ModelAdapter;
    expect(adapter.id).toBe('anthropic');
    expect(adapter.model).toBe('claude-haiku-4-5');
  });

  it('fails with the key loader error when the key is missing, and never echoes a key value', async () => {
    const decoy = fakeKey();
    try {
      await createChatGateway({ EDMATE_SOME_OTHER_VAR: decoy });
      throw new Error('expected createChatGateway to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(KeyConfigError);
      expect(String((e as Error).message)).not.toContain(decoy);
    }
  });
});

describe('createChatGateway with an openai-compatible candidate (task 7.6a)', () => {
  it('builds both factories when baseURL is given, keeping the anthropic one unchanged', async () => {
    const factories = await createChatGateway(
      { EDMATE_ANTHROPIC_API_KEY: fakeKey(), EDMATE_OPENAI_COMPATIBLE_API_KEY: fakeKey() },
      { baseURL: 'https://example.com/v1' },
    );
    const anthropic = factories.anthropic?.('claude-haiku-4-5') as ModelAdapter;
    expect(anthropic.id).toBe('anthropic');
    const compatible = factories['openai-compatible']?.('some-model') as ModelAdapter;
    expect(compatible.id).toBe('openai-compatible');
    expect(compatible.model).toBe('some-model');
  });

  it('never builds the openai-compatible factory when baseURL is absent', async () => {
    const factories = await createChatGateway({ EDMATE_ANTHROPIC_API_KEY: fakeKey() });
    expect(factories['openai-compatible']).toBeUndefined();
  });

  it('fails with the key loader error when the openai-compatible key is missing', async () => {
    try {
      await createChatGateway(
        { EDMATE_ANTHROPIC_API_KEY: fakeKey() },
        { baseURL: 'https://example.com/v1' },
      );
      throw new Error('expected createChatGateway to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(KeyConfigError);
    }
  });
});

describe('gatewayFor', () => {
  it('builds a metered gateway for a policy, billed to the entitlement', async () => {
    const factories = await createChatGateway({ EDMATE_ANTHROPIC_API_KEY: fakeKey() });
    const sink = meterSinkFor(
      () => Promise.resolve(),
      () => Promise.resolve(),
    );
    const build = gatewayFor({ factories, sink });
    const tg = build({
      policy: { tiers: { small: { provider: 'anthropic', model: 'm1' }, main: { provider: 'anthropic', model: 'm2' } } },
      billing: { teacherId: 't', packageId: 'p', studentId: 's', turnId: 'turn_1', source: 'teacher_preview' },
    });
    expect(tg.metered).toBe(true);
    expect(typeof tg.gateway.stream).toBe('function');
    expect(typeof tg.gateway.generateObject).toBe('function');
    expect(typeof tg.gateway.embed).toBe('function');
  });
});

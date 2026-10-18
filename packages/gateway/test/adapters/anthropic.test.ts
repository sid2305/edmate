import { describe, expect, it } from 'vitest';
import { ANTHROPIC_CAPABILITIES, createAnthropicAdapter } from '../../src/adapters/anthropic.js';
import { Secret } from '../../src/keys/secret.js';
import { anthropicFixtures } from '../fixtures/anthropic.js';
import { fakeKey } from '../helpers/fake-key.js';
import { fetchMock } from '../helpers/fetch-mock.js';
import { baseRequest, collect, runContractSuite } from './contract-suite.js';

const MODEL = 'claude-sonnet-4-5';

runContractSuite({
  name: 'anthropic',
  build: (keys, fetch) => createAnthropicAdapter(keys, { model: MODEL, fetch }),
  fixtures: anthropicFixtures,
  capabilities: ANTHROPIC_CAPABILITIES,
  sentKey: (headers, key) => headers['x-api-key'] === key,
});

describe('anthropic: provider specifics', () => {
  it('authenticates with x-api-key and anthropic-version, never a Bearer header', async () => {
    const key = fakeKey();
    const mock = fetchMock([anthropicFixtures.textStream]);
    const adapter = createAnthropicAdapter(
      { apiKey: Secret.of(key) },
      { model: MODEL, fetch: mock.fetch },
    );
    await collect(adapter.stream(baseRequest));
    const { headers, url, body } = mock.requests[0]!;
    expect(headers['x-api-key'] === key).toBe(true);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect('authorization' in headers).toBe(false);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(body)).toMatchObject({ model: MODEL, stream: true, max_tokens: 256 });
  });

  it('is bound to its model and provider id', () => {
    const adapter = createAnthropicAdapter(
      { apiKey: Secret.of(fakeKey()) },
      { model: MODEL, fetch: fetchMock([]).fetch },
    );
    expect(adapter.id).toBe('anthropic');
    expect(adapter.model).toBe(MODEL);
  });
});

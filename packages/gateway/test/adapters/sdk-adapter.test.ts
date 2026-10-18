// Behaviour shared by every adapter that the fixture contract does not pin down: tool-name
// mapping, missing usage, optional settings and the default transport.
import { describe, expect, it } from 'vitest';
import { createAnthropicAdapter } from '../../src/adapters/anthropic.js';
import { createOpenAICompatibleAdapter } from '../../src/adapters/openai-compatible.js';
import { Secret } from '../../src/keys/secret.js';
import { fakeKey } from '../helpers/fake-key.js';
import { fetchMock, sse } from '../helpers/fetch-mock.js';
import { baseRequest, caught, collect } from './contract-suite.js';

const BASE_URL = 'https://compatible.example.invalid/v1';

const chunk = (delta: unknown, finishReason: string | null = null) =>
  [
    undefined,
    {
      id: 'c',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'm',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    },
  ] as const;

function adapterWith(body: string) {
  const mock = fetchMock([{ body }]);
  const adapter = createOpenAICompatibleAdapter(
    { apiKey: Secret.of(fakeKey()) },
    { model: 'm', baseURL: BASE_URL, fetch: mock.fetch },
  );
  return { adapter, mock };
}

const schema = { type: 'object', properties: {} };

describe('tool names', () => {
  it('are made provider-safe, kept unique and mapped back', async () => {
    const long = 'x'.repeat(70);
    const { adapter, mock } = adapterWith(
      sse([
        chunk({
          tool_calls: [
            { index: 0, id: 't1', type: 'function', function: { name: 'a_b_2', arguments: '{}' } },
          ],
        }),
        chunk({
          tool_calls: [
            {
              index: 1,
              id: 't2',
              type: 'function',
              function: { name: `${'x'.repeat(62)}_2`, arguments: '{}' },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
        [undefined, '[DONE]'],
      ]),
    );
    const chunks = await collect(
      adapter.stream({
        ...baseRequest,
        tools: [
          { name: 'a.b', description: 'first', inputSchema: schema },
          { name: 'a_b', description: 'second', inputSchema: schema },
          { name: long, description: 'third', inputSchema: schema },
          { name: `${long}y`, description: 'fourth', inputSchema: schema },
        ],
      }),
    );
    const sent = JSON.parse(mock.requests[0]!.body) as {
      tools: { function: { name: string } }[];
    };
    expect(sent.tools.map((t) => t.function.name)).toEqual([
      'a_b',
      'a_b_2',
      'x'.repeat(64),
      `${'x'.repeat(62)}_2`,
    ]);
    expect(chunks.filter((c) => c.type === 'tool_call')).toEqual([
      { type: 'tool_call', id: 't1', name: 'a_b', args: {} },
      { type: 'tool_call', id: 't2', name: `${long}y`, args: {} },
    ]);
  });

  it('an empty tool list offers no tools', async () => {
    const { adapter, mock } = adapterWith(
      sse([chunk({ content: 'ok' }), chunk({}, 'stop'), [undefined, '[DONE]']]),
    );
    await collect(adapter.stream({ ...baseRequest, tools: [] }));
    expect('tools' in JSON.parse(mock.requests[0]!.body)).toBe(false);
  });
});

describe('stream details', () => {
  it('reports zero tokens when the provider sends no usage, and no empty text chunks', async () => {
    const { system, messages, maxOutputTokens } = baseRequest;
    const { adapter, mock } = adapterWith(
      sse([
        chunk({ content: '' }),
        chunk({ content: 'hi' }),
        chunk({}, 'stop'),
        [undefined, '[DONE]'],
      ]),
    );
    const chunks = await collect(
      adapter.stream({ tier: 'small', system, messages, maxOutputTokens }),
    );
    expect(chunks).toEqual([
      { type: 'text', text: 'hi' },
      {
        type: 'usage',
        usage: { model: 'm', tier: 'small', inputTokens: 0, outputTokens: 0, costMicroUsd: 0 },
      },
    ]);
    // No temperature in the request means none is sent.
    expect('temperature' in JSON.parse(mock.requests[0]!.body)).toBe(false);
  });

  it('a body that is not an event stream is a provider error', async () => {
    const mock = fetchMock([{ body: 'not json', contentType: 'text/event-stream' }]);
    const adapter = createOpenAICompatibleAdapter(
      { apiKey: Secret.of(fakeKey()) },
      { model: 'm', baseURL: BASE_URL, fetch: mock.fetch },
    );
    const err = await caught(collect(adapter.stream(baseRequest)));
    expect(err.code).toBe('provider_error');
  });
});

describe('default transport', () => {
  it('without a fetch override the adapters use the global fetch (off in tests)', async () => {
    const anthropic = createAnthropicAdapter({ apiKey: Secret.of(fakeKey()) }, { model: 'm' });
    const compatible = createOpenAICompatibleAdapter(
      { apiKey: Secret.of(fakeKey()) },
      { model: 'm', baseURL: BASE_URL },
    );
    for (const adapter of [anthropic, compatible]) {
      const err = await caught(collect(adapter.stream(baseRequest)));
      expect(err.code).toBe('provider_error');
    }
  });
});

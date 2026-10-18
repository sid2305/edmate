import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
  createOpenAICompatibleAdapter,
} from '../../src/adapters/openai-compatible.js';
import { Secret } from '../../src/keys/secret.js';
import { openAICompatibleFixtures } from '../fixtures/openai-compatible.js';
import { fakeKey, leaks } from '../helpers/fake-key.js';
import { fetchMock } from '../helpers/fetch-mock.js';
import { baseRequest, collect, runContractSuite } from './contract-suite.js';

const MODEL = 'vendor/chat-model';
const EMBED_MODEL = 'vendor/embed-model';
// A reserved, unresolvable domain: even a mistake could not reach a real server.
const BASE_URL = 'https://compatible.example.invalid/api/v1';

const sentKey = (headers: Readonly<Record<string, string>>, key: string) =>
  headers['authorization'] === `Bearer ${key}`;

runContractSuite({
  name: 'openai-compatible (chat only)',
  build: (keys, fetch) =>
    createOpenAICompatibleAdapter(keys, { model: MODEL, baseURL: BASE_URL, fetch }),
  fixtures: openAICompatibleFixtures,
  capabilities: { ...OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES, embeddings: false },
  sentKey,
});

runContractSuite({
  name: 'openai-compatible (with embeddings and raised capabilities)',
  build: (keys, fetch) =>
    createOpenAICompatibleAdapter(keys, {
      model: MODEL,
      baseURL: BASE_URL,
      embeddingModel: EMBED_MODEL,
      capabilities: { vision: true, maxContextTokens: 128_000 },
      structuredOutputs: true,
      fetch,
    }),
  fixtures: openAICompatibleFixtures,
  capabilities: {
    tools: true,
    streaming: true,
    json: true,
    vision: true,
    embeddings: true,
    maxContextTokens: 128_000,
  },
  sentKey,
});

describe('openai-compatible: provider specifics', () => {
  it('sends a Bearer key to the configured base URL, never a default OpenAI URL', async () => {
    const key = fakeKey();
    const mock = fetchMock([
      openAICompatibleFixtures.textStream,
      openAICompatibleFixtures.embeddings!,
    ]);
    const adapter = createOpenAICompatibleAdapter(
      { apiKey: Secret.of(key) },
      { model: MODEL, baseURL: BASE_URL, embeddingModel: EMBED_MODEL, fetch: mock.fetch },
    );
    await collect(adapter.stream(baseRequest));
    await adapter.embed(['a', 'b']);
    expect(mock.requests.map((r) => r.url)).toEqual([
      `${BASE_URL}/chat/completions`,
      `${BASE_URL}/embeddings`,
    ]);
    for (const r of mock.requests) {
      expect(sentKey(r.headers, key)).toBe(true);
      expect('x-api-key' in r.headers).toBe(false);
      expect(r.url.includes('api.openai.com')).toBe(false);
    }
    expect(JSON.parse(mock.requests[0]!.body)).toMatchObject({
      model: MODEL,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(JSON.parse(mock.requests[1]!.body)).toMatchObject({ model: EMBED_MODEL });
  });

  it('asks for a JSON schema only when the backend enforces one', async () => {
    const bodies: unknown[] = [];
    for (const structuredOutputs of [undefined, true]) {
      const mock = fetchMock([openAICompatibleFixtures.object]);
      const adapter = createOpenAICompatibleAdapter(
        { apiKey: Secret.of(fakeKey()) },
        {
          model: MODEL,
          baseURL: BASE_URL,
          ...(structuredOutputs === undefined ? {} : { structuredOutputs }),
          fetch: mock.fetch,
        },
      );
      await adapter.generateObject(baseRequest, z.strictObject({ answer: z.number() }));
      bodies.push(JSON.parse(mock.requests[0]!.body).response_format.type);
    }
    expect(bodies).toEqual(['json_object', 'json_schema']);
  });

  it('requires an https base URL, except for a server on this machine', () => {
    const keys = { apiKey: Secret.of(fakeKey()) };
    const build = (baseURL: string) => () =>
      createOpenAICompatibleAdapter(keys, { model: MODEL, baseURL });
    for (const bad of [
      'http://compatible.example.invalid/v1',
      'ftp://compatible.example.invalid/v1',
      'http://localhost.example.invalid/v1',
      'not a url',
      '',
    ]) {
      expect(build(bad)).toThrow(
        'openai-compatible: baseURL must be an https URL (http is allowed only for localhost, 127.0.0.1 or ::1)',
      );
    }
    for (const ok of [
      BASE_URL,
      'http://localhost:11434/v1',
      'http://127.0.0.1:8000/v1',
      'http://[::1]:8000/v1',
    ]) {
      expect(build(ok)).not.toThrow();
    }
  });

  it('the base URL error never echoes the value', () => {
    const secretish = `https${fakeKey()}`;
    try {
      createOpenAICompatibleAdapter(
        { apiKey: Secret.of(fakeKey()) },
        { model: MODEL, baseURL: `http://${secretish}.example.invalid` },
      );
      throw new Error('expected a throw');
    } catch (err) {
      expect(leaks(String((err as Error).message) + String((err as Error).stack), secretish)).toBe(
        false,
      );
    }
  });

  it('cannot declare embeddings without an embedding model', () => {
    const adapter = createOpenAICompatibleAdapter(
      { apiKey: Secret.of(fakeKey()) },
      {
        model: MODEL,
        baseURL: BASE_URL,
        // A caller that forces the flag through a cast still gets the truth.
        capabilities: { embeddings: true } as never,
        fetch: fetchMock([]).fetch,
      },
    );
    expect(adapter.capabilities.embeddings).toBe(false);
    expect(adapter.id).toBe('openai-compatible');
    expect(adapter.model).toBe(MODEL);
  });
});

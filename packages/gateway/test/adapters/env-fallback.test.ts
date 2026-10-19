// Acceptance-critical (decision log, 18 Oct 2026, "2.1 Review"): the SDKs' own env defaults
// (ANTHROPIC_API_KEY, OPENAI_API_KEY and the base-URL variables) are never read and never
// sent. Adapters always pass the key from the Secret and an explicit base URL.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAnthropicAdapter } from '../../src/adapters/anthropic.js';
import { createOpenAICompatibleAdapter } from '../../src/adapters/openai-compatible.js';
import { createEmbeddingAdapter } from '../../src/embedding/config.js';
import { createWhisperTranscriber } from '../../src/transcriber/whisper.js';
import type { ModelAdapter } from '../../src/adapters/types.js';
import { Secret } from '../../src/keys/secret.js';
import { anthropicFixtures } from '../fixtures/anthropic.js';
import type { ContractFixtures } from '../fixtures/contract.js';
import { openAICompatibleFixtures } from '../fixtures/openai-compatible.js';
import { mp3 } from '../fixtures/transcriber/audio.js';
import { whisperOk, whisperRateLimited } from '../fixtures/transcriber/whisper.js';
import { fakeKey, leaks } from '../helpers/fake-key.js';
import { type FetchMock, fetchMock } from '../helpers/fetch-mock.js';
import { baseRequest, collect } from './contract-suite.js';

const WATCHED = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
] as const;

let sentinels: Record<string, string>;
let reads: string[];
let realEnv: NodeJS.ProcessEnv;
let globalFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Built at runtime, never literals; each distinct so a leak names its source.
  sentinels = Object.fromEntries(WATCHED.map((name) => [name, `sentinel-${fakeKey()}`]));
  for (const name of WATCHED) {
    vi.stubEnv(
      name,
      name.endsWith('_URL') ? `https://${sentinels[name]}.invalid/v1` : sentinels[name]!,
    );
  }
  reads = [];
  realEnv = process.env;
  const watched = new Set<string | symbol>(WATCHED);
  const note = (prop: string | symbol) => {
    if (watched.has(prop)) reads.push(String(prop));
  };
  process.env = new Proxy(realEnv, {
    get(target, prop, receiver) {
      note(prop);
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      note(prop);
      return Reflect.has(target, prop);
    },
    getOwnPropertyDescriptor(target, prop) {
      note(prop);
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });
  globalFetch = vi.fn(() => Promise.reject(new Error('global fetch must not be used')));
  vi.stubGlobal('fetch', globalFetch);
});

afterEach(() => {
  process.env = realEnv;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

interface Target {
  name: string;
  build: (key: string, fetch: FetchMock['fetch']) => ModelAdapter;
  fixtures: ContractFixtures;
  sentKey: (headers: Readonly<Record<string, string>>, key: string) => boolean;
}

const targets: Target[] = [
  {
    name: 'anthropic',
    build: (key, fetch) =>
      createAnthropicAdapter({ apiKey: Secret.of(key) }, { model: 'claude-sonnet-4-5', fetch }),
    fixtures: anthropicFixtures,
    sentKey: (h, key) => h['x-api-key'] === key,
  },
  {
    name: 'openai-compatible',
    build: (key, fetch) =>
      createOpenAICompatibleAdapter(
        { apiKey: Secret.of(key) },
        {
          model: 'vendor/chat-model',
          baseURL: 'https://compatible.example.invalid/v1',
          embeddingModel: 'vendor/embed-model',
          fetch,
        },
      ),
    fixtures: openAICompatibleFixtures,
    sentKey: (h, key) => h['authorization'] === `Bearer ${key}`,
  },
];

describe('SDK env defaults are never read or sent', () => {
  for (const t of targets) {
    it(`${t.name}: stream, generateObject, embed and an error path use only the Secret`, async () => {
      const key = fakeKey();
      const f = t.fixtures;
      const mock = fetchMock([
        f.textStream,
        f.object,
        ...(f.embeddings === undefined ? [] : [f.embeddings]),
        f.rateLimited,
      ]);
      const adapter = t.build(key, mock.fetch);
      const texts: string[] = [];

      await collect(adapter.stream(baseRequest));
      await adapter.generateObject(baseRequest, z.strictObject({ answer: z.number() }));
      if (adapter.capabilities.embeddings) await adapter.embed(['a', 'b']);
      try {
        await collect(adapter.stream(baseRequest));
      } catch (err) {
        texts.push(
          String((err as Error).message),
          String((err as Error).stack),
          JSON.stringify(err),
        );
      }

      expect(reads).toEqual([]);
      expect(globalFetch).not.toHaveBeenCalled();
      expect(mock.requests.length >= 3).toBe(true);
      for (const r of mock.requests) expect(t.sentKey(r.headers, key)).toBe(true);
      const corpus = [mock.corpus(), ...texts].join('\n');
      for (const name of WATCHED) expect(leaks(corpus, sentinels[name]!)).toBe(false);
      expect(texts.length).toBe(3); // the error path really ran
      for (const text of texts) expect(leaks(text, key)).toBe(false);
    });
  }

  // Task 2.7: the OpenAI key (Whisper and the platform embedding model) has the same discipline.
  it('openai: Whisper transcription (success and an error) and embeddings use only the Secret', async () => {
    const key = fakeKey();
    const mock = fetchMock([
      { body: mp3(2) },
      whisperOk,
      { body: mp3(2) },
      whisperRateLimited,
      openAICompatibleFixtures.embeddings!,
    ]);
    const t = createWhisperTranscriber(
      { apiKey: Secret.of(key) },
      { allowedHosts: ['storage.edmate.invalid'], fetch: mock.fetch },
    );
    const input = { url: 'https://storage.edmate.invalid/r.mp3?sig=fake0', mimeType: 'audio/mpeg' };
    const texts: string[] = [];
    await t.transcribe(input);
    try {
      await t.transcribe(input);
    } catch (err) {
      texts.push(String((err as Error).message), String((err as Error).stack), JSON.stringify(err));
    }
    const embedder = createEmbeddingAdapter(
      { apiKey: Secret.of(key) },
      {
        fetch: mock.fetch,
        config: { baseURL: 'https://api.openai.invalid/v1', model: 'm', dimension: 3 },
      },
    );
    await embedder.embed(['a', 'b']);

    expect(reads).toEqual([]);
    expect(globalFetch).not.toHaveBeenCalled();
    const sent = mock.requests.filter((r) => !r.url.startsWith('https://storage.edmate.invalid/'));
    expect(sent).toHaveLength(3);
    for (const r of sent) expect(r.headers['authorization'] === `Bearer ${key}`).toBe(true);
    // Whisper goes to OpenAI itself, never to a base URL from the environment.
    expect(new URL(sent[0]!.url).host).toBe('api.openai.com');
    const corpus = [mock.corpus(), ...texts].join('\n');
    for (const name of WATCHED) expect(leaks(corpus, sentinels[name]!)).toBe(false);
    expect(texts.length).toBe(3);
    for (const text of texts) expect(leaks(text, key)).toBe(false);
  });

  it('the proxy really sees env reads (the check above is not vacuous)', () => {
    expect(process.env['ANTHROPIC_API_KEY'] === sentinels['ANTHROPIC_API_KEY']).toBe(true);
    expect('OPENAI_API_KEY' in process.env).toBe(true);
    expect(reads).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
  });
});

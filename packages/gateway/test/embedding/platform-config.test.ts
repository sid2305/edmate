// Task 2.7: the platform-wide embedding model. One config (text-embedding-3-small, 1536 numbers)
// builds an embeddings-only adapter on the OpenAI-compatible path; every vector it returns has
// exactly the configured size, and it meters through 2.4's unmodified meterAdapter.
import { describe, expect, it } from 'vitest';
import { GatewayError } from '../../src/adapters/errors.js';
import { createEmbeddingAdapter, EMBEDDING_CONFIG } from '../../src/embedding/config.js';
import { Secret } from '../../src/keys/secret.js';
import { createMeter, meterAdapter, type UnmeteredUsage } from '../../src/metering/index.js';
import { parsePriceTable } from '../../src/pricing/index.js';
import { fakeKey } from '../helpers/fake-key.js';
import { type FakeResponse, fetchMock } from '../helpers/fetch-mock.js';
import { req } from '../router/fake-adapter.js';

const vector = (n: number, seed = 1) =>
  Array.from({ length: n }, (_, i) => ((i * seed) % 11) / 10 - 0.5);

function embeddings(vectors: readonly number[][]): FakeResponse {
  return {
    body: JSON.stringify({
      object: 'list',
      data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 4, total_tokens: 4 },
    }),
  };
}

function build(responses: readonly FakeResponse[], config = EMBEDDING_CONFIG) {
  const key = fakeKey();
  const mock = fetchMock(responses);
  const adapter = createEmbeddingAdapter({ apiKey: Secret.of(key) }, { fetch: mock.fetch, config });
  return { adapter, mock, key };
}

describe('EMBEDDING_CONFIG', () => {
  it('is text-embedding-3-small at 1536 dimensions on OpenAI, and frozen', () => {
    const url = new URL(EMBEDDING_CONFIG.baseURL);
    expect([url.protocol, url.host, url.pathname]).toEqual(['https:', 'api.openai.com', '/v1']);
    expect(EMBEDDING_CONFIG.model).toBe('text-embedding-3-small');
    expect(EMBEDDING_CONFIG.dimension).toBe(1536);
    expect(Object.isFrozen(EMBEDDING_CONFIG)).toBe(true);
  });
});

describe('createEmbeddingAdapter', () => {
  it('serves vectors of the configured dimension from the configured model', async () => {
    const vs = [vector(1536, 1), vector(1536, 3)];
    const { adapter, mock, key } = build([embeddings(vs)]);
    expect(await adapter.embed(['compound interest', 'simple interest'])).toEqual(vs);

    const [r] = mock.requests;
    expect(new URL(r!.url).host).toBe('api.openai.com');
    expect(new URL(r!.url).pathname).toBe('/v1/embeddings');
    expect(r?.headers['authorization'] === `Bearer ${key}`).toBe(true);
    expect(JSON.parse(r!.body)).toMatchObject({
      model: 'text-embedding-3-small',
      input: ['compound interest', 'simple interest'],
    });
    expect(adapter.id).toBe('openai-compatible');
    expect(adapter.model).toBe('text-embedding-3-small');
    expect(adapter.capabilities).toEqual({
      tools: false,
      streaming: false,
      json: false,
      vision: false,
      embeddings: true,
      maxContextTokens: 8_191,
    });
    expect(Object.isFrozen(adapter)).toBe(true);
  });

  it('defaults to EMBEDDING_CONFIG and the global fetch (which rule 4 turns off here)', async () => {
    const adapter = createEmbeddingAdapter({ apiKey: Secret.of(fakeKey()) });
    expect(adapter.model).toBe(EMBEDDING_CONFIG.model);
    const err = (await adapter.embed(['a']).catch((e: unknown) => e)) as GatewayError;
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe('provider_error');
  });

  it('no texts is no vectors and no request', async () => {
    const { adapter, mock } = build([]);
    expect(await adapter.embed([])).toEqual([]);
    expect(mock.requests).toHaveLength(0);
  });

  it.each([
    ['a shorter vector', [vector(1536), vector(1535)]],
    ['a longer vector', [vector(1537), vector(1536)]],
  ])('never returns %s: it fails as validation', async (_n, vs) => {
    const { adapter } = build([embeddings(vs)]);
    const err = await adapter.embed(['a', 'b']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).code).toBe('validation');
    expect((err as GatewayError).message).toBe(
      'openai-compatible: embeddings did not come back as 2 vectors of 1536 numbers',
    );
  });

  it('one vector for two texts is refused (by the SDK), never returned short', async () => {
    const { adapter } = build([embeddings([vector(1536)])]);
    await expect(adapter.embed(['a', 'b'])).rejects.toBeInstanceOf(GatewayError);
  });

  it('a smaller configured dimension is checked the same way', async () => {
    const { adapter } = build([embeddings([[0.1, 0.2]]), embeddings([[0.1, 0.2, 0.3]])], {
      ...EMBEDDING_CONFIG,
      dimension: 2,
    });
    expect(await adapter.embed(['a'])).toEqual([[0.1, 0.2]]);
    const err = (await adapter.embed(['a']).catch((e: unknown) => e)) as GatewayError;
    expect(err.message).toBe(
      'openai-compatible: embeddings did not come back as 1 vectors of 2 numbers',
    );
  });

  it('provider errors keep the gateway mapping', async () => {
    const { adapter } = build([{ status: 429, body: '{"error":{"message":"slow down"}}' }]);
    const err = (await adapter.embed(['a']).catch((e: unknown) => e)) as GatewayError;
    expect(err.code).toBe('rate_limited');
    expect(err.retryable).toBe(true);
  });

  it('refuses chat: stream and generateObject throw before any request', async () => {
    const { adapter, mock } = build([]);
    const it = adapter.stream(req())[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toThrow(
      'openai-compatible: the embedding adapter does not serve chat',
    );
    await expect(adapter.generateObject(req(), {} as never)).rejects.toBeInstanceOf(GatewayError);
    expect(mock.requests).toHaveLength(0);
  });

  it('meters through the unmodified meterAdapter: one unknown row per embed call', async () => {
    const flagged: UnmeteredUsage[] = [];
    const meter = createMeter(
      {
        record: () => Promise.resolve(),
        recordUnmetered: (u) => {
          flagged.push(u);
          return Promise.resolve();
        },
      },
      { teacherId: 't', packageId: 'p', studentId: 's', turnId: 'job', source: 'teacher_preview' },
      parsePriceTable('{}'),
    );
    const { adapter } = build([embeddings([vector(1536)]), { status: 500, body: '{}' }]);
    const metered = meterAdapter(adapter, meter);
    await metered.embed(['a']);
    await metered.embed(['b']).catch(() => undefined);
    await meter.settled();
    expect(flagged.map((f) => [f.model, f.reason])).toEqual([
      ['text-embedding-3-small', 'no_usage_reported'],
      ['text-embedding-3-small', 'no_usage_reported'],
    ]);
  });
});

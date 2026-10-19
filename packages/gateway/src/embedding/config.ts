// The platform-wide embedding model (task 2.7). One model for every teacher's material, because
// chunks.embedding has one fixed dimension (vector(1536), packages/db migration 0006) and vectors
// from different models cannot be compared. Provisional until 7.6's cost and eval pass; changing
// it means a db migration and re-embedding every chunk.
//
// Embeddings are served by their own adapter, not by the Router that answers turns: ingestion
// (5.1-5.3) calls `createEmbeddingAdapter(keys).embed(...)`, metered through
// `meterAdapter(adapter, meter)` like any other adapter (2.4).
import type { ModelRequest } from '@edmate/contracts';
import { GatewayError } from '../adapters/errors.js';
import {
  createOpenAICompatibleAdapter,
  type OpenAICompatibleAdapterOptions,
} from '../adapters/openai-compatible.js';
import type { ModelAdapter } from '../adapters/types.js';
import type { KeysFor } from '../keys/providers.js';

export interface EmbeddingConfig {
  readonly baseURL: string;
  readonly model: string;
  /** Every vector the model returns has exactly this many numbers. */
  readonly dimension: number;
}

export const EMBEDDING_CONFIG: EmbeddingConfig = Object.freeze({
  baseURL: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimension: 1536,
});

export interface EmbeddingAdapterOptions {
  /** Defaults to EMBEDDING_CONFIG; only tests and a deliberate migration change it. */
  readonly config?: EmbeddingConfig;
  /** Transport override (tests pass a fake; production uses the global fetch). */
  readonly fetch?: OpenAICompatibleAdapterOptions['fetch'];
}

/**
 * An embeddings-only adapter on the OpenAI-compatible path, using the `openai` key (the same
 * OpenAI account as Whisper). `stream` and `generateObject` refuse: this instance is never a
 * chat model. `embed` checks every vector's size, so a wrong-sized vector never reaches the db.
 */
export function createEmbeddingAdapter(
  keys: KeysFor<'openai'>,
  opts: EmbeddingAdapterOptions = {},
): ModelAdapter {
  const config = opts.config ?? EMBEDDING_CONFIG;
  const inner = createOpenAICompatibleAdapter(keys, {
    model: config.model,
    baseURL: config.baseURL,
    embeddingModel: config.model,
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
  });
  const id = inner.id;
  const refuse = (): GatewayError =>
    new GatewayError(
      'provider_error',
      false,
      id,
      `${id}: the embedding adapter does not serve chat`,
    );

  return Object.freeze({
    id,
    model: config.model,
    capabilities: Object.freeze({
      tools: false,
      streaming: false,
      json: false,
      vision: false,
      embeddings: true,
      maxContextTokens: 8_191,
    }),
    // eslint-disable-next-line require-yield -- refuses before producing anything
    async *stream(_req: ModelRequest): AsyncGenerator<never> {
      throw refuse();
    },
    generateObject<T>(): Promise<T> {
      return Promise.reject(refuse());
    },
    async embed(texts: string[]): Promise<number[][]> {
      const vectors = await inner.embed(texts);
      const ok =
        vectors.length === texts.length &&
        vectors.every((v) => v.length === config.dimension && v.every((n) => Number.isFinite(n)));
      if (!ok) {
        throw new GatewayError(
          'validation',
          false,
          id,
          `${id}: embeddings did not come back as ${String(texts.length)} vectors of ${String(config.dimension)} numbers`,
        );
      }
      return vectors;
    },
  });
}

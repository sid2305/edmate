// Task 8.2 Phase 2: the real embedder and transcriber the ingest processor writes with, composed
// once at process start exactly as `packages/db/scripts/record-demo-embeddings.ts` already does —
// no new provider wiring invented here. The transcriber's host allowlist (ADR-0005) is the
// configured S3 host only: a recording is always a signed GET URL to Edmate's own bucket.
import type { ModelGateway, Transcriber } from '@edmate/contracts';
import {
  createEmbeddingAdapter,
  createWhisperTranscriber,
  envKeySource,
  loadProviderKeys,
} from '@edmate/gateway';
import { storageConfigFromEnv } from '../storage/roundtrip.js';

export interface IngestGateway {
  /** Absent when `EDMATE_INGEST_EMBEDDINGS=off`: chunks are stored for full text only (D3). */
  readonly embedder?: Pick<ModelGateway, 'embed'>;
  /** Absent when `EDMATE_INGEST_EMBEDDINGS=off`: audio/video jobs fail as `unsupported`. */
  readonly transcriber?: Transcriber;
}

/** Task 9.0 D3: `off`, unset or `openai`, or a config error naming the variable (never its value,
 * so a typo never reaches a log line). */
const INGEST_EMBEDDINGS_ENV = 'EDMATE_INGEST_EMBEDDINGS';

/**
 * Reads the OpenAI key and the configured S3 host from `env`; throws if the key is unusable.
 * `EDMATE_INGEST_EMBEDDINGS=off` skips both the embedder and the transcriber and reads no key at
 * all -- explicit, never a silent fallback when a key happens to be missing (9.0 D3).
 */
export async function createIngestGateway(
  env: Readonly<Record<string, string | undefined>>,
): Promise<IngestGateway> {
  const mode = env[INGEST_EMBEDDINGS_ENV];
  if (mode === 'off') return {};
  if (mode !== undefined && mode !== 'openai') {
    throw new Error(`createIngestGateway: ${INGEST_EMBEDDINGS_ENV} is not a supported value`);
  }
  const keys = await loadProviderKeys({ source: envKeySource(env), required: ['openai'] });
  const openaiKeys = keys.get('openai');
  const s3Host = new URL(storageConfigFromEnv(env).endpoint).host;
  return {
    embedder: createEmbeddingAdapter(openaiKeys),
    transcriber: createWhisperTranscriber(openaiKeys, { allowedHosts: [s3Host] }),
  };
}

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
  readonly embedder: Pick<ModelGateway, 'embed'>;
  readonly transcriber: Transcriber;
}

/** Reads the OpenAI key and the configured S3 host from `env`; throws if the key is unusable. */
export async function createIngestGateway(
  env: Readonly<Record<string, string | undefined>>,
): Promise<IngestGateway> {
  const keys = await loadProviderKeys({ source: envKeySource(env), required: ['openai'] });
  const openaiKeys = keys.get('openai');
  const s3Host = new URL(storageConfigFromEnv(env).endpoint).host;
  return {
    embedder: createEmbeddingAdapter(openaiKeys),
    transcriber: createWhisperTranscriber(openaiKeys, { allowedHosts: [s3Host] }),
  };
}

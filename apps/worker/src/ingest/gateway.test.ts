// Task 8.2 Phase 2: no real key or network call — the "key" below is a synthetic fixture that
// only needs to pass the shape check (rule 4); nothing here reaches a model.
import { describe, expect, it } from 'vitest';
import { createIngestGateway } from './gateway.js';

const FAKE_KEY = 'sk-fake-not-a-real-key-0000000000000000'; // secret-scan: allow synthetic fixture, not a real credential

describe('createIngestGateway', () => {
  it('builds an embedder and a transcriber from the environment', async () => {
    const gateway = await createIngestGateway({ EDMATE_OPENAI_API_KEY: FAKE_KEY });
    expect(typeof gateway.embedder.embed).toBe('function');
    expect(typeof gateway.transcriber.transcribe).toBe('function');
  });

  it('allows only the configured S3 host for the transcriber', async () => {
    const gateway = await createIngestGateway({
      EDMATE_OPENAI_API_KEY: FAKE_KEY,
      S3_ENDPOINT: 'http://minio.internal:9000',
    });
    await expect(
      gateway.transcriber.transcribe({ url: 'https://evil.example/a.mp3', mimeType: 'audio/mpeg' }),
    ).rejects.toThrow();
  });

  it('rejects when the key is missing', async () => {
    await expect(createIngestGateway({})).rejects.toThrow();
  });
});

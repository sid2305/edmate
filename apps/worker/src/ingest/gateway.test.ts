// Task 8.2 Phase 2: no real key or network call — the "key" below is a synthetic fixture that
// only needs to pass the shape check (rule 4); nothing here reaches a model.
import { describe, expect, it } from 'vitest';
import { createIngestGateway } from './gateway.js';

const FAKE_KEY = 'sk-fake-not-a-real-key-0000000000000000'; // secret-scan: allow synthetic fixture, not a real credential

describe('createIngestGateway', () => {
  it('builds an embedder and a transcriber from the environment', async () => {
    const gateway = await createIngestGateway({ EDMATE_OPENAI_API_KEY: FAKE_KEY });
    // Both must be present (not merely "undefined, so the optional chain is skipped").
    expect(gateway.embedder).toBeDefined();
    expect(gateway.transcriber).toBeDefined();
    expect(typeof gateway.embedder?.embed).toBe('function');
    expect(typeof gateway.transcriber?.transcribe).toBe('function');
  });

  it('allows only the configured S3 host for the transcriber', async () => {
    const gateway = await createIngestGateway({
      EDMATE_OPENAI_API_KEY: FAKE_KEY,
      S3_ENDPOINT: 'http://minio.internal:9000',
    });
    // 9.0b review: assert the transcriber exists before calling it, so a missing transcriber
    // fails here instead of `undefined` resolving and the `rejects` below passing vacuously.
    expect(gateway.transcriber).toBeDefined();
    await expect(
      gateway.transcriber!.transcribe({
        url: 'https://evil.example/a.mp3',
        mimeType: 'audio/mpeg',
      }),
    ).rejects.toThrow();
  });

  it("11.4d: still rejects a disallowed host now that the ffmpeg chunker is wired in (chunker itself is covered by Phase A's tests)", async () => {
    const gateway = await createIngestGateway({
      EDMATE_OPENAI_API_KEY: FAKE_KEY,
      S3_ENDPOINT: 'http://minio.internal:9000',
    });
    expect(gateway.transcriber).toBeDefined();
    await expect(
      gateway.transcriber!.transcribe({ url: 'https://evil.example/a.mp4', mimeType: 'video/mp4' }),
    ).rejects.toThrow();
  });

  it('rejects when the key is missing', async () => {
    await expect(createIngestGateway({})).rejects.toThrow();
  });

  it('rejects when the key is missing and the mode is explicitly openai', async () => {
    await expect(createIngestGateway({ EDMATE_INGEST_EMBEDDINGS: 'openai' })).rejects.toThrow();
  });

  it('EDMATE_INGEST_EMBEDDINGS=off reads no key and returns no embedder or transcriber', async () => {
    const gateway = await createIngestGateway({ EDMATE_INGEST_EMBEDDINGS: 'off' });
    expect(gateway.embedder).toBeUndefined();
    expect(gateway.transcriber).toBeUndefined();
  });

  it('EDMATE_INGEST_EMBEDDINGS=off needs no key at all, even with none set', async () => {
    await expect(createIngestGateway({ EDMATE_INGEST_EMBEDDINGS: 'off' })).resolves.toEqual({});
  });

  it('an unsupported EDMATE_INGEST_EMBEDDINGS value is a config error naming the variable, not its value', async () => {
    await expect(createIngestGateway({ EDMATE_INGEST_EMBEDDINGS: 'bogus' })).rejects.toThrow(
      /EDMATE_INGEST_EMBEDDINGS/,
    );
    try {
      await createIngestGateway({ EDMATE_INGEST_EMBEDDINGS: 'bogus' });
      throw new Error('expected createIngestGateway to throw');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('bogus');
    }
  });
});

import type { IngestJob } from '@edmate/queue';
import { describe, expect, it, vi } from 'vitest';
import { StudioUnavailableError } from './routes';
import { consoleLog, createStudioRuntime, realHooks, type StudioHooks } from './runtime';

const shared = vi.hoisted(() => ({
  repos: {
    documents: { tag: 'shared-pool' },
    courses: { tag: 'shared-courses' },
    outline: { tag: 'shared-outline' },
    chunks: { tag: 'shared-chunks' },
  },
}));
vi.mock('../auth', () => ({ serverDatabase: vi.fn(() => ({ repos: shared.repos })) }));

/** A key the fake env may carry; the real adapter is never called (it is built, not used). */
const KEY_ENV = { EDMATE_ANTHROPIC_API_KEY: 'test-only-placeholder' };

function hooks() {
  const add = vi.fn(async () => undefined);
  const send = vi.fn(async (_cmd: unknown) => ({
    ContentLength: 3,
    ContentType: 'application/pdf',
  }));
  const repos = { documents: {}, courses: {}, outline: {}, chunks: {} };
  const h: StudioHooks = {
    repos: vi.fn(() => repos as never),
    s3: vi.fn(() => ({ send }) as never),
    queue: vi.fn(() => ({ add })),
    log: { error: vi.fn() },
  };
  return { h, add, send, repos };
}

describe('createStudioRuntime', () => {
  it('needs REDIS_URL, and retries the build on the next call', async () => {
    const { h } = hooks();
    let env: Record<string, string> = {};
    const get = createStudioRuntime(() => env, h);
    await expect(get()).rejects.toBeInstanceOf(StudioUnavailableError);
    await expect(get()).rejects.toMatchObject({ reason: 'REDIS_URL' });
    env = { REDIS_URL: 'redis://127.0.0.1:1', ...KEY_ENV };
    await expect(get()).resolves.toBeDefined();
    expect(h.queue).toHaveBeenCalledWith('redis://127.0.0.1:1', h.log);
  });

  it('a production S3 config gap is unavailable, by code only', async () => {
    const { h } = hooks();
    const get = createStudioRuntime(
      () => ({ REDIS_URL: 'redis://x', NODE_ENV: 'production', S3_ENDPOINT: 'http://h.test' }),
      h,
    );
    await expect(get()).rejects.toMatchObject({ reason: 'S3_ACCESS_KEY_ID_missing' });
    const full = createStudioRuntime(
      () => ({
        REDIS_URL: 'redis://x',
        NODE_ENV: 'production',
        S3_ENDPOINT: 'http://h.test',
        S3_ACCESS_KEY_ID: 'synthetic-id',
        S3_SECRET_ACCESS_KEY: 'synthetic-secret',
        S3_BUCKET: 'b',
      }),
      h,
    );
    await expect(full()).rejects.toMatchObject({
      name: 'StudioUnavailableError',
      reason: 'S3_ENDPOINT_not_https',
    });
    expect(h.repos).not.toHaveBeenCalled();
  });

  it('builds once, over the injected clients', async () => {
    const { h, add, send, repos } = hooks();
    const get = createStudioRuntime(
      () => ({ REDIS_URL: 'redis://x', S3_BUCKET: 'b1', ...KEY_ENV }),
      h,
    );
    const b = await get();
    expect(await get()).toBe(b);
    expect(h.repos).toHaveBeenCalledTimes(1);
    expect(b.newDocumentId()).toMatch(/^doc_[0-9a-f-]{36}$/);
    expect(b.newDocumentId()).not.toBe(b.newDocumentId());
    expect(b.courses).toBe(repos.courses);
    expect(b.outline).toBe(repos.outline);
    expect(b.chunks).toBe(repos.chunks);
    expect(b.gateway.generateObject).toBeInstanceOf(Function);

    const job: IngestJob = { teacherId: 't_1', documentId: 'doc_1', fileKind: 'pdf' };
    await b.enqueue(job, 'teachers/t_1/documents/doc_1/k.pdf');
    expect(add).toHaveBeenCalledWith(
      'ingest.process',
      job,
      expect.objectContaining({ jobId: expect.any(String) }),
    );

    await expect(b.storage.head('k')).resolves.toEqual({
      contentLength: 3,
      contentType: 'application/pdf',
    });
    expect(send.mock.calls[0]![0]).toMatchObject({ input: { Bucket: 'b1', Key: 'k' } });
  });
});

describe('upload URLs', () => {
  it('are signed for S3_PUBLIC_ENDPOINT when set, while HEAD uses the internal endpoint', async () => {
    const { h } = hooks();
    const real = await import('@aws-sdk/client-s3');
    h.s3 = vi.fn(
      (c) =>
        new real.S3Client({
          endpoint: c.endpoint,
          region: c.region,
          forcePathStyle: c.forcePathStyle,
          credentials: { accessKeyId: 'synthetic', secretAccessKey: 'synthetic' },
        }),
    );
    const get = createStudioRuntime(
      () => ({
        REDIS_URL: 'redis://x',
        S3_ENDPOINT: 'http://minio:9000',
        S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
        ...KEY_ENV,
      }),
      h,
    );
    const b = await get();
    const url = await b.storage.createUploadUrl({
      key: 'k.pdf',
      contentType: 'application/pdf',
      contentLength: 3,
    });
    expect(new URL(url).host).toBe('localhost:9000');
    expect(vi.mocked(h.s3).mock.calls.map(([c]) => c.endpoint)).toEqual([
      'http://minio:9000',
      'http://localhost:9000',
    ]);
  });

  it('use the one client when no public endpoint is set', async () => {
    const { h } = hooks();
    await createStudioRuntime(() => ({ REDIS_URL: 'redis://x', ...KEY_ENV }), h)();
    expect(h.s3).toHaveBeenCalledTimes(1);
  });
});

describe('the model gateway', () => {
  it('a missing provider key is unavailable, same as a missing REDIS_URL', async () => {
    const { h } = hooks();
    const get = createStudioRuntime(() => ({ REDIS_URL: 'redis://x' }), h);
    await expect(get()).rejects.toMatchObject({
      name: 'StudioUnavailableError',
      reason: 'provider_key',
    });
    expect(h.repos).not.toHaveBeenCalled();
  });
});

describe('realHooks.repos', () => {
  it("reuses the auth runtime's database (serverDatabase), never a second pool", () => {
    expect(realHooks.repos()).toBe(shared.repos);
  });
});

describe('consoleLog', () => {
  it('writes the event and its fields on one line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleLog('[studio]').error('studio.failed', { error: 'TypeError' });
    consoleLog('[studio]').error('studio.unavailable');
    expect(spy.mock.calls).toEqual([
      ['[studio] studio.failed error=TypeError'],
      ['[studio] studio.unavailable'],
    ]);
    spy.mockRestore();
  });
});

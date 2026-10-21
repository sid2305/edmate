import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { s3StudioStorage, storageConfigFromEnv, type S3Like } from './presign';

const CONFIG = storageConfigFromEnv({});

function fakeS3(send: (cmd: unknown) => Promise<unknown>): S3Like {
  return { send: vi.fn(send) as unknown as S3Like['send'] };
}

describe('storageConfigFromEnv', () => {
  it('falls back to the local MinIO placeholders', () => {
    expect(CONFIG).toMatchObject({
      endpoint: 'http://localhost:9000',
      bucket: 'edmate-dev',
      forcePathStyle: true,
    });
  });

  it('reads the env and refuses malformed values', () => {
    expect(
      storageConfigFromEnv({
        S3_ENDPOINT: 'https://s3.example.test',
        S3_FORCE_PATH_STYLE: 'false',
      }),
    ).toMatchObject({ endpoint: 'https://s3.example.test', forcePathStyle: false });
    expect(() => storageConfigFromEnv({ S3_ENDPOINT: 'ftp://x' })).toThrow(/S3_ENDPOINT/);
    expect(() => storageConfigFromEnv({ S3_ENDPOINT: 'not a url' })).toThrow(/S3_ENDPOINT/);
    expect(() => storageConfigFromEnv({ S3_FORCE_PATH_STYLE: 'yes' })).toThrow(/PATH_STYLE/);
  });
});

describe('createUploadUrl (signed locally, no network)', () => {
  // A real S3Client with placeholder credentials: presigning is pure computation.
  const client = new S3Client({
    endpoint: CONFIG.endpoint,
    region: CONFIG.region,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
  });
  const storage = s3StudioStorage(client, CONFIG.bucket);

  it('signs the content type and the exact content length, and expires', async () => {
    const url = new URL(
      await storage.createUploadUrl({
        key: 'teachers/t_1/documents/d/k.pdf',
        contentType: 'application/pdf',
        contentLength: 1234,
      }),
    );
    expect(url.pathname).toBe('/edmate-dev/teachers/t_1/documents/d/k.pdf');
    const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
    expect(signed).toEqual(expect.arrayContaining(['content-length', 'content-type', 'host']));
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(15 * 60);
    expect(url.search).not.toContain('test-secret');
  });

  it('refuses a length outside 1..maxBytes before signing', async () => {
    await expect(
      storage.createUploadUrl({ key: 'k.pdf', contentType: 'application/pdf', contentLength: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      storage.createUploadUrl({ key: 'k.pdf', contentType: 'application/pdf', contentLength: 1.5 }),
    ).rejects.toThrow(RangeError);
  });
});

describe('head and deleteObject', () => {
  it('returns the stored length and type', async () => {
    const s3 = fakeS3(async (cmd) => {
      expect(cmd).toBeInstanceOf(HeadObjectCommand);
      expect((cmd as HeadObjectCommand).input).toEqual({ Bucket: 'b', Key: 'k' });
      return { ContentLength: 10, ContentType: 'application/pdf' };
    });
    await expect(s3StudioStorage(s3, 'b').head('k')).resolves.toEqual({
      contentLength: 10,
      contentType: 'application/pdf',
    });
  });

  it('reads a missing object as null and a missing length or type as absent', async () => {
    const notFound = Object.assign(new Error('x'), { name: 'NotFound' });
    await expect(
      s3StudioStorage(
        fakeS3(() => Promise.reject(notFound)),
        'b',
      ).head('k'),
    ).resolves.toBeNull();
    const by404 = Object.assign(new Error('x'), { $metadata: { httpStatusCode: 404 } });
    await expect(
      s3StudioStorage(
        fakeS3(() => Promise.reject(by404)),
        'b',
      ).head('k'),
    ).resolves.toBeNull();
    await expect(
      s3StudioStorage(
        fakeS3(async () => ({})),
        'b',
      ).head('k'),
    ).resolves.toEqual({
      contentLength: undefined,
      contentType: undefined,
    });
  });

  it('rethrows any other failure', async () => {
    const boom = new Error('denied');
    await expect(
      s3StudioStorage(
        fakeS3(() => Promise.reject(boom)),
        'b',
      ).head('k'),
    ).rejects.toBe(boom);
    await expect(
      s3StudioStorage(
        fakeS3(() => Promise.reject('str')),
        'b',
      ).head('k'),
    ).rejects.toBe('str');
  });

  it('deletes by bucket and key', async () => {
    const s3 = fakeS3(async (cmd) => {
      expect(cmd).toBeInstanceOf(DeleteObjectCommand);
      expect((cmd as DeleteObjectCommand).input).toEqual({ Bucket: 'b', Key: 'k' });
      return {};
    });
    await s3StudioStorage(s3, 'b').deleteObject('k');
    expect(s3.send).toHaveBeenCalledTimes(1);
  });
});

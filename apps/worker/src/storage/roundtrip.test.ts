import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import {
  StorageConfigError,
  describeError,
  ensureBucket,
  roundTrip,
  storageConfigFromEnv,
  type S3Like,
} from './roundtrip.js';

/** An in-memory S3 stand-in: no network (rule 4). Records every command it receives. */
function fakeS3({
  buckets = new Set<string>(),
  headError,
  createError,
  corruptGet = false,
  emptyGet = false,
}: {
  buckets?: Set<string>;
  headError?: Error;
  createError?: Error;
  corruptGet?: boolean;
  emptyGet?: boolean;
} = {}) {
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof HeadBucketCommand) {
      calls.push('head');
      if (headError) throw headError;
      if (!buckets.has(command.input.Bucket ?? '')) throw named('NotFound');
      return {};
    }
    if (command instanceof CreateBucketCommand) {
      calls.push('create');
      if (createError) throw createError;
      buckets.add(command.input.Bucket ?? '');
      return {};
    }
    if (command instanceof PutObjectCommand) {
      calls.push('put');
      const body = command.input.Body;
      objects.set(command.input.Key ?? '', body instanceof Uint8Array ? body : new Uint8Array());
      return {};
    }
    if (command instanceof GetObjectCommand) {
      calls.push('get');
      if (emptyGet) return {};
      const stored = objects.get(command.input.Key ?? '') ?? new Uint8Array();
      const bytes = corruptGet ? new TextEncoder().encode('tampered') : stored;
      return { Body: { transformToByteArray: async () => bytes } };
    }
    if (command instanceof DeleteObjectCommand) {
      calls.push('delete');
      objects.delete(command.input.Key ?? '');
      return {};
    }
    throw new Error('unexpected command');
  });
  return { client: { send } as unknown as S3Like, calls, objects, buckets };
}

function named(name: string, status?: number): Error {
  const error = new Error(name) as Error & { $metadata?: { httpStatusCode?: number } };
  error.name = name;
  if (status !== undefined) error.$metadata = { httpStatusCode: status };
  return error;
}

describe('describeError', () => {
  it('adds the HTTP status S3 errors carry (HEAD errors have no message body)', () => {
    expect(describeError(named('UnknownError', 403))).toBe(
      'UnknownError (HTTP 403: check the access key pair)',
    );
    expect(describeError(named('NotFound', 404))).toBe('NotFound (HTTP 404)');
  });

  it('uses the message when it says more than the name', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:9000');
    expect(describeError(error)).toBe('Error: connect ECONNREFUSED 127.0.0.1:9000');
  });

  it('stringifies anything that is not an Error', () => {
    expect(describeError('boom')).toBe('boom');
  });
});

describe('storageConfigFromEnv', () => {
  it('falls back to the local MinIO dev defaults when nothing is set', () => {
    expect(storageConfigFromEnv({})).toEqual({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKeyId: 'edmate-dev',
      secretAccessKey: 'edmate-dev-storage',
      bucket: 'edmate-dev',
      forcePathStyle: true,
    });
  });

  it('reads every setting from the environment', () => {
    expect(
      storageConfigFromEnv({
        S3_ENDPOINT: 'https://s3.example.test',
        S3_REGION: 'eu-west-2',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'pw',
        S3_BUCKET: 'b',
        S3_FORCE_PATH_STYLE: 'false',
      }),
    ).toEqual({
      endpoint: 'https://s3.example.test',
      region: 'eu-west-2',
      accessKeyId: 'id',
      secretAccessKey: 'pw',
      bucket: 'b',
      forcePathStyle: false,
    });
  });

  it('treats empty strings as unset', () => {
    expect(storageConfigFromEnv({ S3_ENDPOINT: '', S3_BUCKET: '' })).toMatchObject({
      endpoint: 'http://localhost:9000',
      bucket: 'edmate-dev',
    });
  });

  it('rejects an endpoint that is not an http(s) URL', () => {
    expect(() => storageConfigFromEnv({ S3_ENDPOINT: 'not a url' })).toThrow(/S3_ENDPOINT/);
    expect(() => storageConfigFromEnv({ S3_ENDPOINT: 'ftp://host' })).toThrow(/S3_ENDPOINT/);
  });

  it('rejects a force-path-style value that is not true or false', () => {
    expect(() => storageConfigFromEnv({ S3_FORCE_PATH_STYLE: 'yes' })).toThrow(
      /S3_FORCE_PATH_STYLE/,
    );
  });
});

describe('storageConfigFromEnv in production', () => {
  const PROD = {
    NODE_ENV: 'production',
    S3_ENDPOINT: 'https://s3.example.test',
    S3_REGION: 'ap-south-1',
    S3_ACCESS_KEY_ID: 'synthetic-id',
    S3_SECRET_ACCESS_KEY: 'synthetic-secret',
    S3_BUCKET: 'synthetic-bucket',
  };

  it('reads a complete https config', () => {
    expect(storageConfigFromEnv(PROD)).toMatchObject({
      endpoint: 'https://s3.example.test',
      region: 'ap-south-1',
      bucket: 'synthetic-bucket',
    });
  });

  it.each([
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_BUCKET',
  ] as const)(
    'never falls back to the dev placeholders when %s is missing or blank, and the error names only the setting',
    (name) => {
      const missing = { ...PROD, [name]: undefined };
      expect(() => storageConfigFromEnv(missing)).toThrow(StorageConfigError);
      expect(() => storageConfigFromEnv(missing)).toThrow(
        expect.objectContaining({ code: `${name}_missing` }),
      );
      expect(() => storageConfigFromEnv({ ...PROD, [name]: ' ' })).toThrow(StorageConfigError);
    },
  );

  it.each([
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_BUCKET',
  ] as const)('refuses %s set to its own dev-default placeholder value', (name) => {
    const DEV = {
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'edmate-dev',
      S3_SECRET_ACCESS_KEY: 'edmate-dev-storage',
      S3_BUCKET: 'edmate-dev',
    };
    let caught: unknown;
    try {
      storageConfigFromEnv({ ...PROD, [name]: DEV[name] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StorageConfigError);
    expect(caught).toMatchObject({ code: `${name}_placeholder` });
  });

  it('refuses a plain-http endpoint, and the error never quotes it', () => {
    let caught: unknown;
    try {
      storageConfigFromEnv({ ...PROD, S3_ENDPOINT: 'http://internal-host.test:9000' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StorageConfigError);
    expect(caught).toMatchObject({ code: 'S3_ENDPOINT_not_https' });
    expect(String((caught as Error).message)).not.toContain('internal-host');
  });

  it('allows plain http only on the explicit dev-stack opt-in', () => {
    const local = { ...PROD, S3_ENDPOINT: 'http://minio:9000', S3_ALLOW_HTTP: 'true' };
    expect(storageConfigFromEnv(local).endpoint).toBe('http://minio:9000');
    expect(() => storageConfigFromEnv({ ...local, S3_ALLOW_HTTP: 'yes' })).toThrow(
      expect.objectContaining({ code: 'S3_ENDPOINT_not_https' }),
    );
  });

  it('keeps the dev and test defaults outside production', () => {
    expect(storageConfigFromEnv({ NODE_ENV: 'development' }).endpoint).toBe(
      'http://localhost:9000',
    );
    expect(storageConfigFromEnv({ NODE_ENV: 'test' }).bucket).toBe('edmate-dev');
  });
});

describe('ensureBucket', () => {
  it('does nothing when the bucket exists', async () => {
    const s3 = fakeS3({ buckets: new Set(['b']) });
    await expect(ensureBucket(s3.client, 'b')).resolves.toBe('exists');
    expect(s3.calls).toEqual(['head']);
  });

  it('creates the bucket when HeadBucket says NotFound', async () => {
    const s3 = fakeS3();
    await expect(ensureBucket(s3.client, 'b')).resolves.toBe('created');
    expect(s3.calls).toEqual(['head', 'create']);
    expect(s3.buckets.has('b')).toBe(true);
  });

  it('creates the bucket when HeadBucket returns a bare 404', async () => {
    const s3 = fakeS3({ headError: named('UnknownError', 404) });
    await expect(ensureBucket(s3.client, 'b')).resolves.toBe('created');
  });

  it('accepts a bucket another process created first', async () => {
    const s3 = fakeS3({ createError: named('BucketAlreadyOwnedByYou') });
    await expect(ensureBucket(s3.client, 'b')).resolves.toBe('exists');
  });

  it('rethrows any other HeadBucket failure (wrong keys, no network)', async () => {
    const s3 = fakeS3({ headError: named('Forbidden', 403) });
    await expect(ensureBucket(s3.client, 'b')).rejects.toThrow('Forbidden');
    expect(s3.calls).toEqual(['head']);
  });

  it('rethrows any other CreateBucket failure', async () => {
    const s3 = fakeS3({ createError: named('BucketAlreadyExists') });
    await expect(ensureBucket(s3.client, 'b')).rejects.toThrow('BucketAlreadyExists');
  });

  it('rethrows a non-Error failure', async () => {
    const client = { send: vi.fn(async () => Promise.reject('boom')) } as unknown as S3Like;
    await expect(ensureBucket(client, 'b')).rejects.toBe('boom');
  });
});

describe('roundTrip', () => {
  it('uploads, downloads, compares and deletes the object', async () => {
    const s3 = fakeS3();
    const result = await roundTrip(s3.client, { bucket: 'b', key: 'k.txt', body: 'hello world' });
    expect(result).toEqual({ bucket: 'b', key: 'k.txt', bytes: 11, bucketCreated: true });
    expect(s3.calls).toEqual(['head', 'create', 'put', 'get', 'delete']);
    expect(s3.objects.size).toBe(0);
  });

  it('counts bytes, not characters, for non-ASCII content', async () => {
    const s3 = fakeS3({ buckets: new Set(['b']) });
    const result = await roundTrip(s3.client, { bucket: 'b', key: 'k', body: 'नमस्ते 👋' });
    expect(result.bytes).toBe(new TextEncoder().encode('नमस्ते 👋').byteLength);
    expect(result.bucketCreated).toBe(false);
  });

  it('generates a unique key under roundtrip/ when none is given', async () => {
    const s3 = fakeS3({ buckets: new Set(['b']) });
    const first = await roundTrip(s3.client, { bucket: 'b' });
    const second = await roundTrip(s3.client, { bucket: 'b' });
    expect(first.key).toMatch(/^roundtrip\/[0-9a-f-]{36}\.txt$/);
    expect(first.key).not.toBe(second.key);
  });

  it('fails when the downloaded content differs, and still deletes the object', async () => {
    const s3 = fakeS3({ buckets: new Set(['b']), corruptGet: true });
    await expect(roundTrip(s3.client, { bucket: 'b', key: 'k', body: 'hello' })).rejects.toThrow(
      /content mismatch/,
    );
    expect(s3.calls).toEqual(['head', 'put', 'get', 'delete']);
  });

  it('fails when the download has no body, and still deletes the object', async () => {
    const s3 = fakeS3({ buckets: new Set(['b']), emptyGet: true });
    await expect(roundTrip(s3.client, { bucket: 'b', key: 'k' })).rejects.toThrow(/no body/);
    expect(s3.calls.at(-1)).toBe('delete');
  });

  it('does not try to delete when the upload itself failed', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadBucketCommand) return {};
      if (command instanceof PutObjectCommand) throw new Error('upload refused');
      throw new Error('should not be called');
    });
    const client = { send } as unknown as S3Like;
    await expect(roundTrip(client, { bucket: 'b', key: 'k' })).rejects.toThrow('upload refused');
    expect(send).toHaveBeenCalledTimes(2);
  });
});

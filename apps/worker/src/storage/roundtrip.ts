// Storage round-trip check: proves an S3-compatible bucket (MinIO locally, any S3 in production)
// accepts an upload, returns the same bytes and lets us delete them. Used by
// `pnpm --filter worker storage:roundtrip` (src/scripts/storage-roundtrip.ts).
import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';

/** The part of S3Client we use; tests pass an in-memory stand-in. */
export type S3Like = Pick<S3Client, 'send'>;

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

/** Dev-only placeholders matching docker/compose.yaml and docker/env.example. Not secrets. */
const DEV_DEFAULTS = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'edmate-dev',
  S3_SECRET_ACCESS_KEY: 'edmate-dev-storage',
  S3_BUCKET: 'edmate-dev',
  S3_FORCE_PATH_STYLE: 'true',
} as const;

type Env = Record<string, string | undefined>;

function read(env: Env, name: keyof typeof DEV_DEFAULTS): string {
  const value = env[name];
  return value === undefined || value === '' ? DEV_DEFAULTS[name] : value;
}

/** Reads the S3 settings, falling back to the local MinIO defaults. Throws on malformed values. */
export function storageConfigFromEnv(env: Env): StorageConfig {
  const endpoint = read(env, 'S3_ENDPOINT');
  let protocol: string;
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    protocol = '';
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`S3_ENDPOINT must be an http(s) URL, got "${endpoint}"`);
  }
  const pathStyle = read(env, 'S3_FORCE_PATH_STYLE');
  if (pathStyle !== 'true' && pathStyle !== 'false') {
    throw new Error(`S3_FORCE_PATH_STYLE must be "true" or "false", got "${pathStyle}"`);
  }
  return {
    endpoint,
    region: read(env, 'S3_REGION'),
    accessKeyId: read(env, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: read(env, 'S3_SECRET_ACCESS_KEY'),
    bucket: read(env, 'S3_BUCKET'),
    forcePathStyle: pathStyle === 'true',
  };
}

function httpStatus(error: Error): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'NotFound' || error.name === 'NoSuchBucket' || httpStatus(error) === 404;
}

/**
 * One-line description of a failure. S3 HEAD errors have no body, so the SDK reports only a
 * name such as "UnknownError"; the HTTP status says what actually went wrong.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const status = httpStatus(error);
  if (status !== undefined) {
    const hint = status === 401 || status === 403 ? ': check the access key pair' : '';
    return `${error.name} (HTTP ${status}${hint})`;
  }
  return `${error.name}: ${error.message}`;
}

/** Creates the bucket if it is missing. Any failure other than "not found" is rethrown. */
export async function ensureBucket(client: S3Like, bucket: string): Promise<'exists' | 'created'> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return 'exists';
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    return 'created';
  } catch (error) {
    // Another process created it between our HEAD and CREATE.
    if (error instanceof Error && error.name === 'BucketAlreadyOwnedByYou') return 'exists';
    throw error;
  }
}

export interface RoundTripResult {
  bucket: string;
  key: string;
  bytes: number;
  bucketCreated: boolean;
}

/**
 * Uploads `body`, downloads it, checks the bytes match and deletes the object.
 * Once the upload succeeded the object is always deleted, even when the check fails.
 */
export async function roundTrip(
  client: S3Like,
  {
    bucket,
    key = `roundtrip/${randomUUID()}.txt`,
    body = `edmate storage round-trip ${new Date().toISOString()}`,
  }: { bucket: string; key?: string; body?: string },
): Promise<RoundTripResult> {
  const bucketCreated = (await ensureBucket(client, bucket)) === 'created';
  const expected = new TextEncoder().encode(body);
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: expected, ContentType: 'text/plain' }),
  );
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error(`download of ${bucket}/${key} returned no body`);
    const actual = await response.Body.transformToByteArray();
    if (Buffer.compare(Buffer.from(actual), Buffer.from(expected)) !== 0) {
      throw new Error(
        `content mismatch for ${bucket}/${key}: sent ${expected.byteLength} bytes, got ${actual.byteLength}`,
      );
    }
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
  return { bucket, key, bytes: expected.byteLength, bucketCreated };
}

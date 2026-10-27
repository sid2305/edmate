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

/** A storage setting that is unusable here; `code` names the setting, never its value. */
export class StorageConfigError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`storage config refused: ${code}`);
    this.code = code;
    this.name = 'StorageConfigError';
  }
}

/** Settings production must name itself: the dev placeholders are never used there. */
const REQUIRED_IN_PRODUCTION = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
] as const;

function read(env: Env, name: keyof typeof DEV_DEFAULTS): string {
  const value = env[name];
  return value === undefined || value === '' ? DEV_DEFAULTS[name] : value;
}

/**
 * Reads the S3 settings. Outside production it falls back to the local MinIO defaults; under
 * NODE_ENV=production the endpoint, credentials and bucket must be set, must not equal their dev
 * placeholder and the endpoint must be https (unless S3_ALLOW_HTTP==='true', the dev-stack's
 * explicit opt-in). Throws StorageConfigError (a code only, never a value) on a bad value.
 */
export function storageConfigFromEnv(env: Env): StorageConfig {
  const production = env.NODE_ENV === 'production';
  if (production) {
    for (const name of REQUIRED_IN_PRODUCTION) {
      const value = (env[name] ?? '').trim();
      if (value === '') throw new StorageConfigError(`${name}_missing`);
      if (value === DEV_DEFAULTS[name]) throw new StorageConfigError(`${name}_placeholder`);
    }
  }
  const endpoint = read(env, 'S3_ENDPOINT');
  let protocol: string;
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    protocol = '';
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new StorageConfigError('S3_ENDPOINT_invalid');
  }
  const httpsOnly = production && env.S3_ALLOW_HTTP !== 'true';
  if (httpsOnly && protocol !== 'https:') {
    throw new StorageConfigError('S3_ENDPOINT_not_https');
  }
  const pathStyle = read(env, 'S3_FORCE_PATH_STYLE');
  if (pathStyle !== 'true' && pathStyle !== 'false') {
    throw new StorageConfigError('S3_FORCE_PATH_STYLE_invalid');
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

// Task 8.2 Phase 3: the web's own S3 access for the upload centre. The browser uploads straight to
// the bucket with a short-lived presigned PUT (ADR-0001: "signed URLs only"); the server checks the
// object landed (HEAD) and deletes replaced or deleted files. Config is read the same way as
// apps/worker's storageConfigFromEnv (deliberately duplicated: apps don't import each other).
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

type Env = Readonly<Record<string, string | undefined>>;

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
 * NODE_ENV=production the endpoint, credentials and bucket must be set and the endpoint must be
 * https. Throws StorageConfigError (a code only) on a missing or malformed value.
 */
export function storageConfigFromEnv(env: Env): StorageConfig {
  const production = env.NODE_ENV === 'production';
  if (production) {
    for (const name of REQUIRED_IN_PRODUCTION) {
      if ((env[name] ?? '').trim() === '') throw new StorageConfigError(`${name}_missing`);
    }
  }
  const endpoint = read(env, 'S3_ENDPOINT');
  let protocol = '';
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    // not a URL: refused below
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new StorageConfigError('S3_ENDPOINT_invalid');
  }
  if (production && protocol !== 'https:') throw new StorageConfigError('S3_ENDPOINT_not_https');
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

/** How long a presigned upload URL stays valid. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

export interface UploadUrlInput {
  /** A key built by the server (studio/files.ts), never one from client input. */
  key: string;
  contentType: string;
  /** The exact byte length; signed, so the bucket refuses any other size. */
  contentLength: number;
}

export interface StoredObject {
  contentLength: number | undefined;
  contentType: string | undefined;
}

export interface StudioStorage {
  /** A PUT URL with the content type and exact length signed in; computed locally. */
  createUploadUrl(input: UploadUrlInput): Promise<string>;
  /** The stored object's length and type, or null when it isn't there. */
  head(key: string): Promise<StoredObject | null>;
  /** Best effort: callers log a failure, never block or retry on one. */
  deleteObject(key: string): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return error.name === 'NotFound' || error.name === 'NoSuchKey' || status === 404;
}

export function s3StudioStorage(client: S3Like, bucket: string): StudioStorage {
  return {
    async createUploadUrl({ key, contentType, contentLength }) {
      if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
        throw new RangeError('upload length must be a positive integer');
      }
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      });
      // content-type and content-length stay signed headers (not hoisted to the query), so a PUT
      // with another type or size fails the signature check at the bucket.
      return getSignedUrl(client as S3Client, command, {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
    },
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { contentLength: out.ContentLength, contentType: out.ContentType };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

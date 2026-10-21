// Task 8.2 Phase 2: the worker's own S3 access (real credentials, not browser-facing). The worker
// fetches bytes for PDF/DOCX/PPTX/Markdown, hands the Transcriber port a short-lived signed GET URL
// for video/audio (ADR-0005's "an https signed URL to Edmate's own storage"), and best-effort
// deletes the object a replace or delete leaves behind. Built on the `S3Client` `roundtrip.ts`
// already proves the bucket round-trips with (storageConfigFromEnv); not duplicated here.
import { DeleteObjectCommand, GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * The object is larger than the caller's cap. Thrown before the body is read (ContentLength) or
 * as soon as the running byte count passes the cap, so an oversized upload is never buffered
 * whole. The message names only the cap, never the key or bucket.
 */
export class ObjectTooLargeError extends Error {
  override readonly name = 'ObjectTooLargeError';
  constructor(readonly maxBytes: number) {
    super(`storage: the object is larger than the ${String(maxBytes)}-byte limit`);
  }
}

export interface StorageClient {
  /** The object's full bytes, streamed and refused with `ObjectTooLargeError` past `maxBytes`. */
  getObjectBytes(key: string, maxBytes: number): Promise<Uint8Array>;
  /** A GET URL valid for `ttlSeconds`, signed locally (no request to the bucket). */
  getSignedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Best effort: the caller logs a failure, it never blocks or retries on one. */
  deleteObject(key: string): Promise<void>;
}

interface StreamBody {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
  destroy?: () => void;
}

function isStream(body: unknown): body is StreamBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<symbol, unknown>)[Symbol.asyncIterator] === 'function'
  );
}

/**
 * Reads `body` (Node's GetObject body is an async-iterable Readable) with a running byte count:
 * a declared ContentLength over the cap is refused before any read, and a stream that runs past
 * it (no or a wrong ContentLength) is aborted at the first chunk that crosses it.
 */
async function readCapped(
  body: unknown,
  contentLength: number | undefined,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!isStream(body)) throw new Error('storage: the object body is not a stream');
  const abort = () => {
    body.destroy?.();
    return new ObjectTooLargeError(maxBytes);
  };
  if (contentLength !== undefined && contentLength > maxBytes) throw abort();
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const part of body) {
    total += part.byteLength;
    if (total > maxBytes) throw abort();
    parts.push(part);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** Signs with `getSignedUrl` unless a test passes its own (so unit tests never touch crypto). */
export function createStorageClient(
  client: S3Client,
  bucket: string,
  sign: typeof getSignedUrl = getSignedUrl,
): StorageClient {
  return {
    async getObjectBytes(key, maxBytes) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) throw new Error(`download of ${bucket}/${key} returned no body`);
      return readCapped(res.Body as unknown, res.ContentLength, maxBytes);
    },
    async getSignedDownloadUrl(key, ttlSeconds) {
      return sign(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: ttlSeconds,
      });
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

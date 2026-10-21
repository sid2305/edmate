// Task 8.2 Phase 2: the worker's own S3 access (real credentials, not browser-facing). The worker
// fetches bytes for PDF/DOCX/PPTX/Markdown, hands the Transcriber port a short-lived signed GET URL
// for video/audio (ADR-0005's "an https signed URL to Edmate's own storage"), and best-effort
// deletes the object a replace or delete leaves behind. Built on the `S3Client` `roundtrip.ts`
// already proves the bucket round-trips with (storageConfigFromEnv); not duplicated here.
import { DeleteObjectCommand, GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageClient {
  /** The object's full bytes. Size limits are enforced by the parser that reads them. */
  getObjectBytes(key: string): Promise<Uint8Array>;
  /** A GET URL valid for `ttlSeconds`, signed locally (no request to the bucket). */
  getSignedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Best effort: the caller logs a failure, it never blocks or retries on one. */
  deleteObject(key: string): Promise<void>;
}

/** Signs with `getSignedUrl` unless a test passes its own (so unit tests never touch crypto). */
export function createStorageClient(
  client: S3Client,
  bucket: string,
  sign: typeof getSignedUrl = getSignedUrl,
): StorageClient {
  return {
    async getObjectBytes(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) throw new Error(`download of ${bucket}/${key} returned no body`);
      return new Uint8Array(await res.Body.transformToByteArray());
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

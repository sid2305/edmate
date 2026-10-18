// Entrypoint for `pnpm --filter worker storage:roundtrip`: runs the storage round-trip against the
// configured S3-compatible bucket (MinIO in docker/compose.yaml) and exits 0 on success.
// It makes real network calls, so it is excluded from unit tests and coverage.
import { S3Client } from '@aws-sdk/client-s3';
import { describeError, roundTrip, storageConfigFromEnv } from '../storage/roundtrip.js';

async function main(): Promise<void> {
  const config = storageConfigFromEnv(process.env);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  try {
    const result = await roundTrip(client, { bucket: config.bucket });
    console.log(
      `[storage:roundtrip] ok: ${result.bytes} bytes to ${config.endpoint} ${result.bucket}/${result.key}` +
        ` (bucket ${result.bucketCreated ? 'created' : 'existed'}; object deleted)`,
    );
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(`[storage:roundtrip] failed: ${describeError(error)}`);
  process.exitCode = 1;
});

// Task 8.2 Phase 3: the studio backend, built once, lazily, on the first studio request, so
// `next build` and the route-coverage test open no database, Redis or S3 client. A missing
// REDIS_URL fails the build (logged by reason); the routes then answer 503 and the next request
// tries again.
import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { openDatabase, type Repositories } from '@edmate/db';
import { createIngestQueue, enqueueIngest, type JobQueue } from '@edmate/queue';
import { Redis } from 'ioredis';
import { s3StudioStorage, storageConfigFromEnv, type S3Like } from '../storage/presign';
import { StudioUnavailableError, type ServerLog, type StudioBackend } from './routes';

export type Env = Readonly<Record<string, string | undefined>>;

/** The outside world the backend opens; injected so tests open nothing real. */
export interface StudioHooks {
  repos(env: Env): Pick<Repositories, 'documents'>;
  s3(config: ReturnType<typeof storageConfigFromEnv>): S3Like;
  queue(redisUrl: string, log: ServerLog): JobQueue;
  log: ServerLog;
}

/** The server log: one line per event, codes and error names only. */
export function consoleLog(prefix: string): ServerLog {
  return {
    error: (event, fields = {}) => {
      const rest = Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      console.error(`${prefix} ${event}${rest === '' ? '' : ` ${rest}`}`);
    },
  };
}

function build(env: Env, hooks: StudioHooks): StudioBackend {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new StudioUnavailableError('REDIS_URL');
  const config = storageConfigFromEnv(env);
  const queue = hooks.queue(redisUrl, hooks.log);
  return {
    documents: hooks.repos(env).documents,
    storage: s3StudioStorage(hooks.s3(config), config.bucket),
    enqueue: (job, storageKey) => enqueueIngest(queue, job, storageKey),
    newDocumentId: () => `doc_${randomUUID()}`,
    log: hooks.log,
  };
}

/** A memoised backend factory; a failed build is not cached, so the next request retries. */
export function createStudioRuntime(
  env: () => Env,
  hooks: StudioHooks,
): () => Promise<StudioBackend> {
  let backend: StudioBackend | undefined;
  return async () => {
    backend ??= build(env(), hooks);
    return backend;
  };
}

/* v8 ignore start -- the real clients; every test injects hooks instead (rule 4). */
export const realHooks: StudioHooks = {
  repos: (env) => openDatabase(env).repos,
  s3: (config) =>
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
  queue: (redisUrl, log) => {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // ioredis errors can quote the host: the name only.
    connection.on('error', (error: unknown) =>
      log.error('studio.redis_error', { error: error instanceof Error ? error.name : 'unknown' }),
    );
    return createIngestQueue(connection);
  },
  log: consoleLog('[studio]'),
};
/* v8 ignore stop */

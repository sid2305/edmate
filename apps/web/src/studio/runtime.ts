// Task 8.2 Phase 3: the studio backend, built once, lazily, on the first studio request, so
// `next build` and the route-coverage test open no database, Redis or S3 client. A missing
// REDIS_URL fails the build (logged by reason); the routes then answer 503 and the next request
// tries again.
import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import type { Repositories } from '@edmate/db';
import { createIngestQueue, enqueueIngest, type JobQueue } from '@edmate/queue';
import { Redis } from 'ioredis';
import { serverDatabase } from '../auth';
import {
  StorageConfigError,
  s3StudioStorage,
  storageConfigFromEnv,
  type S3Like,
} from '../storage/presign';
import { StudioUnavailableError, type ServerLog, type StudioBackend } from './routes';

export type Env = Readonly<Record<string, string | undefined>>;

/** The outside world the backend opens; injected so tests open nothing real. */
export interface StudioHooks {
  repos(): Pick<Repositories, 'documents'>;
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
  let config: ReturnType<typeof storageConfigFromEnv>;
  try {
    config = storageConfigFromEnv(env);
  } catch (error) {
    // the code names the setting only; the value (a host, a key) never reaches a log
    throw new StudioUnavailableError(error instanceof StorageConfigError ? error.code : 'S3_config');
  }
  const queue = hooks.queue(redisUrl, hooks.log);
  return {
    documents: hooks.repos().documents,
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

/** The auth runtime's database: one pool per web process, shared with the guard (9.4). */
const sharedRepos = (): Pick<Repositories, 'documents'> => serverDatabase().repos;

/* v8 ignore start -- the real clients; every test injects hooks instead (rule 4). */
export const realHooks: StudioHooks = {
  repos: sharedRepos,
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

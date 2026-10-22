// Task 8.2 Phase 3: the studio backend, built once, lazily, on the first studio request, so
// `next build` and the route-coverage test open no database, Redis or S3 client. A missing
// REDIS_URL fails the build (logged by reason); the routes then answer 503.
//
// Task 8.3 Phase B adds the outline's repositories and a `small`-tier-only model gateway, built
// the same way `apps/web/src/turn/deps.ts`/`runtime.ts` compose theirs (provider keys via
// `@edmate/gateway`'s existing loader, reusing `anthropicFactories` read-only from there — no
// change to that file). A missing provider key behaves like a missing REDIS_URL: a logged
// `StudioUnavailableError`, 503.
import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import type { Repositories } from '@edmate/db';
import { createRouter, DEFAULT_MODEL_POLICY } from '@edmate/gateway';
import { createIngestQueue, enqueueIngest, type JobQueue } from '@edmate/queue';
import { Redis } from 'ioredis';
import { serverDatabase } from '../auth';
import {
  StorageConfigError,
  s3StudioStorage,
  storageConfigFromEnv,
  type S3Like,
} from '../storage/presign';
import { anthropicFactories } from '../turn/runtime';
import { redisLinkRateLimiter, type LinkRateLimiter } from './linkRateLimit';
import { StudioUnavailableError, type ServerLog, type StudioBackend } from './routes';
import type { OutlineBackend } from './outline';

export type Env = Readonly<Record<string, string | undefined>>;

type Backend = StudioBackend & OutlineBackend;

/** The outside world the backend opens; injected so tests open nothing real. */
export interface StudioHooks {
  repos(): Pick<Repositories, 'documents' | 'courses' | 'outline' | 'chunks'>;
  s3(config: ReturnType<typeof storageConfigFromEnv>): S3Like;
  queue(redisUrl: string, log: ServerLog): JobQueue;
  /** Task 8.2f: the per-teacher web-link rate limit, on its own Redis connection. */
  linkRateLimit(redisUrl: string, log: ServerLog): LinkRateLimiter;
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

async function build(env: Env, hooks: StudioHooks): Promise<Backend> {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new StudioUnavailableError('REDIS_URL');
  let config: ReturnType<typeof storageConfigFromEnv>;
  try {
    config = storageConfigFromEnv(env);
  } catch (error) {
    // the code names the setting only; the value (a host, a key) never reaches a log
    throw new StudioUnavailableError(
      error instanceof StorageConfigError ? error.code : 'S3_config',
    );
  }
  const client = hooks.s3(config);
  const signer =
    config.publicEndpoint === undefined
      ? client
      : hooks.s3({ ...config, endpoint: config.publicEndpoint });
  const queue = hooks.queue(redisUrl, hooks.log);
  const linkRateLimit = hooks.linkRateLimit(redisUrl, hooks.log);
  const factories = await anthropicFactories(env).catch(() => {
    throw new StudioUnavailableError('provider_key');
  });
  const repos = hooks.repos();
  return {
    documents: repos.documents,
    courses: repos.courses,
    outline: repos.outline,
    chunks: repos.chunks,
    gateway: createRouter(DEFAULT_MODEL_POLICY, factories),
    storage: s3StudioStorage(client, config.bucket, signer),
    enqueue: (job, storageKey) => enqueueIngest(queue, job, storageKey),
    newDocumentId: () => `doc_${randomUUID()}`,
    log: hooks.log,
    linkRateLimit,
  };
}

/**
 * A memoised backend factory. The in-flight promise is cached (not just its resolved value), so
 * two concurrent cold requests share one build; a failed build is not cached, so the next
 * request retries.
 */
export function createStudioRuntime(
  env: () => Env,
  hooks: StudioHooks,
): () => Promise<Backend> {
  let backend: Promise<Backend> | undefined;
  return () => {
    backend ??= build(env(), hooks).catch((error: unknown) => {
      backend = undefined;
      throw error;
    });
    return backend;
  };
}

/** The auth runtime's database: one pool per web process, shared with the guard (9.4). */
const sharedRepos = (): Pick<Repositories, 'documents' | 'courses' | 'outline' | 'chunks'> =>
  serverDatabase().repos;

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
  linkRateLimit: (redisUrl, log) => {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    connection.on('error', (error: unknown) =>
      log.error('studio.link_rate_limit_redis_error', {
        error: error instanceof Error ? error.name : 'unknown',
      }),
    );
    return redisLinkRateLimiter(connection);
  },
  log: consoleLog('[studio]'),
};
/* v8 ignore stop */

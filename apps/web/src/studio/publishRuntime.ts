// Task 8.7 Phase D: the publish API's backend, built lazily on the first request so `next build`
// and the route-coverage test open nothing. The prompt-pack and model pins are the packages
// runtime's (8.6c, reused read-only: the newest signed set and MODEL_MIX.paid); the judge is the
// release judge from EDMATE_JUDGE_MODEL, read the same way the worker reads it, so the run's pin
// matches the gate worker's (it refuses a run pinned to another judge); the gate queue sits on
// REDIS_URL. Anything missing is a logged StudioUnavailableError and the routes answer 503.
import { createGateQueue, enqueueGate, type JobQueue } from '@edmate/queue';
import { Redis } from 'ioredis';
import { serverDatabase } from '../auth';
import { errorName } from '../turn/routes';
import type { Env } from '../turn/runtime';
import { createPackagesRuntime, type PackagesHooks } from './packagesRuntime';
import { createPublishHandlers, type PublishBackend } from './publish';
import { StudioUnavailableError, type ServerLog } from './routes';
import { realHooks } from './runtime';

/** The variable `@edmate/evals` `resolveJudgeModel` reads (the worker's judge). */
const JUDGE_MODEL_VARIABLE = 'EDMATE_JUDGE_MODEL';

export interface PublishHooks {
  repos(): PublishBackend['repos'];
  queue(redisUrl: string, log: ServerLog): JobQueue;
  log: ServerLog;
  /** Reads the prompt-pack library (tests inject a fake). */
  readPromptPacks?: PackagesHooks['readPromptPacks'];
}

/**
 * The judge pin as `<provider>:<model>`, parsed like `resolveJudgeModel` (trimmed, split at the
 * first colon, both parts non-empty). Kept here rather than importing `@edmate/evals` into the
 * web bundle; the worker accepts this label form.
 */
export function judgeModelPin(env: Env): string {
  const raw = (env[JUDGE_MODEL_VARIABLE] ?? '').trim();
  const at = raw.indexOf(':');
  const provider = at < 0 ? '' : raw.slice(0, at).trim();
  const model = at < 0 ? '' : raw.slice(at + 1).trim();
  if (provider === '' || model === '') throw new StudioUnavailableError('judge_model');
  return `${provider}:${model}`;
}

async function build(env: Env, hooks: PublishHooks): Promise<PublishBackend> {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new StudioUnavailableError('REDIS_URL');
  const judgeModel = judgeModelPin(env);
  const pins = await createPackagesRuntime(() => env, {
    repos: () => {
      throw new Error('unused');
    },
    log: { error: () => undefined },
    ...(hooks.readPromptPacks === undefined ? {} : { readPromptPacks: hooks.readPromptPacks }),
  })();
  const queue = hooks.queue(redisUrl, hooks.log);
  return {
    get repos() {
      return hooks.repos();
    },
    promptPackVersion: pins.promptPackVersion,
    modelPolicy: pins.modelPolicy,
    judgeModel,
    enqueue: (job) => enqueueGate(queue, job),
    log: hooks.log,
  };
}

/**
 * The publish backend, memoised once built (the in-flight promise is shared). A failure is logged
 * by its reason code or error name (never a path, URL or message) and not cached.
 */
export function createPublishRuntime(
  env: () => Env,
  hooks: PublishHooks,
): () => Promise<PublishBackend> {
  let backend: Promise<PublishBackend> | undefined;
  return () => {
    backend ??= build(env(), hooks).catch((error: unknown) => {
      backend = undefined;
      const reason = error instanceof StudioUnavailableError ? error.reason : errorName(error);
      hooks.log.error('studio.publish_runtime_unavailable', { reason });
      throw error;
    });
    return backend;
  };
}

/* v8 ignore start -- process wiring: the shared database, Redis and the console log. */
export const publishHandlers = createPublishHandlers(
  createPublishRuntime(() => process.env, {
    repos: () => serverDatabase().repos,
    queue: (redisUrl, log) => {
      const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
      // ioredis errors can quote the host: the name only.
      connection.on('error', (error: unknown) =>
        log.error('studio.redis_error', { error: error instanceof Error ? error.name : 'unknown' }),
      );
      return createGateQueue(connection);
    },
    log: realHooks.log,
  }),
  realHooks.log,
);
/* v8 ignore stop */

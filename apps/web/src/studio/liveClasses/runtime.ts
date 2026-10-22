// Task 11.1b Phase B: the live-classes backend, built lazily on the first request. Same shape as
// `createQuestionsRuntime`: no S3, Redis or queue, just the shared auth runtime's database
// repositories (`serverDatabase().repos`).
import type { Repositories } from '@edmate/db';
import { serverDatabase } from '../../auth';
import { consoleLog } from '../runtime';
import type { LiveClassesBackend } from './routes';
import type { ServerLog } from '../routes';

/** The outside world the backend reads; injected so tests open nothing real. */
export interface LiveClassesHooks {
  repos(): Pick<Repositories, 'liveClasses'>;
  log: ServerLog;
}

/**
 * A memoised backend factory, same shape as `createQuestionsRuntime`: the in-flight promise is
 * cached so two concurrent cold requests share one build; a failed build is not cached, so the
 * next request retries.
 */
export function createLiveClassesRuntime(
  hooks: LiveClassesHooks,
): () => Promise<LiveClassesBackend> {
  let backend: Promise<LiveClassesBackend> | undefined;
  return () => {
    backend ??= Promise.resolve()
      .then(() => {
        const repos = hooks.repos();
        return { liveClasses: repos.liveClasses, log: hooks.log };
      })
      .catch((error: unknown) => {
        backend = undefined;
        throw error;
      });
    return backend;
  };
}

/* v8 ignore start -- the real repositories; every test injects hooks instead (rule 4). */
export const realHooks: LiveClassesHooks = {
  repos: () => serverDatabase().repos,
  log: consoleLog('[studio.liveClasses]'),
};
/* v8 ignore stop */

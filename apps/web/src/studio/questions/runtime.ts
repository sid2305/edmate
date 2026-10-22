// Task 8.9 Phase B: the questions backend, built lazily on the first request. The simplest of the
// studio composition roots so far (plan, Phase B) — no S3, Redis or queue, just the shared auth
// runtime's database repositories (`serverDatabase().repos`), same source `styleCardRuntime.ts`
// reads but with nothing to compose on top: `serverDatabase()` either returns the repositories or
// throws, so there is no extra `StudioUnavailableError` wrapping to do here.
import type { Repositories } from '@edmate/db';
import { serverDatabase } from '../../auth';
import { consoleLog } from '../runtime';
import type { QuestionsBackend } from './routes';
import type { ServerLog } from '../routes';

/** The outside world the backend reads; injected so tests open nothing real. */
export interface QuestionsHooks {
  repos(): Pick<Repositories, 'teacherQuestions' | 'outline'>;
  log: ServerLog;
}

/**
 * A memoised backend factory, same shape as `createStudioRuntime`: the in-flight promise is
 * cached so two concurrent cold requests share one build; a failed build is not cached, so the
 * next request retries.
 */
export function createQuestionsRuntime(hooks: QuestionsHooks): () => Promise<QuestionsBackend> {
  let backend: Promise<QuestionsBackend> | undefined;
  return () => {
    backend ??= Promise.resolve()
      .then(() => {
        const repos = hooks.repos();
        return {
          teacherQuestions: repos.teacherQuestions,
          modules: repos.outline,
          log: hooks.log,
        };
      })
      .catch((error: unknown) => {
        backend = undefined;
        throw error;
      });
    return backend;
  };
}

/* v8 ignore start -- the real repositories; every test injects hooks instead (rule 4). */
export const realHooks: QuestionsHooks = {
  repos: () => serverDatabase().repos,
  log: consoleLog('[studio.questions]'),
};
/* v8 ignore stop */

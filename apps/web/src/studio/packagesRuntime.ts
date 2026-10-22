// Task 8.6 Phase C: the packages API's backend, built lazily on the first request so `next build`
// and the route-coverage test open nothing. Repositories come from the shared auth runtime's
// database; a new agent pins the newest signed prompt-pack set in the content dir and
// `MODEL_MIX.paid` (B-42); the per-turn cost is computed once from the bundled prices. No model is
// called: the estimate is arithmetic over the price table.
import { join } from 'node:path';
import { newestSignedSet, readPromptPackLibrary } from '@edmate/content';
import {
  loadBundledPrices,
  MODEL_MIX,
  turnCostMicroUsd,
  UnpricedModelError,
  type PriceTable,
} from '@edmate/gateway';
import { serverDatabase } from '../auth';
import { errorName } from '../turn/routes';
import { contentDir, type Env } from '../turn/runtime';
import { createPackageHandlers, type PackagesBackend } from './packages';
import { realHooks } from './runtime';
import { StudioUnavailableError, type ServerLog } from './routes';

export interface PackagesHooks {
  repos(): PackagesBackend['repos'];
  log: ServerLog;
  /** Reads the prompt-pack library (tests inject a fake). */
  readPromptPacks?: typeof readPromptPackLibrary;
  /** The price table (tests inject one); defaults to the bundled prices. */
  prices?: () => PriceTable;
}

function promptPackVersion(env: Env, hooks: PackagesHooks): string {
  let library: ReturnType<typeof readPromptPackLibrary>;
  try {
    library = (hooks.readPromptPacks ?? readPromptPackLibrary)(join(contentDir(env), 'prompt-packs'));
  } catch {
    throw new StudioUnavailableError('prompt_packs');
  }
  const set = newestSignedSet(library);
  if (set === undefined) throw new StudioUnavailableError('prompt_packs_unsigned');
  return set.version;
}

function perTurnCost(hooks: PackagesHooks): number {
  try {
    return turnCostMicroUsd(MODEL_MIX.paid, (hooks.prices ?? loadBundledPrices)());
  } catch (error) {
    // Never a $0 estimate (lessons.md: a check that silently skips looks like a pass).
    if (error instanceof UnpricedModelError) throw new StudioUnavailableError('unpriced_model');
    throw error;
  }
}

function build(env: Env, hooks: PackagesHooks): PackagesBackend {
  const version = promptPackVersion(env, hooks);
  const perTurnMicroUsd = perTurnCost(hooks);
  return {
    get repos() {
      return hooks.repos();
    },
    promptPackVersion: version,
    modelPolicy: MODEL_MIX.paid,
    perTurnMicroUsd,
    log: hooks.log,
  };
}

/**
 * The packages backend, memoised once built. A failure is logged (its reason code or error name,
 * never a path or message) and not cached, so signing a prompt-pack set needs no restart.
 */
export function createPackagesRuntime(
  env: () => Env,
  hooks: PackagesHooks,
): () => Promise<PackagesBackend> {
  let backend: PackagesBackend | undefined;
  return async () => {
    if (backend) return backend;
    try {
      backend = build(env(), hooks);
      return backend;
    } catch (error) {
      const reason = error instanceof StudioUnavailableError ? error.reason : errorName(error);
      hooks.log.error('studio.packages_runtime_unavailable', { reason });
      throw error;
    }
  };
}

/* v8 ignore start -- process wiring: the shared database and the console log. */
/** Wired to the shared auth runtime's database (the same memoised pool the other studio routes use). */
export const packageHandlers = createPackageHandlers(
  createPackagesRuntime(() => process.env, {
    repos: () => serverDatabase().repos,
    log: realHooks.log,
  }),
  realHooks.log,
);
/* v8 ignore stop */

// The test chat's production wiring (task 8.5 Phase B), built once, lazily, on the first request,
// the way `../../turn/runtime.ts` builds the student `TurnBackend`: the same provider-key, dev
// model, content-dir and Redis handling (imported, not copied), and the same rule that a missing
// REDIS_URL or provider key fails the build (logged once, by reason code) and the routes answer 503.
import { join } from 'node:path';
import { loadBundledPrices } from '@edmate/gateway';
import { defaultSteps } from '@edmate/harness';
import {
  loadLocalePacks,
  pickLocalePack,
  readPersonaLibrary,
  readPromptPackLibrary,
} from '@edmate/content';
import { systemClock, systemIds } from '../../turn/deps';
import { devFactories, devModelEnabled } from '../../turn/devModel';
import { errorName, TurnUnavailableError } from '../../turn/routes';
import { anthropicFactories, contentDir, type Env, type RuntimeHooks } from '../../turn/runtime';
import { previewEntitlementsFor, testChatDepsFor, testChatPorts, type TestChatProcess } from './deps';
import type { TestChatBackend } from './routes';

/** The student runtime's market rule: production fails closed without a locale pack for it. */
function configuredMarket(env: Env, packs: ReadonlyMap<string, unknown>): string {
  const market = env.EDMATE_MARKET?.trim() ?? '';
  if (env.NODE_ENV === 'production') {
    if (!packs.has(market)) throw new TurnUnavailableError('EDMATE_MARKET');
    return market;
  }
  return market || 'global';
}

async function build(env: Env, hooks: RuntimeHooks): Promise<TestChatBackend> {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new TurnUnavailableError('REDIS_URL');
  const dev = devModelEnabled(env);
  const factories = dev
    ? devFactories()
    : await anthropicFactories(env).catch(() => {
        throw new TurnUnavailableError('provider_key');
      });
  const dir = contentDir(env);
  const { packs } = loadLocalePacks(join(dir, 'locales'));
  const promptPacks = readPromptPackLibrary(join(dir, 'prompt-packs'));
  const personas = readPersonaLibrary(join(dir, 'skills', 'mock_interview'));
  const market = configuredMarket(env, packs);
  if (dev) hooks.log.error('testChat.dev_model_on', {});
  const { repos } = hooks.database();
  const { queues, limits } = hooks.redis(redisUrl);
  const p: TestChatProcess = {
    repos,
    market,
    packMarket: (m) => (packs.has(m) ? m : 'global'),
    queues,
    limits,
    factories,
    prices: loadBundledPrices(),
    promptPacks,
    personas,
    ...testChatPorts(repos, { locales: (m) => pickLocalePack(m, packs) }),
    clock: systemClock(),
    ids: systemIds(),
    log: hooks.log,
  };
  return {
    agents: repos.agents,
    agentVersions: repos.agentVersions,
    packageVersions: repos.packageVersions,
    sessions: repos.sessions,
    corrections: repos.corrections,
    previewEntitlements: (packageId) => previewEntitlementsFor(p, packageId),
    depsFor: (scope, packageId) => testChatDepsFor(p, scope, packageId),
    steps: defaultSteps,
    now: () => new Date(),
    log: hooks.log,
  };
}

/**
 * A memoised backend factory. The first call builds; a failure is logged once (its reason code or
 * error name, never a key) and every later call gets the same rejection until the process restarts.
 */
export function createTestChatRuntime(
  env: () => Env,
  hooks: RuntimeHooks,
): () => Promise<TestChatBackend> {
  let backend: Promise<TestChatBackend> | undefined;
  return () => {
    backend ??= build(env(), hooks).catch((error: unknown) => {
      const reason = error instanceof TurnUnavailableError ? error.reason : errorName(error);
      hooks.log.error('testChat.runtime_unavailable', { reason });
      throw error;
    });
    return backend;
  };
}

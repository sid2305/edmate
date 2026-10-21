// The web's turn runtime (task 9.4): built once, lazily, on the first session or turn request, so
// `next build` and `/api/health` need no Redis or provider key. A missing REDIS_URL or Anthropic
// key fails the build of the runtime (logged once, by name); the routes then answer 503. There is
// no fallback to memory ports in production.
import { resolve as resolvePath, join } from 'node:path';
import type { IdentityStore, Repositories } from '@edmate/db';
import {
  createAnthropicAdapter,
  envKeySource,
  loadBundledPrices,
  loadProviderKeys,
  type ProviderAdapterFactories,
} from '@edmate/gateway';
import { defaultSteps, type TurnLimits } from '@edmate/harness';
import { createTurnQueues, redisTurnLimits, type TurnQueues } from '@edmate/queue';
import { Redis } from 'ioredis';
import { loadLocalePacks, pickLocalePack, readPromptPackLibrary } from '@edmate/content';
import { processPorts, systemClock, systemIds, turnDepsFor } from './deps';
import { errorName, TurnUnavailableError, type ServerLog, type TurnBackend } from './routes';

export type Env = Readonly<Record<string, string | undefined>>;

/** The outside world the runtime opens; injected so tests open nothing real. */
export interface RuntimeHooks {
  /** The auth runtime's repositories and age-policy identity (`serverDatabase()`). */
  database(): { repos: Repositories; identity: Pick<IdentityStore, 'learnerStatus'> };
  /** Queues and the Redis-backed turn limits on `redisUrl`. */
  redis(redisUrl: string): { queues: TurnQueues; limits: TurnLimits };
  log: ServerLog;
}

/** Anthropic for every tier; the key is read from the environment and kept in a `Secret`. */
export async function anthropicFactories(env: Env): Promise<ProviderAdapterFactories> {
  const keys = await loadProviderKeys({ source: envKeySource(env), required: ['anthropic'] });
  return { anthropic: (model: string) => createAnthropicAdapter(keys.get('anthropic'), { model }) };
}

/** `EDMATE_CONTENT_DIR`, else the repo's `content/` (Next runs from apps/web), as the auth does. */
export function contentDir(env: Env): string {
  return env.EDMATE_CONTENT_DIR?.trim() || resolvePath(process.cwd(), '../../content');
}

/**
 * The one market turns run in, until the identity store exposes the student's market. It picks
 * the locale pack, and so the distress helplines: production fails closed (`EDMATE_MARKET`) when
 * it is unset or has no locale pack; dev and tests default to `global`.
 */
function configuredMarket(env: Env, packs: ReadonlyMap<string, unknown>): string {
  const market = env.EDMATE_MARKET?.trim() ?? '';
  if (env.NODE_ENV === 'production') {
    if (!packs.has(market)) throw new TurnUnavailableError('EDMATE_MARKET');
    return market;
  }
  return market || 'global';
}

async function build(env: Env, hooks: RuntimeHooks): Promise<TurnBackend> {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new TurnUnavailableError('REDIS_URL');
  const factories = await anthropicFactories(env).catch(() => {
    throw new TurnUnavailableError('provider_key');
  });
  const dir = contentDir(env);
  const { packs } = loadLocalePacks(join(dir, 'locales'));
  const promptPacks = readPromptPackLibrary(join(dir, 'prompt-packs'));
  const market = configuredMarket(env, packs);
  const { repos, identity } = hooks.database();
  const { queues, limits } = hooks.redis(redisUrl);
  const ports = processPorts(repos, {
    market,
    packMarket: (m) => (packs.has(m) ? m : 'global'),
    locales: (m) => pickLocalePack(m, packs),
    learnerClear: async (id) => (await identity.learnerStatus(id)) === 'clear',
  });
  const turnProcess = {
    repos,
    queues,
    limits,
    factories,
    prices: loadBundledPrices(),
    promptPacks,
    ...ports,
    clock: systemClock(),
    ids: systemIds(),
    log: hooks.log,
  };
  return {
    agents: repos.agents,
    sessions: repos.sessions,
    entitlements: ports.entitlements,
    depsFor: (scope) => turnDepsFor(turnProcess, scope),
    steps: defaultSteps,
    now: () => new Date(),
    log: hooks.log,
  };
}

/**
 * A memoised backend factory. The first call builds; a failure is logged once (its reason code or
 * error name, never a key) and every later call gets the same rejection until the process restarts.
 */
export function createTurnRuntime(env: () => Env, hooks: RuntimeHooks): () => Promise<TurnBackend> {
  let backend: Promise<TurnBackend> | undefined;
  return () => {
    backend ??= build(env(), hooks).catch((error: unknown) => {
      const reason = error instanceof TurnUnavailableError ? error.reason : errorName(error);
      hooks.log.error('turn.runtime_unavailable', { reason });
      throw error;
    });
    return backend;
  };
}

/** The server log: one line per event, codes only. */
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

/**
 * The producer queues and the turn limits on two Redis clients: BullMQ wants no per-request retry
 * cap; the limits fail fast (one retry). Errors are logged by name only (they can quote the host).
 */
export function openRedis(url: string, log: ServerLog): { queues: TurnQueues; limits: TurnLimits } {
  const forQueues = new Redis(url, { maxRetriesPerRequest: null });
  const forLimits = new Redis(url, { maxRetriesPerRequest: 1 });
  for (const client of [forQueues, forLimits]) {
    client.on('error', (error: unknown) => log.error('turn.redis_error', { error: errorName(error) }));
  }
  return { queues: createTurnQueues(forQueues), limits: redisTurnLimits(forLimits) };
}

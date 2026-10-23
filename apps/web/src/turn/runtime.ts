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
import {
  loadLocalePacks,
  pickLocalePack,
  readPersonaLibrary,
  readPromptPackLibrary,
} from '@edmate/content';
import { devFactories, devModelEnabled } from './devModel';
import { processPorts, systemClock, systemIds, turnDepsFor } from './deps';
import { errorName, TurnUnavailableError, type ServerLog, type TurnBackend } from './routes';
import {
  fakeSessionRateLimiter,
  redisSessionRateLimiter,
  type SessionRateLimiter,
} from './sessionRateLimit';

export type Env = Readonly<Record<string, string | undefined>>;

/** What the turn runtime's Redis hook opens: the producer queues and both limiters. */
export interface RuntimeRedis {
  queues: TurnQueues;
  limits: TurnLimits;
  sessionRateLimit: SessionRateLimiter;
}

/** The outside world the runtime opens; injected so tests open nothing real. */
export interface RuntimeHooks {
  /** The auth runtime's repositories and age-policy identity (`serverDatabase()`). */
  database(): { repos: Repositories; identity: Pick<IdentityStore, 'learnerStatus'> };
  /** Queues and the Redis-backed turn limits on `redisUrl`. */
  redis(redisUrl: string): { queues: TurnQueues; limits: TurnLimits };
  log: ServerLog;
}

/**
 * The student turn runtime's hooks (9.4a): its Redis hook also opens the per-student
 * session-start limit, and its identity also reads the student's own market. The studio test
 * chat keeps the narrower `RuntimeHooks`.
 */
export interface TurnRuntimeHooks extends RuntimeHooks {
  database(): {
    repos: Repositories;
    identity: Pick<IdentityStore, 'learnerStatus' | 'getMarket'>;
  };
  redis(redisUrl: string): RuntimeRedis;
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

async function build(env: Env, hooks: TurnRuntimeHooks): Promise<TurnBackend> {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new TurnUnavailableError('REDIS_URL');
  // The dev model (9.0, D2) is honoured only with a local http AUTH_URL; any other setting of
  // EDMATE_DEV_MODEL fails closed here, before any key is read.
  const dev = devModelEnabled(env);
  const factories = dev
    ? devFactories()
    : await anthropicFactories(env).catch(() => {
        throw new TurnUnavailableError('provider_key');
      });
  const dir = contentDir(env);
  const { packs } = loadLocalePacks(join(dir, 'locales'));
  const promptPacks = readPromptPackLibrary(join(dir, 'prompt-packs'));
  // Signed role-play personas (5.8a). A broken dir fails the build like a broken prompt pack. The
  // browser can't send a skill until 9.5, so no web turn reaches a persona yet.
  const personas = readPersonaLibrary(join(dir, 'skills', 'mock_interview'));
  if (dev) hooks.log.error('turn.dev_model_on', {});
  const { repos, identity } = hooks.database();
  const opened = hooks.redis(redisUrl);
  const { queues, limits } = opened;
  // 9.4a fix round (e2e): under the dev model (scripted, local http only) the session-start limit
  // runs in memory, like the scripted adapter stands in for the provider. Playwright's dead
  // REDIS_URL never answers, and a Redis-backed limiter would refuse every start (fail closed,
  // 503). Everywhere else the limiter stays on Redis and keeps failing closed.
  const sessionRateLimit = dev ? fakeSessionRateLimiter() : opened.sessionRateLimit;
  // 9.4a: each student's turns run in their own market (`users.market`, NOT NULL, `global` until
  // the age gate), read fresh per resolve. It picks the locale pack and so the helplines; a market
  // with no pack runs as `global`. No deploy setting picks it, so there is no boot check for one.
  const ports = processPorts(repos, {
    studentMarket: async (id) => (await identity.getMarket(id)) ?? 'global',
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
    personas,
    ...ports,
    clock: systemClock(),
    ids: systemIds(),
    log: hooks.log,
  };
  return {
    agents: repos.agents,
    sessions: repos.sessions,
    entitlements: ports.entitlements,
    sessionRateLimit,
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
export function createTurnRuntime(env: () => Env, hooks: TurnRuntimeHooks): () => Promise<TurnBackend> {
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
 * The producer queues and the limits on two Redis clients: BullMQ wants no per-request retry cap;
 * the turn limits and the session-start limit share the fail-fast client (one retry; no third
 * connection). Errors are logged by name only (they can quote the host).
 */
export function openRedis(url: string, log: ServerLog): RuntimeRedis {
  const forQueues = new Redis(url, { maxRetriesPerRequest: null });
  const forLimits = new Redis(url, { maxRetriesPerRequest: 1 });
  for (const client of [forQueues, forLimits]) {
    client.on('error', (error: unknown) => log.error('turn.redis_error', { error: errorName(error) }));
  }
  return {
    queues: createTurnQueues(forQueues),
    limits: redisTurnLimits(forLimits),
    sessionRateLimit: redisSessionRateLimiter(forLimits),
  };
}

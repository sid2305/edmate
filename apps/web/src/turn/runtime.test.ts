// The web's turn runtime (task 9.4): built lazily, once; a missing Redis URL or provider key
// fails the build by reason code (logged once), never by key; Redis opens nothing real here.
import type { Repositories } from '@edmate/db';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleLog, contentDir, createTurnRuntime, openRedis, type RuntimeHooks } from './runtime';
import { TurnUnavailableError } from './routes';

const opened = vi.hoisted(() => ({ clients: [] as { url: string; options: Record<string, unknown> }[] }));

vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');
  class Redis extends EventEmitter {
    constructor(url: string, options: Record<string, unknown>) {
      super();
      opened.clients.push({ url, options });
    }
  }
  return { Redis, default: Redis };
});

vi.mock('@edmate/queue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createTurnQueues: (connection: unknown) => ({ kind: 'queues', connection }),
  redisTurnLimits: (redis: unknown) => ({ kind: 'limits', redis }),
}));

const CONTENT = fileURLToPath(new URL('../../../../content/', import.meta.url));
// Synthetic, not a key: the adapter is built but never called.
const ENV = { REDIS_URL: 'redis://127.0.0.1:6399', EDMATE_ANTHROPIC_API_KEY: 'test-only-placeholder', EDMATE_CONTENT_DIR: CONTENT };

function hooks() {
  const repos = { agents: { tag: 'agents' }, sessions: { tag: 'sessions' } } as unknown as Repositories;
  const log = vi.fn();
  const h = {
    database: vi.fn(() => ({ repos, identity: { learnerStatus: async () => 'clear' as const } })),
    redis: vi.fn(() => ({ queues: {} as never, limits: {} as never })),
    log: { error: log },
  } satisfies RuntimeHooks;
  return { h, log, repos };
}

afterEach(() => {
  opened.clients.length = 0;
  vi.restoreAllMocks();
});

describe('createTurnRuntime', () => {
  it('builds once, lazily, from the auth database and the Redis URL', async () => {
    const { h, repos } = hooks();
    const runtime = createTurnRuntime(() => ENV, h);
    expect(h.database).not.toHaveBeenCalled();
    const backend = await runtime();
    expect(await runtime()).toBe(backend);
    expect(h.database).toHaveBeenCalledTimes(1);
    expect(h.redis).toHaveBeenCalledWith('redis://127.0.0.1:6399');
    expect(backend.agents).toBe(repos.agents);
    expect(backend.sessions).toBe(repos.sessions);
    expect(backend.now()).toBeInstanceOf(Date);
    expect(typeof backend.depsFor).toBe('function');
    expect(backend.log).toBe(h.log);
  });

  it('a missing REDIS_URL fails with its reason code, logged once', async () => {
    const { h, log } = hooks();
    const runtime = createTurnRuntime(() => ({ ...ENV, REDIS_URL: '  ' }), h);
    await expect(runtime()).rejects.toBeInstanceOf(TurnUnavailableError);
    await expect(runtime()).rejects.toThrow('REDIS_URL');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('turn.runtime_unavailable', { reason: 'REDIS_URL' });
    expect(h.database).not.toHaveBeenCalled();
  });

  it('a missing provider key fails as provider_key, never quoting a key', async () => {
    const { h, log } = hooks();
    const runtime = createTurnRuntime(() => ({ ...ENV, EDMATE_ANTHROPIC_API_KEY: undefined }), h);
    await expect(runtime()).rejects.toThrow('provider_key');
    expect(log).toHaveBeenCalledWith('turn.runtime_unavailable', { reason: 'provider_key' });
  });

  it('any other failure is logged by error name', async () => {
    const { h, log } = hooks();
    h.database.mockImplementation(() => {
      throw new RangeError('database url with a password');
    });
    await expect(createTurnRuntime(() => ENV, h)()).rejects.toBeInstanceOf(RangeError);
    expect(log).toHaveBeenCalledWith('turn.runtime_unavailable', { reason: 'RangeError' });
  });
});

describe('contentDir', () => {
  it('uses EDMATE_CONTENT_DIR, else the repo content folder', () => {
    expect(contentDir({ EDMATE_CONTENT_DIR: '/srv/content' })).toBe('/srv/content');
    expect(contentDir({})).toMatch(/content$/);
  });
});

describe('consoleLog', () => {
  it('writes one line per event, with its fields', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = consoleLog('[turn]');
    log.error('turn.a', { x: '1', y: '2' });
    log.error('turn.b');
    expect(spy.mock.calls).toEqual([['[turn] turn.a x=1 y=2'], ['[turn] turn.b']]);
  });
});

describe('openRedis', () => {
  it('opens a queue client and a fail-fast limits client, logging errors by name', () => {
    const log = vi.fn();
    const out = openRedis('redis://127.0.0.1:6399', { error: log }) as unknown as {
      queues: { connection: { emit(e: string, x: unknown): void } };
      limits: { redis: { emit(e: string, x: unknown): void } };
    };
    expect(opened.clients.map((c) => c.options)).toEqual([
      { maxRetriesPerRequest: null },
      { maxRetriesPerRequest: 1 },
    ]);
    out.queues.connection.emit('error', new TypeError('connect ECONNREFUSED 127.0.0.1:6399'));
    out.limits.redis.emit('error', 'not an error');
    expect(log.mock.calls[0]).toEqual(['turn.redis_error', { error: 'TypeError' }]);
    expect(log.mock.calls).toHaveLength(2);
  });
});

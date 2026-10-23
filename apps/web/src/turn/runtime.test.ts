// The web's turn runtime (task 9.4): built lazily, once; a missing Redis URL or provider key
// fails the build by reason code (logged once), never by key; Redis opens nothing real here.
import type { Repositories } from '@edmate/db';
import type * as Gateway from '@edmate/gateway';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleLog, contentDir, createTurnRuntime, openRedis, type TurnRuntimeHooks } from './runtime';
import { TurnUnavailableError } from './routes';

const opened = vi.hoisted(() => ({ clients: [] as { url: string; options: Record<string, unknown> }[] }));

vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');
  class Redis extends EventEmitter {
    readonly defined: string[] = [];
    constructor(url: string, options: Record<string, unknown>) {
      super();
      opened.clients.push({ url, options });
    }
    defineCommand(name: string): void {
      this.defined.push(name);
    }
  }
  return { Redis, default: Redis };
});

const keys = vi.hoisted(() => ({ loads: 0 }));

vi.mock('@edmate/gateway', async (importOriginal) => {
  const real = await importOriginal<typeof Gateway>();
  return {
    ...real,
    loadProviderKeys: (...args: Parameters<typeof real.loadProviderKeys>) => {
      keys.loads += 1;
      return real.loadProviderKeys(...args);
    },
  };
});

vi.mock('@edmate/queue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createTurnQueues: (connection: unknown) => ({ kind: 'queues', connection }),
  redisTurnLimits: (redis: unknown) => ({ kind: 'limits', redis }),
}));

const CONTENT = fileURLToPath(new URL('../../../../content/', import.meta.url));
// Synthetic, not a key: the adapter is built but never called.
const ENV = { REDIS_URL: 'redis://127.0.0.1:6399', EDMATE_ANTHROPIC_API_KEY: 'test-only-placeholder', EDMATE_CONTENT_DIR: CONTENT };

/** Stub repositories: every student has a live subscription to `agt_a` (one module, one skill). */
function subscribedRepos(): Repositories {
  const pkg = { id: 'pkg_a', version: 1, agentId: 'agt_a', moduleIds: ['mod_a1'], skills: ['explain'] };
  return {
    agents: { tag: 'agents', owner: async () => ({ teacherId: 'tch_a' }) },
    sessions: { tag: 'sessions' },
    subscriptions: {
      findLive: async () => ({ id: 'sub_1', packageVersionId: 'pv_a', status: 'active', periodEnd: '2026-12-01T00:00:00.000Z' }),
    },
    packageVersions: { getById: async () => pkg },
    modules: { ids: async () => ['mod_a1'] },
  } as unknown as Repositories;
}

function hooks(markets: Record<string, string | null> = {}) {
  const sessionRateLimit = { take: async () => true };
  const repos = subscribedRepos();
  const log = vi.fn();
  const getMarket = vi.fn(async (id: string) => markets[id] ?? null);
  const h = {
    database: vi.fn(() => ({ repos, identity: { learnerStatus: async () => 'clear' as const, getMarket } })),
    redis: vi.fn(() => ({ queues: {} as never, limits: {} as never, sessionRateLimit })),
    log: { error: log },
  } satisfies TurnRuntimeHooks;
  return { h, log, repos, sessionRateLimit, getMarket };
}

afterEach(() => {
  opened.clients.length = 0;
  keys.loads = 0;
  vi.restoreAllMocks();
});

describe('createTurnRuntime', () => {
  it('builds once, lazily, from the auth database and the Redis URL', async () => {
    const { h, repos, sessionRateLimit } = hooks();
    const runtime = createTurnRuntime(() => ENV, h);
    expect(h.database).not.toHaveBeenCalled();
    const backend = await runtime();
    expect(await runtime()).toBe(backend);
    expect(h.database).toHaveBeenCalledTimes(1);
    expect(h.redis).toHaveBeenCalledWith('redis://127.0.0.1:6399');
    expect(backend.agents).toBe(repos.agents);
    expect(backend.sessions).toBe(repos.sessions);
    // 9.4a: the session-start limit comes from the Redis hook, not built inside build().
    expect(backend.sessionRateLimit).toBe(sessionRateLimit);
    expect(backend.now()).toBeInstanceOf(Date);
    expect(typeof backend.depsFor).toBe('function');
    expect(backend.log).toBe(h.log);
  });

  it('holds the signed persona library from content/skills/mock_interview (5.8a)', async () => {
    const { h } = hooks();
    const backend = await createTurnRuntime(() => ENV, h)();
    const deps = backend.depsFor({ studentId: 'stu_1', teacherId: 'tch_a' } as Parameters<typeof backend.depsFor>[0]);
    expect([...(deps.personas?.keys() ?? [])].sort()).toEqual(['job-interview', 'viva']);
  });

  it('a broken persona file fails the runtime build like a broken prompt pack (5.8a)', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'edmate-content-'));
    try {
      for (const sub of ['locales', 'prompt-packs', 'skills']) {
        cpSync(join(CONTENT, sub), join(copy, sub), { recursive: true });
      }
      writeFileSync(join(copy, 'skills', 'mock_interview', 'job-interview@1.0.0.yaml'), 'id: [unclosed\n');
      const { h, log } = hooks();
      const runtime = createTurnRuntime(() => ({ ...ENV, EDMATE_CONTENT_DIR: copy }), h);
      await expect(runtime()).rejects.toThrow();
      await expect(runtime()).rejects.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[0]).toBe('turn.runtime_unavailable');
      expect(h.database).not.toHaveBeenCalled();
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
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

  it('no EDMATE_MARKET is read: production builds without one, whatever it is set to', async () => {
    for (const market of [undefined, '  ', 'ZZ', 'IN']) {
      const { h, log } = hooks();
      const env = { ...ENV, NODE_ENV: 'production', EDMATE_MARKET: market };
      await expect(createTurnRuntime(() => env, h)()).resolves.toBeDefined();
      expect(log).not.toHaveBeenCalled();
    }
  });

  describe("a subscription runs in the student's own market (9.4a)", () => {
    const AT = '2026-10-22T10:00:00.000Z';
    const marketOf = async (markets: Record<string, string | null>, studentId: string, env = ENV) => {
      const { h, getMarket } = hooks(markets);
      const backend = await createTurnRuntime(() => env, h)();
      const e = await backend.entitlements.resolve({ studentId, agentId: 'agt_a', source: 'subscription' }, AT);
      return { market: e?.market, getMarket };
    };

    it("reads each student's market from identity, fresh per resolve, keyed by the student id", async () => {
      const markets = { stu_in: 'IN', stu_us: 'US' };
      const env = { ...ENV, NODE_ENV: 'production', EDMATE_MARKET: 'US' };
      const inStudent = await marketOf(markets, 'stu_in', env);
      expect(inStudent.market).toBe('IN');
      expect(inStudent.getMarket).toHaveBeenCalledWith('stu_in');
      expect((await marketOf(markets, 'stu_us', env)).market).toBe('US');
    });

    it('a market with no locale pack runs as global; global stays global', async () => {
      expect((await marketOf({ stu_zz: 'ZZ' }, 'stu_zz')).market).toBe('global');
      expect((await marketOf({ stu_g: 'global' }, 'stu_g')).market).toBe('global');
    });

    it('an unknown student id (no market row) falls back to global', async () => {
      const { market, getMarket } = await marketOf({}, 'stu_gone');
      expect(market).toBe('global');
      expect(getMarket).toHaveBeenCalledWith('stu_gone');
    });

    it('an identity failure fails the resolve, never a default market', async () => {
      const { h, getMarket } = hooks();
      getMarket.mockRejectedValue(new Error('identity down'));
      const backend = await createTurnRuntime(() => ENV, h)();
      await expect(
        backend.entitlements.resolve({ studentId: 'stu_in', agentId: 'agt_a', source: 'subscription' }, AT),
      ).rejects.toThrow('identity down');
    });
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

describe('createTurnRuntime with the dev model (9.0, D2)', () => {
  const NO_KEY = { ...ENV, EDMATE_ANTHROPIC_API_KEY: undefined, EDMATE_DEV_MODEL: 'scripted' };

  it('on localhost, builds with no provider key, logs turn.dev_model_on and loads no key', async () => {
    for (const url of ['http://localhost:8080', 'http://127.0.0.1:18080', 'http://[::1]:8080']) {
      const { h, log } = hooks();
      const env = { ...NO_KEY, NODE_ENV: 'production', AUTH_URL: url };
      await expect(createTurnRuntime(() => env, h)()).resolves.toBeDefined();
      expect(log.mock.calls).toEqual([['turn.dev_model_on', {}]]);
    }
    expect(keys.loads).toBe(0);
  });

  it('anywhere else, or with AUTH_URL unset, fails closed by its code alone', async () => {
    for (const url of ['https://edmate.example', 'http://10.0.0.5:8080', undefined]) {
      const { h, log } = hooks();
      const runtime = createTurnRuntime(() => ({ ...NO_KEY, AUTH_URL: url }), h);
      await expect(runtime()).rejects.toBeInstanceOf(TurnUnavailableError);
      await expect(runtime()).rejects.toThrow('EDMATE_DEV_MODEL');
      expect(log.mock.calls).toEqual([['turn.runtime_unavailable', { reason: 'EDMATE_DEV_MODEL' }]]);
      expect(JSON.stringify(log.mock.calls)).not.toContain('edmate.example');
      expect(h.database).not.toHaveBeenCalled();
    }
    expect(keys.loads).toBe(0);
  });

  it('only the exact value turns it on: yes or Scripted fail closed, even with a key', async () => {
    for (const flag of ['yes', 'Scripted']) {
      const { h, log } = hooks();
      const env = { ...ENV, EDMATE_DEV_MODEL: flag, AUTH_URL: 'http://localhost:8080' };
      await expect(createTurnRuntime(() => env, h)()).rejects.toThrow('EDMATE_DEV_MODEL');
      expect(log).toHaveBeenCalledWith('turn.runtime_unavailable', { reason: 'EDMATE_DEV_MODEL' });
    }
  });

  it('uses an in-memory session-start limiter, not the Redis one (9.4a e2e fix round)', async () => {
    const { h, sessionRateLimit } = hooks();
    const failing = { take: () => Promise.reject(new Error('connect ECONNREFUSED')) };
    h.redis.mockReturnValue({ queues: {} as never, limits: {} as never, sessionRateLimit: failing });
    const env = { ...NO_KEY, AUTH_URL: 'http://127.0.0.1:3111' };
    const backend = await createTurnRuntime(() => env, h)();
    expect(backend.sessionRateLimit).not.toBe(failing);
    expect(backend.sessionRateLimit).not.toBe(sessionRateLimit);
    await expect(backend.sessionRateLimit.take('stu_1')).resolves.toBe(true);
  });

  it('with the dev model off, the Redis limiter is kept and still fails closed', async () => {
    const { h } = hooks();
    const failing = { take: () => Promise.reject(new Error('connect ECONNREFUSED')) };
    h.redis.mockReturnValue({ queues: {} as never, limits: {} as never, sessionRateLimit: failing });
    const backend = await createTurnRuntime(() => ({ ...ENV, AUTH_URL: 'http://127.0.0.1:3111' }), h)();
    expect(backend.sessionRateLimit).toBe(failing);
    await expect(backend.sessionRateLimit.take('stu_1')).rejects.toThrow('ECONNREFUSED');
  });

  it('unset or empty keeps today: no key fails as provider_key', async () => {
    for (const flag of [undefined, '']) {
      const { h, log } = hooks();
      const env = { ...NO_KEY, EDMATE_DEV_MODEL: flag, AUTH_URL: 'http://localhost:8080' };
      await expect(createTurnRuntime(() => env, h)()).rejects.toThrow('provider_key');
      expect(log).toHaveBeenCalledWith('turn.runtime_unavailable', { reason: 'provider_key' });
    }
    expect(keys.loads).toBe(2);
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
      { maxRetriesPerRequest: 1, commandTimeout: 2_000, connectTimeout: 5_000 },
    ]);
    out.queues.connection.emit('error', new TypeError('connect ECONNREFUSED 127.0.0.1:6399'));
    out.limits.redis.emit('error', 'not an error');
    expect(log.mock.calls[0]).toEqual(['turn.redis_error', { error: 'TypeError' }]);
    expect(log.mock.calls).toHaveLength(2);
  });

  it('builds the session-start limit on the fail-fast limits client (no third connection)', () => {
    const out = openRedis('redis://127.0.0.1:6399', { error: vi.fn() }) as unknown as {
      limits: { redis: { defined: string[] } };
      sessionRateLimit: { take(id: string): Promise<boolean> };
    };
    expect(opened.clients).toHaveLength(2);
    expect(out.limits.redis.defined).toEqual(['edmateSessionStartTake']);
    expect(typeof out.sessionRateLimit.take).toBe('function');
  });
});

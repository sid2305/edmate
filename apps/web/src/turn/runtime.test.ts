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

function hooks() {
  const sessionRateLimit = { take: async () => true };
  const repos = { agents: { tag: 'agents' }, sessions: { tag: 'sessions' } } as unknown as Repositories;
  const log = vi.fn();
  const h = {
    database: vi.fn(() => ({ repos, identity: { learnerStatus: async () => 'clear' as const } })),
    redis: vi.fn(() => ({ queues: {} as never, limits: {} as never, sessionRateLimit })),
    log: { error: log },
  } satisfies TurnRuntimeHooks;
  return { h, log, repos, sessionRateLimit };
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

  it('in production, an unset or unknown EDMATE_MARKET fails closed by its code alone', async () => {
    for (const market of [undefined, '  ', 'ZZ', 'not-a-market']) {
      const { h, log } = hooks();
      const env = { ...ENV, NODE_ENV: 'production', EDMATE_MARKET: market };
      const runtime = createTurnRuntime(() => env, h);
      await expect(runtime()).rejects.toBeInstanceOf(TurnUnavailableError);
      await expect(runtime()).rejects.toThrow('EDMATE_MARKET');
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('turn.runtime_unavailable', { reason: 'EDMATE_MARKET' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('not-a-market');
      expect(h.database).not.toHaveBeenCalled();
    }
  });

  it('in production, a known EDMATE_MARKET builds', async () => {
    for (const market of ['IN', ' US ', 'global']) {
      const { h, log } = hooks();
      const env = { ...ENV, NODE_ENV: 'production', EDMATE_MARKET: market };
      await expect(createTurnRuntime(() => env, h)()).resolves.toBeDefined();
      expect(log).not.toHaveBeenCalled();
    }
  });

  it('outside production, an unset market keeps the global default', async () => {
    for (const nodeEnv of [undefined, 'development', 'test']) {
      const { h, log } = hooks();
      const env = { ...ENV, NODE_ENV: nodeEnv, EDMATE_MARKET: undefined };
      await expect(createTurnRuntime(() => env, h)()).resolves.toBeDefined();
      expect(log).not.toHaveBeenCalled();
    }
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
      const env = { ...NO_KEY, NODE_ENV: 'production', EDMATE_MARKET: 'US', AUTH_URL: url };
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
      { maxRetriesPerRequest: 1 },
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

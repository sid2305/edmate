// The test chat's runtime (task 8.5 Phase B): built lazily, once, from the auth database and Redis;
// a missing Redis URL or provider key fails the build by reason code (logged once), never by key.
import type { Repositories } from '@edmate/db';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeHooks } from '../../turn/runtime';
import { TurnUnavailableError } from '../../turn/routes';
import { createTestChatRuntime } from './runtime';

const CONTENT = fileURLToPath(new URL('../../../../../content/', import.meta.url));
// Synthetic, not a key: the adapter is built but never called.
const ENV = {
  REDIS_URL: 'redis://127.0.0.1:6399',
  EDMATE_ANTHROPIC_API_KEY: 'test-only-placeholder',
  EDMATE_CONTENT_DIR: CONTENT,
};

function hooks() {
  const repos = {
    agents: { tag: 'agents' },
    agentVersions: { tag: 'agentVersions' },
    packageVersions: { tag: 'packageVersions' },
    sessions: { tag: 'sessions' },
    corrections: { tag: 'corrections' },
  } as unknown as Repositories;
  const log = vi.fn();
  const h = {
    database: vi.fn(() => ({ repos, identity: { learnerStatus: async () => 'clear' as const } })),
    redis: vi.fn(() => ({ queues: {} as never, limits: {} as never })),
    log: { error: log },
  } satisfies RuntimeHooks;
  return { h, log, repos };
}

describe('createTestChatRuntime', () => {
  it('builds once, lazily, over the repositories, with teacher_preview deps per package', async () => {
    const { h, repos, log } = hooks();
    const runtime = createTestChatRuntime(() => ENV, h);
    expect(h.database).not.toHaveBeenCalled();
    const backend = await runtime();
    expect(await runtime()).toBe(backend);
    expect(h.database).toHaveBeenCalledTimes(1);
    expect(h.redis).toHaveBeenCalledWith('redis://127.0.0.1:6399');
    expect(backend.agents).toBe(repos.agents);
    expect(backend.agentVersions).toBe(repos.agentVersions);
    expect(backend.packageVersions).toBe(repos.packageVersions);
    expect(backend.sessions).toBe(repos.sessions);
    expect(backend.corrections).toBe(repos.corrections);
    expect(backend.now()).toBeInstanceOf(Date);
    expect(backend.log).toBe(h.log);
    expect(typeof backend.previewEntitlements('pkg_a').resolve).toBe('function');
    const deps = backend.depsFor(
      { studentId: 'tch_a', teacherId: 'tch_a' } as Parameters<typeof backend.depsFor>[0],
      'pkg_a',
    );
    expect(deps.entitlementSource).toBe('teacher_preview');
    expect([...(deps.personas?.keys() ?? [])].sort()).toEqual(['job-interview', 'viva']);
    expect(log).not.toHaveBeenCalled();
  });

  it('a missing REDIS_URL fails with its reason code, logged once', async () => {
    const { h, log } = hooks();
    const runtime = createTestChatRuntime(() => ({ ...ENV, REDIS_URL: ' ' }), h);
    await expect(runtime()).rejects.toBeInstanceOf(TurnUnavailableError);
    await expect(runtime()).rejects.toThrow('REDIS_URL');
    expect(log.mock.calls).toEqual([['testChat.runtime_unavailable', { reason: 'REDIS_URL' }]]);
    expect(h.database).not.toHaveBeenCalled();
  });

  it('a missing provider key fails as provider_key', async () => {
    const { h, log } = hooks();
    const runtime = createTestChatRuntime(() => ({ ...ENV, EDMATE_ANTHROPIC_API_KEY: undefined }), h);
    await expect(runtime()).rejects.toThrow('provider_key');
    expect(log).toHaveBeenCalledWith('testChat.runtime_unavailable', { reason: 'provider_key' });
  });

  it('in production, an unknown EDMATE_MARKET fails closed; a known one builds', async () => {
    const bad = hooks();
    const env = { ...ENV, NODE_ENV: 'production', EDMATE_MARKET: 'ZZ' };
    await expect(createTestChatRuntime(() => env, bad.h)()).rejects.toThrow('EDMATE_MARKET');
    const good = hooks();
    const ok = { ...ENV, NODE_ENV: 'production', EDMATE_MARKET: 'US' };
    await expect(createTestChatRuntime(() => ok, good.h)()).resolves.toBeDefined();
  });

  it('the dev model on localhost builds with no key and logs testChat.dev_model_on', async () => {
    const { h, log } = hooks();
    const env = {
      ...ENV,
      EDMATE_ANTHROPIC_API_KEY: undefined,
      EDMATE_DEV_MODEL: 'scripted',
      AUTH_URL: 'http://localhost:8080',
    };
    await expect(createTestChatRuntime(() => env, h)()).resolves.toBeDefined();
    expect(log.mock.calls).toEqual([['testChat.dev_model_on', {}]]);
  });

  it('any other failure is logged by error name', async () => {
    const { h, log } = hooks();
    h.database.mockImplementation(() => {
      throw new RangeError('database url with a password');
    });
    await expect(createTestChatRuntime(() => ENV, h)()).rejects.toBeInstanceOf(RangeError);
    expect(log).toHaveBeenCalledWith('testChat.runtime_unavailable', { reason: 'RangeError' });
  });
});

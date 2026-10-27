// Task 9.0c: a fresh web container's first turn must not be the pool's first-ever query.
// `register()` (the Next.js instrumentation convention) warms the shared pool at process start --
// mocked DB throughout; no real connection (build plan rule 4).
import { afterEach, describe, expect, it, vi } from 'vitest';

const search = vi.hoisted(() => vi.fn(async () => ({ teachers: [], hasMore: false })));
const serverDatabase = vi.hoisted(() =>
  vi.fn(() => ({ repos: { discovery: { search } }, identity: {} }) as unknown),
);
const warmPreGuardPatterns = vi.hoisted(() => vi.fn((): readonly string[] => []));

vi.mock('./src/auth', () => ({ serverDatabase }));
vi.mock('@edmate/harness', () => ({ warmPreGuardPatterns }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('register (web container start, task 9.0c)', () => {
  it('runs one warm-up read through serverDatabase on the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const { register } = await import('./instrumentation');
    // `undefined`, not a Promise: pins `register()` as non-async, so Next never awaits the warm-up.
    expect(register()).toBeUndefined();
    // The warm-up is a microtask chain (dynamic import + one query); flush it.
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(serverDatabase).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({});
  });

  it('does nothing on a non-Node.js runtime (Edge must never pull in pg)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    const { register } = await import('./instrumentation');
    register();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(serverDatabase).not.toHaveBeenCalled();
  });

  it('does nothing when NEXT_RUNTIME is unset', async () => {
    vi.stubEnv('NEXT_RUNTIME', undefined);
    const { register } = await import('./instrumentation');
    register();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(serverDatabase).not.toHaveBeenCalled();
  });

  it('never throws and never blocks startup when the warm-up read rejects', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    search.mockRejectedValueOnce(new Error('connection refused: user=admin@example.com'));
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((msg: string) => {
      logs.push(msg);
    });
    const { register } = await import('./instrumentation');
    expect(() => register()).not.toThrow();
    await vi.waitFor(() => expect(logs.length).toBeGreaterThan(0));
    // Only the error's name may be logged -- never a message that could carry an email or a
    // connection string.
    expect(logs[0]).toContain('Error');
    expect(logs[0]).not.toContain('admin@example.com');
    expect(logs[0]).not.toContain('connection refused');
  });

  it('never throws when no database is configured (serverDatabase itself throws synchronously)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    serverDatabase.mockImplementationOnce(() => {
      throw new Error('DATABASE_URL is not set');
    });
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((msg: string) => {
      logs.push(msg);
    });
    const { register } = await import('./instrumentation');
    expect(() => register()).not.toThrow();
    await vi.waitFor(() => expect(logs.length).toBeGreaterThan(0));
    expect(logs[0]).toContain('Error');
    expect(logs[0]).not.toContain('DATABASE_URL');
  });

  it('never throws and logs the error name when warmPreGuardPatterns itself throws', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    warmPreGuardPatterns.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((msg: string) => {
      logs.push(msg);
    });
    const { register } = await import('./instrumentation');
    expect(() => register()).not.toThrow();
    await vi.waitFor(() => expect(logs.length).toBeGreaterThan(0));
    expect(logs.some((l) => l.includes('Error'))).toBe(true);
  });

  it('logs the matcher name when warmPreGuardPatterns returns a non-empty list', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    warmPreGuardPatterns.mockReturnValueOnce(['moderation']);
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((msg: string) => {
      logs.push(msg);
    });
    const { register } = await import('./instrumentation');
    expect(() => register()).not.toThrow();
    await vi.waitFor(() => expect(logs.length).toBeGreaterThan(0));
    expect(logs.some((l) => l.includes('moderation'))).toBe(true);
  });

  it('does not await the warm-up before returning (startup/health are never blocked)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    let resolveSearch: (() => void) | undefined;
    search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearch = () => resolve({ teachers: [], hasMore: false });
        }),
    );
    const { register } = await import('./instrumentation');
    register();
    // register() has already returned synchronously -- the warm-up promise is still pending.
    expect(resolveSearch).toBeUndefined();
    await vi.waitFor(() => expect(resolveSearch).toBeDefined());
    resolveSearch?.();
  });
});

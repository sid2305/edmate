// Tasks 1.3, 1.4: the wired-up auth module reads nothing at import (so /api/health and `next build`
// work without AUTH_*), reads env lazily on the first auth call, and fails closed when it can't.
// ioredis and nodemailer are faked: no socket is opened.
import type { EventEmitter } from 'node:events';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REDIS_READY_TIMEOUT_MS } from './redis-ready';

const fakes = vi.hoisted(() => ({
  redis: [] as Array<{ url: string; options: Record<string, unknown>; take: unknown[][] }>,
  transports: [] as Array<{ options: Record<string, unknown>; sent: Record<string, unknown>[] }>,
}));

vi.mock('ioredis', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Redis extends Emitter {
    status = 'connecting';
    readonly record: { url: string; options: Record<string, unknown>; take: unknown[][] };
    constructor(url: string, options: Record<string, unknown>) {
      super();
      this.record = { url, options, take: [] };
      fakes.redis.push(this.record);
      Object.assign(this.record, { instance: this });
    }
    defineCommand(name: string) {
      (this as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        this.record.take.push(args);
        return 1;
      };
    }
  }
  return { Redis, default: Redis };
});

// The identity store is in memory, so a link request reaches the limiter and the mail.
vi.mock('@edmate/db', async (importOriginal) => {
  const { memoryIdentity } = await import('../../test/memory-identity');
  return {
    ...(await importOriginal<object>()),
    openDatabase: () => ({ identity: memoryIdentity() }),
  };
});

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      const t = { options, sent: [] as Record<string, unknown>[] };
      fakes.transports.push(t);
      return { sendMail: async (m: Record<string, unknown>) => void t.sent.push(m) };
    },
  },
}));

const pageCookies = vi.fn(async () => ({ get: (_name: string) => undefined, set: vi.fn() }));
const pageHeaders = vi.fn(async () => new Headers({ host: 'localhost:8080' }));
vi.mock('next/headers', () => ({ cookies: pageCookies, headers: pageHeaders }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

const ORIGIN = 'http://localhost:8080';
/** This test's `load()` cold-imports next-auth; CI is slower than a warm local cache. */
const AUTH_IMPORT_TIMEOUT_MS = 20_000;

function setAuthEnv() {
  vi.stubEnv('AUTH_SECRET', 'test-only-'.padEnd(40, 'x'));
  vi.stubEnv('AUTH_URL', ORIGIN);
  vi.stubEnv('AUTH_TRUST_HOST', 'true');
  vi.stubEnv('AUTH_GOOGLE_ID', 'test-client.apps.example');
  vi.stubEnv('AUTH_GOOGLE_SECRET', 'test-google-client-value');
  // The pool connects lazily; nothing below runs a query.
  vi.stubEnv('DATABASE_URL', 'postgres://edmate@127.0.0.1:9/none');
}

async function load() {
  vi.resetModules();
  return import('./index');
}

function setEmailOnlyEnv() {
  vi.stubEnv('AUTH_SECRET', 'test-only-'.padEnd(40, 'x'));
  vi.stubEnv('AUTH_URL', ORIGIN);
  vi.stubEnv('AUTH_TRUST_HOST', 'true');
  vi.stubEnv('EMAIL_SERVER', ['smtp://', 'mailpit.example.test:1025'].join(''));
  vi.stubEnv('EMAIL_FROM', 'Edmate <sign-in@example.test>');
  vi.stubEnv('REDIS_URL', 'redis://redis.example.test:6379');
  vi.stubEnv('DATABASE_URL', 'postgres://edmate@127.0.0.1:9/none');
}

/** A CSRF-carrying link request through the real handlers. */
async function requestLink(auth: Awaited<ReturnType<typeof load>>) {
  const csrf = await auth.handlers.GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const cookie = csrf.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return auth.handlers.POST(
    new NextRequest(`${ORIGIN}/api/auth/signin/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
        'x-forwarded-for': '203.0.113.9',
      },
      body: new URLSearchParams({ csrfToken, email: 'cold@example.test' }).toString(),
    }),
  );
}

describe('src/auth wiring', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', undefined);
    fakes.redis.length = 0;
    fakes.transports.length = 0;
  });

  it(
    'imports and serves public routes with no AUTH_* or DATABASE_URL set',
    async () => {
      const auth = await load();
      const health = auth.publicRoute(() => new Response('ok'));
      expect(health().status).toBe(200);
    },
    AUTH_IMPORT_TIMEOUT_MS,
  );

  it('a guarded route without sign-in config is 500 provider_error, never anonymous', async () => {
    const auth = await load();
    const route = auth.withRole(['student'], () => new Response('ok'));
    const res = await route(new NextRequest(`${ORIGIN}/api/me/progress`));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'provider_error', retryable: true } });
  });

  it('with config: no cookie is 401, and cross-site writes are 403', async () => {
    setAuthEnv();
    const auth = await load();
    const route = auth.withRole(['student'], () => new Response('ok'));
    expect((await route(new NextRequest(`${ORIGIN}/api/me/progress`))).status).toBe(401);
    const post = auth.withRole(['student'], () => new Response('ok'));
    const res = await post(
      new NextRequest(`${ORIGIN}/api/subscriptions`, {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('handlers serve Auth.js: Google is the only provider; no cookie means no session', async () => {
    setAuthEnv();
    const auth = await load();
    const providers = await auth.handlers.GET(new NextRequest(`${ORIGIN}/api/auth/providers`));
    expect(Object.keys((await providers.json()) as object)).toEqual(['google']);
    const session = await auth.handlers.GET(new NextRequest(`${ORIGIN}/api/auth/session`));
    expect(await session.json()).toBeNull();
    const post = await auth.handlers.POST(
      new NextRequest(`${ORIGIN}/api/auth/signin/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'callbackUrl=%2F',
      }),
    );
    // No CSRF token: Auth.js refuses to start the flow.
    expect(post.headers.get('location') ?? '').not.toContain('accounts.google.com');
  });

  it('requireRole redirects an anonymous page visitor to sign-in', async () => {
    setAuthEnv();
    const auth = await load();
    await expect(auth.requireRole(['student'])).rejects.toThrow('REDIRECT /api/auth/signin');
    expect(pageCookies).toHaveBeenCalled();
  });

  it('signIn refuses the email provider: links go only through the rate-limited route', async () => {
    setEmailOnlyEnv();
    const auth = await load();
    await expect(auth.signIn('email', { email: 'a@example.test', redirect: false })).rejects.toThrow(
      'email sign-in goes through /api/auth/signin/email only',
    );
    expect(fakes.redis).toHaveLength(0);
  });

  it('email only: the email provider, a fail-fast Redis client and SMTP with timeouts', async () => {
    setEmailOnlyEnv();
    const auth = await load();
    const providers = await auth.handlers.GET(new NextRequest(`${ORIGIN}/api/auth/providers`));
    expect(Object.keys((await providers.json()) as object)).toEqual(['email']);
    expect(fakes.redis).toHaveLength(1);
    expect(fakes.redis[0]).toMatchObject({
      url: 'redis://redis.example.test:6379',
      options: { maxRetriesPerRequest: 1, enableOfflineQueue: false },
    });
    expect(fakes.transports[0]?.options).toMatchObject({ requireTLS: false, socketTimeout: 10_000 });
  });

  it(
    'cold start: a link request waits for Redis to be ready, then is counted and mailed',
    async () => {
      setEmailOnlyEnv();
      const auth = await load();
      const pending = requestLink(auth);
      const record = await vi.waitFor(() => {
        const r = fakes.redis[0] as unknown as { instance: EventEmitter & { status: string } };
        expect(r.instance.listenerCount('ready')).toBeGreaterThan(0);
        return r;
      });
      record.instance.status = 'ready';
      record.instance.emit('ready');
      const res = await pending;
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/api/auth/verify-request?provider=email&type=email`,
      );
      expect(fakes.redis[0]?.take).toHaveLength(2);
      expect(fakes.transports[0]?.sent).toHaveLength(1);
      expect(fakes.transports[0]?.sent[0]).toMatchObject({ to: 'cold@example.test' });
      expect(String(fakes.transports[0]?.sent[0]?.text)).toContain(`${ORIGIN}/api/auth/callback/email?`);
    },
    AUTH_IMPORT_TIMEOUT_MS,
  );

  it(
    'cold start: Redis never ready within the bound → fail closed, no count and no mail',
    async () => {
      setEmailOnlyEnv();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const auth = await load();
      const res = await requestLink(auth);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/api/auth/error?error=AccessDenied`);
      expect(fakes.redis[0]?.take).toHaveLength(0);
      expect(fakes.transports[0]?.sent ?? []).toHaveLength(0);
      // A Redis connection error is logged by name only.
      const r = fakes.redis[0] as unknown as { instance: EventEmitter };
      r.instance.emit('error', new Error('connect ECONNREFUSED redis.example.test:6379'));
      expect(errors).toHaveBeenCalledWith('[auth] redis Error');
      expect(errors.mock.calls.flat().join('\n')).not.toMatch(/example\.test/);
      errors.mockRestore();
    },
    REDIS_READY_TIMEOUT_MS + AUTH_IMPORT_TIMEOUT_MS,
  );

  it('signIn and signOut delegate to Auth.js', async () => {
    setAuthEnv();
    const auth = await load();
    const out = await auth.signOut({ redirect: false });
    expect(out).toMatchObject({ redirect: expect.any(String) });
    const url = await auth.signIn('google', { redirect: false });
    expect(typeof url).toBe('string');
  });
});

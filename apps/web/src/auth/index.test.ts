// Tasks 1.3, 1.4: the wired-up auth module reads nothing at import (so /api/health and `next build`
// work without AUTH_*), reads env lazily on the first auth call, and fails closed when it can't.
// ioredis and nodemailer are faked: no socket is opened.
import type { EventEmitter } from 'node:events';
import type { AgePolicy } from '@edmate/db';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity } from '../../test/memory-identity';
import { REDIS_READY_TIMEOUT_MS } from './redis-ready';

const fakes = vi.hoisted(() => ({
  db: [] as Array<{ options: unknown; identity: MemoryIdentity; repos: object }>,
  redis: [] as Array<{ url: string; options: Record<string, unknown>; take: unknown[][] }>,
  transports: [] as Array<{ options: Record<string, unknown>; sent: Record<string, unknown>[] }>,
  // Task 1.4d fix round: how many times the next `new Redis(...)` call should throw before
  // succeeding, to exercise emailSignIn's one-time-build retry.
  redisFailuresLeft: 0,
}));

vi.mock('ioredis', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Redis extends Emitter {
    status = 'connecting';
    readonly record: { url: string; options: Record<string, unknown>; take: unknown[][] };
    constructor(url: string, options: Record<string, unknown>) {
      if (fakes.redisFailuresLeft > 0) {
        fakes.redisFailuresLeft -= 1;
        throw new Error('redis construction failed (test)');
      }
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
    openDatabase: (
      _env: unknown,
      options: { identity?: { agePolicy?: (m: string) => AgePolicy } } = {},
    ) => {
      const identity = memoryIdentity(undefined, options.identity?.agePolicy);
      const repos = { fake: 'repos' };
      fakes.db.push({ options, identity, repos });
      return { identity, repos };
    },
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

const pageCookies = vi.fn(async () => ({
  get: (_name: string): { value: string } | undefined => undefined,
  set: vi.fn(),
}));
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
  // Every test's `load()` cold-imports this module's whole dependency graph (next-auth included)
  // via `vi.resetModules()`. Vitest's transform cache (unlike the module registry) survives
  // `resetModules`, so only the *first* import of the run pays for transpiling that graph; later
  // `load()` calls just re-execute already-transformed code. Warming that cache once here, with
  // its own generous timeout, keeps the transform cost out of the first real test's budget --
  // on a loaded shared CI runner that cost alone was enough to blow past a 20 s test timeout.
  beforeAll(async () => {
    await load();
  }, 60_000);

  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', undefined);
    fakes.redis.length = 0;
    fakes.transports.length = 0;
    fakes.redisFailuresLeft = 0;
    // The dev-mode Redis singleton (task 1.4d) is cached on `globalThis`, deliberately surviving
    // `vi.resetModules()`'s cold `load()` -- so each test starts with a clean slate here, and
    // only the dedicated singleton test below exercises the reuse across two `load()` calls.
    delete (globalThis as { __edmateAuthRedis?: unknown }).__edmateAuthRedis;
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
    await expect(auth.requireRole(['student'])).rejects.toThrow('REDIRECT /sign-in');
    expect(pageCookies).toHaveBeenCalled();
  });

  it('signIn refuses the email provider: links go only through the rate-limited route', async () => {
    setEmailOnlyEnv();
    const auth = await load();
    await expect(
      auth.signIn('email', { email: 'a@example.test', redirect: false }),
    ).rejects.toThrow('email sign-in goes through /api/auth/signin/email only');
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
    expect(fakes.transports[0]?.options).toMatchObject({
      requireTLS: false,
      socketTimeout: 10_000,
    });
  });

  it(
    'dev hot reload reuses one Redis client across module reloads (not a fresh client per reload)',
    async () => {
      setEmailOnlyEnv();
      const auth1 = await load();
      await auth1.handlers.GET(new NextRequest(`${ORIGIN}/api/auth/providers`));
      expect(fakes.redis).toHaveLength(1);
      // A second cold `load()` simulates a dev HMR reload of this module (resets every
      // module-scoped variable, including `runtime`); only `globalThis` survives that.
      const auth2 = await load();
      await auth2.handlers.GET(new NextRequest(`${ORIGIN}/api/auth/providers`));
      expect(fakes.redis).toHaveLength(1);
    },
    AUTH_IMPORT_TIMEOUT_MS,
  );

  it(
    'emailSignIn retries after a throw during the one-time build (not cached forever)',
    async () => {
      setEmailOnlyEnv();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const auth = await load();
      fakes.redisFailuresLeft = 1;
      // First request: the memoized builder's `new Redis(...)` throws. The per-request Auth.js
      // config factory awaits emailSignIn and rejects; the route handler must not crash the
      // process, and no Redis client or mail is recorded for this attempt.
      await expect(requestLink(auth)).rejects.toThrow();
      expect(fakes.redis).toHaveLength(0);
      // Second request: with the rejection no longer cached, the builder retries and succeeds.
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
      expect(fakes.redis).toHaveLength(1);
      errors.mockRestore();
    },
    REDIS_READY_TIMEOUT_MS + AUTH_IMPORT_TIMEOUT_MS,
  );

  it(
    'dev: a hot-reloaded module reuses the singleton client without adding another error listener',
    async () => {
      setEmailOnlyEnv();
      const auth1 = await load();
      await auth1.handlers.GET(new NextRequest(`${ORIGIN}/api/auth/providers`));
      expect(fakes.redis).toHaveLength(1);
      const instance = (fakes.redis[0] as unknown as { instance: EventEmitter }).instance;
      expect(instance.listenerCount('error')).toBe(1);
      // Three more simulated HMR reloads, each triggering a fresh request on the same singleton.
      for (let i = 0; i < 3; i += 1) {
        const auth = await load();
        await auth.handlers.GET(new NextRequest(`${ORIGIN}/api/auth/providers`));
      }
      expect(fakes.redis).toHaveLength(1);
      expect(instance.listenerCount('error')).toBe(1);
    },
    AUTH_IMPORT_TIMEOUT_MS,
  );

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
      expect(String(fakes.transports[0]?.sent[0]?.text)).toContain(
        `${ORIGIN}/sign-in/confirm?`,
      );
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

  it('the age gate: rules and notice versions from content/, cookies through next/headers', async () => {
    setAuthEnv();
    fakes.db.length = 0;
    const auth = await load();
    expect(await auth.ageGateView()).toEqual({ state: 'sign_in' });
    const { options, identity } = fakes.db[0]!;
    const wired = (
      options as {
        identity: { agePolicy(m: string): unknown; noticeVersion(m: string): string };
      }
    ).identity;
    expect(wired.agePolicy('IN')).toEqual({ minAge: 13, consentRequired: true });
    expect(wired.noticeVersion('IN')).toBe('draft-0');
    expect(auth.ageNotice('US')).toMatchObject({ market: 'US', version: 'draft-0' });

    // A signed-in student: the guard asks for the standing; the action records the answer.
    const u = await identity.createStudent({
      email: 'w@example.test',
      emailVerifiedAt: null,
      name: 'W',
    });
    const sid = 'sid'.padEnd(32, '1');
    await identity.createSession(sid, u.id, new Date(Date.now() + 60_000));
    const set = vi.fn();
    const jar = {
      get: (name: string) => (name === 'authjs.session-token' ? { value: sid } : undefined),
      set,
    };
    pageCookies.mockImplementation(async () => jar);
    const route = auth.withRole(['student'], () => new Response('ok'));
    const me = () =>
      route(
        new NextRequest(`${ORIGIN}/api/me/progress`, {
          headers: { cookie: `authjs.session-token=${sid}` },
        }),
      );
    expect((await me()).status).toBe(403);
    expect(await auth.ageGateView()).toMatchObject({ state: 'ask' });
    expect(await auth.submitAgeAnswer({ market: 'IN', birthYear: '2015' })).toEqual({
      status: 'closed',
    });
    expect(set).toHaveBeenCalledWith(
      'edmate.age-block',
      '1',
      expect.objectContaining({ httpOnly: true }),
    );
    expect((await me()).status).toBe(401);
    pageCookies.mockImplementation(async () => ({
      get: (_name: string) => undefined,
      set: vi.fn(),
    }));
  });

  it('the age gate fails loudly when content/ is missing', async () => {
    setAuthEnv();
    vi.stubEnv('EDMATE_CONTENT_DIR', '/nonexistent/edmate-content');
    const auth = await load();
    expect(() => auth.ageNotice('IN')).toThrow();
  });

  it('currentPrincipal: signed out reads as null', async () => {
    setAuthEnv();
    const auth = await load();
    expect(await auth.currentPrincipal()).toBeNull();
  });

  it('currentPrincipal: signed in reads the principal', async () => {
    setAuthEnv();
    fakes.db.length = 0;
    const auth = await load();
    expect(await auth.currentPrincipal()).toBeNull();
    const { identity } = fakes.db[0]!;
    const u = await identity.createStudent({
      email: 'cp@example.test',
      emailVerifiedAt: null,
      name: 'CP',
    });
    const sid = 'cpd'.padEnd(32, '1');
    await identity.createSession(sid, u.id, new Date(Date.now() + 60_000));
    pageCookies.mockImplementation(async () => ({
      get: (name: string) => (name === 'authjs.session-token' ? { value: sid } : undefined),
      set: vi.fn(),
    }));
    expect(await auth.currentPrincipal()).toEqual({ userId: u.id, role: 'student' });
    pageCookies.mockImplementation(async () => ({
      get: (_name: string) => undefined,
      set: vi.fn(),
    }));
  });

  it('currentPrincipal: a lookup failure reads as null, not thrown, and logs exactly once', async () => {
    setAuthEnv();
    fakes.db.length = 0;
    const auth = await load();
    expect(await auth.currentPrincipal()).toBeNull();
    const { identity } = fakes.db[0]!;
    identity.getSessionAndUser = vi.fn(async () => {
      throw new Error('db unreachable for cp@example.test');
    });
    pageCookies.mockImplementation(async () => ({
      get: (name: string) => (name === 'authjs.session-token' ? { value: 'x'.repeat(32) } : undefined),
      set: vi.fn(),
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(auth.currentPrincipal()).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith('[auth] currentPrincipal Error');
    errorSpy.mockRestore();
    pageCookies.mockImplementation(async () => ({
      get: (_name: string) => undefined,
      set: vi.fn(),
    }));
  });

  it('serverDatabase shares the guard\'s identity (market age policy) and opens one database', async () => {
    setAuthEnv();
    fakes.db.length = 0;
    const auth = await load();
    const db = auth.serverDatabase();
    expect(fakes.db).toHaveLength(1);
    expect(db.identity).toBe(fakes.db[0]!.identity);
    expect(db.repos).toBe(fakes.db[0]!.repos);
    // The guard reads the same instance: a student it creates is the one the guard resolves.
    const u = await db.identity.createStudent({
      email: 'sd@example.test',
      emailVerifiedAt: null,
      name: 'SD',
    });
    const sid = 'sdb'.padEnd(32, '1');
    await db.identity.createSession(sid, u.id, new Date(Date.now() + 60_000));
    pageCookies.mockImplementation(async () => ({
      get: (name: string) => (name === 'authjs.session-token' ? { value: sid } : undefined),
      set: vi.fn(),
    }));
    expect(await auth.currentPrincipal()).toEqual({ userId: u.id, role: 'student' });
    expect(auth.serverDatabase().identity).toBe(db.identity);
    expect(fakes.db).toHaveLength(1);
    pageCookies.mockImplementation(async () => ({
      get: (_name: string) => undefined,
      set: vi.fn(),
    }));
  });

  describe('the magic-link confirm page (task 1.4b)', () => {
    const TOKEN = 'cd'.repeat(32);
    const EMAIL = 'confirm@example.test';
    const PARAMS = { token: TOKEN, email: EMAIL, callbackUrl: `${ORIGIN}/` };
    const CALLBACK = `${ORIGIN}/api/auth/callback/email?token=${TOKEN}&email=confirm%40example.test&callbackUrl=http%3A%2F%2Flocalhost%3A8080%2F`;

    function withCookie(name: string, value: string) {
      pageCookies.mockImplementation(async () => ({
        get: (n: string) => (n === name ? { value } : undefined),
        set: vi.fn(),
      }));
    }
    function noCookies() {
      pageCookies.mockImplementation(async () => ({ get: (_n: string) => undefined, set: vi.fn() }));
    }

    it('linkBindingCookie: an HMAC of the address under AUTH_SECRET, not secure on http', async () => {
      setAuthEnv();
      const auth = await load();
      const cookie = auth.linkBindingCookie('Confirm@Example.TEST');
      expect(cookie).toMatchObject({
        name: 'edmate.link-bound',
        value: expect.stringMatching(/^\d+\.[0-9a-f]{64}$/),
        options: { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 900 },
      });
      expect(auth.linkBindingCookie(EMAIL)?.value.split('.')[1]).toBe(cookie?.value.split('.')[1]);
      expect(auth.linkBindingCookie('not-an-address')).toBeNull();
    });

    it('confirmSignInView: invalid params → invalid', async () => {
      setAuthEnv();
      const auth = await load();
      expect(await auth.confirmSignInView({ email: EMAIL })).toEqual({ kind: 'invalid' });
    });

    it('confirmSignInView: this browser\'s cookie for this address → auto, to the real callback', async () => {
      setAuthEnv();
      const auth = await load();
      withCookie('edmate.link-bound', auth.linkBindingCookie(EMAIL)!.value);
      try {
        expect(await auth.confirmSignInView(PARAMS)).toEqual({ kind: 'auto', url: CALLBACK });
      } finally {
        noCookies();
      }
    });

    it.each([
      ['no cookie', null],
      ['a forged cookie', `${Math.floor(Date.now() / 1000)}.${'f'.repeat(64)}`],
      ['a cookie for another address', 'other@example.test'],
    ])('confirmSignInView: %s → manual', async (_label, cookie) => {
      setAuthEnv();
      const auth = await load();
      if (cookie === 'other@example.test') withCookie('edmate.link-bound', auth.linkBindingCookie(cookie)!.value);
      else if (cookie) withCookie('edmate.link-bound', cookie);
      try {
        expect(await auth.confirmSignInView(PARAMS)).toEqual({ kind: 'manual', ...PARAMS });
      } finally {
        noCookies();
      }
    });

    it('confirmEmailSignIn: valid fields → the confirmed cookie and the real callback URL; invalid → null, no cookie', async () => {
      setAuthEnv();
      const auth = await load();
      const set = vi.fn();
      pageCookies.mockImplementation(async () => ({ get: (_n: string) => undefined, set }));
      try {
        expect(await auth.confirmEmailSignIn(PARAMS)).toBe(CALLBACK);
        expect(set).toHaveBeenCalledExactlyOnceWith(
          'edmate.link-confirmed',
          expect.stringMatching(/^\d+\.[0-9a-f]{64}$/),
          { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 120 },
        );
        const confirmed = set.mock.calls[0]![1] as string;
        // That cookie lets this token's callback through; nothing else does.
        const callback = (cookie?: string) =>
          new NextRequest(CALLBACK, cookie ? { headers: { cookie } } : {});
        expect(auth.emailCallbackRedirect(callback(`edmate.link-confirmed=${confirmed}`))).toBeNull();
        expect(auth.emailCallbackRedirect(callback())).toBe(CALLBACK.replace('/api/auth/callback/email', '/sign-in/confirm'));
        const bound = auth.linkBindingCookie(EMAIL)!.value;
        expect(auth.emailCallbackRedirect(callback(`edmate.link-bound=${bound}`))).toBeNull();
        set.mockClear();
        expect(await auth.confirmEmailSignIn({ ...PARAMS, token: 'nope' })).toBeNull();
        expect(await auth.confirmEmailSignIn(null)).toBeNull();
        expect(set).not.toHaveBeenCalled();
      } finally {
        noCookies();
      }
    });

    it('signInBindsLink: only a same-origin POST answered with verify-request', async () => {
      setAuthEnv();
      const auth = await load();
      const post = (origin: string) =>
        new Request(`${ORIGIN}/api/auth/signin/email`, { method: 'POST', headers: { origin } });
      const verify = new Response(null, { status: 302, headers: { location: `${ORIGIN}/api/auth/verify-request` } });
      expect(auth.signInBindsLink(post(ORIGIN), verify)).toBe(true);
      expect(auth.signInBindsLink(post('https://evil.test'), verify)).toBe(false);
      const csrf = new Response(null, { status: 302, headers: { location: `${ORIGIN}/api/auth/signin?error=MissingCSRF` } });
      expect(auth.signInBindsLink(post(ORIGIN), csrf)).toBe(false);
    });
  });

  it('signIn and signOut delegate to Auth.js', async () => {
    setAuthEnv();
    const auth = await load();
    const out = await auth.signOut({ redirect: false });
    expect(out).toMatchObject({ redirect: expect.any(String) });
    const url = await auth.signIn('google', { redirect: false });
    expect(typeof url).toBe('string');
  });
});

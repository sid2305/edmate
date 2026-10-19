// Task 1.3: the wired-up auth module reads nothing at import (so /api/health and `next build` work
// without AUTH_*), reads env lazily on the first auth call, and fails closed when it can't.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('src/auth wiring', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', undefined);
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

  it('signIn and signOut delegate to Auth.js', async () => {
    setAuthEnv();
    const auth = await load();
    const out = await auth.signOut({ redirect: false });
    expect(out).toMatchObject({ redirect: expect.any(String) });
    const url = await auth.signIn('google', { redirect: false });
    expect(typeof url).toBe('string');
  });
});

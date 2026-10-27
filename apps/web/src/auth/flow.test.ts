// Task 1.3: Google sign-in end to end through Auth.js's real handlers. Google's discovery, token
// and key endpoints are served by an injected fetch with a test keypair; the global fetch rejects
// (test/setup.ts), so nothing reaches the network.
import NextAuth from 'next-auth';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_ID, fakeGoogle, ISSUER, Jar, type GoogleUser } from '../../test/fake-google';
import { memoryIdentity, type MemoryIdentity } from '../../test/memory-identity';
import { createAuthConfig, principalFromIdentity, sessionCookieName } from './config';
import { readAuthEnv } from './env';
import { createGuard } from './guard';

const ORIGIN = 'http://localhost:8080';
const SESSION_COOKIE = sessionCookieName(false);

const env = readAuthEnv({
  AUTH_SECRET: 'test-only-secret-'.padEnd(48, 'x'),
  AUTH_URL: ORIGIN,
  AUTH_TRUST_HOST: 'true',
  AUTH_GOOGLE_ID: CLIENT_ID,
  AUTH_GOOGLE_SECRET: 'test-only-google-client-secret',
});

function setup() {
  const identity = memoryIdentity();
  const google = { user: verifiedUser(), calls: [] as string[] } as {
    user: GoogleUser;
    nonce?: string;
    calls: string[];
  };
  const logs: string[] = [];
  // Per-request config, as src/auth/index.ts builds it: the signIn callback reads the request.
  const { handlers } = NextAuth((req) =>
    createAuthConfig({
      identity,
      env,
      providerFetch: fakeGoogle(google),
      log: (l) => logs.push(l),
      ...(req ? { request: req } : {}),
    }),
  );
  const jar = new Jar();
  async function call(method: 'GET' | 'POST', path: string, form?: Record<string, string>) {
    const headers: Record<string, string> = { cookie: jar.header() };
    if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
    const req = new NextRequest(`${ORIGIN}${path}`, {
      method,
      headers,
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    });
    const res = await (method === 'GET' ? handlers.GET(req) : handlers.POST(req));
    jar.take(res);
    return res;
  }
  async function csrf(): Promise<string> {
    const res = await call('GET', '/api/auth/csrf');
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  }
  /** The whole Google round trip; returns the callback response. */
  async function signIn(): Promise<{ authorize: URL; callback: Response }> {
    const start = await call('POST', '/api/auth/signin/google', {
      csrfToken: await csrf(),
      callbackUrl: `${ORIGIN}/`,
    });
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('location')!);
    const nonce = authorize.searchParams.get('nonce');
    if (nonce) google.nonce = nonce;
    const state = authorize.searchParams.get('state') ?? '';
    const callback = await call(
      'GET',
      `/api/auth/callback/google?code=good-code&state=${encodeURIComponent(state)}`,
    );
    return { authorize, callback };
  }
  async function session() {
    return (await call('GET', '/api/auth/session')).json() as Promise<{
      user?: Record<string, unknown>;
      expires?: string;
    } | null>;
  }
  return { identity, google, logs, jar, call, csrf, signIn, session };
}

function verifiedUser(over: Partial<GoogleUser> = {}): GoogleUser {
  return {
    sub: 'google-sub-123',
    email: 'Asha.Student@Example.TEST',
    email_verified: true,
    name: 'Asha Student',
    picture: 'https://lh3.example/photo.jpg',
    ...over,
  };
}

function principalOf(identity: MemoryIdentity, jar: Jar) {
  return principalFromIdentity(
    identity,
    SESSION_COOKIE,
  )({
    get: (name) => {
      const value = jar.values.get(name);
      return value === undefined ? undefined : { value };
    },
  });
}

describe('Google sign-in through Auth.js', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('the sign-in redirect goes to Google with state, nonce and PKCE (S256)', async () => {
    const start = await t.call('POST', '/api/auth/signin/google', {
      csrfToken: await t.csrf(),
      callbackUrl: `${ORIGIN}/`,
    });
    expect(start.status).toBe(302);
    const url = new URL(start.headers.get('location')!);
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/o/oauth2/v2/auth`);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/google`);
    expect(t.google.calls).toContain(`${ISSUER}/.well-known/openid-configuration`);
  });

  it('refuses a sign-in POST without the CSRF token', async () => {
    const res = await t.call('POST', '/api/auth/signin/google', { callbackUrl: `${ORIGIN}/` });
    expect(res.headers.get('location') ?? '').not.toContain(ISSUER);
    expect(res.headers.get('location')).toContain('error=MissingCSRF');
    expect(t.logs).toContain('[auth] error MissingCSRF');
  });

  it('first sign-in creates a student, sets an httpOnly Lax cookie, and keeps no photo or tokens', async () => {
    const { callback } = await t.signIn();
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe(`${ORIGIN}/`);
    const cookie = t.jar.raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);

    expect([...t.identity.users.values()]).toEqual([
      {
        id: 'usr_1',
        role: 'student',
        email: 'asha.student@example.test',
        emailVerifiedAt: null,
        name: 'Asha Student',
      },
    ]);
    expect(t.identity.created).toEqual([
      { email: 'asha.student@example.test', emailVerifiedAt: null, name: 'Asha Student' },
    ]);
    expect(t.identity.linked).toEqual([
      { userId: 'usr_1', type: 'oidc', provider: 'google', providerAccountId: 'google-sub-123' },
    ]);
    expect(JSON.stringify([t.identity.created, t.identity.linked])).not.toMatch(
      /photo|test-access-token|test-refresh-token|id_token/,
    );
    expect(t.identity.sessions.size).toBe(1);
  });

  it('the browser session payload is id and role only', async () => {
    await t.signIn();
    const s = await t.session();
    expect(s?.user).toEqual({ id: 'usr_1', role: 'student' });
    expect(Object.keys(s ?? {}).sort()).toEqual(['expires', 'user']);
    expect(JSON.stringify(s)).not.toMatch(/asha|example\.test|photo/i);
  });

  it('a second sign-in reuses the same user', async () => {
    await t.signIn();
    t.jar.values.clear();
    await t.signIn();
    expect(t.identity.users.size).toBe(1);
    expect(t.identity.sessions.size).toBe(2);
    expect((await principalOf(t.identity, t.jar))?.userId).toBe('usr_1');
  });

  it('a role grant applies on the next request without signing in again', async () => {
    await t.signIn();
    expect(await principalOf(t.identity, t.jar)).toEqual({ userId: 'usr_1', role: 'student' });
    await t.identity.grantRole({ userId: 'usr_1', role: 'teacher', by: 'operator' });
    expect(await principalOf(t.identity, t.jar)).toEqual({ userId: 'usr_1', role: 'teacher' });
    expect((await t.session())?.user).toEqual({ id: 'usr_1', role: 'teacher' });

    // And the route guard sees it: a teacher route opens, a student route closes.
    const guard = createGuard(
      () => ({
        getPrincipal: principalFromIdentity(t.identity, SESSION_COOKIE),
        learnerStatus: (userId) => t.identity.learnerStatus(userId),
        allowedOrigin: ORIGIN,
      }),
      () => {
        throw new Error('no pages here');
      },
    );
    const ok = () => new Response('ok');
    const studio = guard.withRole(['teacher'], ok);
    const me = guard.withRole(['student'], ok);
    const req = (path: string) =>
      new NextRequest(`${ORIGIN}${path}`, { headers: { cookie: t.jar.header() } });
    expect((await studio(req('/api/studio/documents'))).status).toBe(200);
    expect((await me(req('/api/me/progress'))).status).toBe(403);
  });

  it('refuses a Google account whose email is not verified, and creates nothing', async () => {
    t.google.user = verifiedUser({ email_verified: false, sub: 'google-sub-unverified' });
    const { callback } = await t.signIn();
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toContain('/api/auth/error?error=AccessDenied');
    expect(t.identity.users.size).toBe(0);
    expect(t.identity.sessions.size).toBe(0);
    expect(t.jar.values.has(SESSION_COOKIE)).toBe(false);
  });

  it('1.4c: links Google to an existing user who signed up by link, once both sides are verified', async () => {
    const existing = await t.identity.createStudent({
      email: 'asha.student@example.test',
      // The shape a link sign-up leaves behind: emailVerifiedAt set, no Google account yet.
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      name: 'Existing',
    });
    const { callback } = await t.signIn();
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe(`${ORIGIN}/`);
    expect(t.identity.users.size).toBe(1);
    expect((await principalOf(t.identity, t.jar))?.userId).toBe(existing.id);
    expect(t.identity.linked).toEqual([
      {
        userId: existing.id,
        type: 'oidc',
        provider: 'google',
        providerAccountId: 'google-sub-123',
      },
    ]);
    expect(t.identity.accounts.size).toBe(1);
  });

  it('1.4c: an existing user whose email is not verified refuses the Google sign-in; nothing links (fails signIn, before the first signIn redirect)', async () => {
    await t.identity.createStudent({
      email: 'asha.student@example.test',
      emailVerifiedAt: null,
      name: 'Existing',
    });
    const { callback } = await t.signIn();
    expect(callback.headers.get('location')).toContain('/api/auth/error?error=AccessDenied');
    expect(t.identity.accounts.size).toBe(0);
    expect(t.identity.sessions.size).toBe(0);
    expect(t.logs.join('\n')).not.toMatch(/asha|example\.test/i);
  });

  it("1.4c: Google's own email not verified still refuses before any lookup (unchanged)", async () => {
    await t.identity.createStudent({
      email: 'asha.student@example.test',
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      name: 'Existing',
    });
    t.google.user = verifiedUser({ email_verified: false, sub: 'google-sub-unverified' });
    const { callback } = await t.signIn();
    expect(callback.headers.get('location')).toContain('/api/auth/error?error=AccessDenied');
    expect(t.identity.accounts.size).toBe(0);
  });

  it('1.4c: a second Google account cannot claim an already-linked address', async () => {
    const existing = await t.identity.createStudent({
      email: 'asha.student@example.test',
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      name: 'Existing',
    });
    await t.identity.linkAccount({
      userId: existing.id,
      type: 'oidc',
      provider: 'google',
      providerAccountId: 'g-a',
    });
    // A different Google sub, same email: refused, no second account linked.
    t.google.user = verifiedUser({ sub: 'g-b' });
    const { callback } = await t.signIn();
    expect(callback.headers.get('location')).toContain('/api/auth/error?error=AccessDenied');
    expect(t.identity.accounts.size).toBe(1);
  });

  it('a bad authorization code fails the callback without a session', async () => {
    const start = await t.call('POST', '/api/auth/signin/google', {
      csrfToken: await t.csrf(),
      callbackUrl: `${ORIGIN}/`,
    });
    const url = new URL(start.headers.get('location')!);
    const nonce = url.searchParams.get('nonce');
    if (nonce) t.google.nonce = nonce;
    const res = await t.call(
      'GET',
      `/api/auth/callback/google?code=bad-code&state=${url.searchParams.get('state')}`,
    );
    expect(res.headers.get('location')).toContain('/api/auth/error');
    expect(t.identity.sessions.size).toBe(0);
    expect(t.logs.some((l) => l.startsWith('[auth] error '))).toBe(true);
  });

  it("shared device: a sibling's Google sign-in while A is signed in is refused and never opens A's account", async () => {
    await t.signIn();
    const aCookie = t.jar.values.get(SESSION_COOKIE);
    expect(await principalOf(t.identity, t.jar)).toEqual({ userId: 'usr_1', role: 'student' });

    // Sibling B uses the same browser (A's cookie still set) with their own Google account.
    t.google.user = verifiedUser({
      sub: 'google-sub-sibling',
      email: 'sibling@example.test',
      name: 'Sibling',
    });
    const { callback } = await t.signIn();
    expect(callback.headers.get('location')).toContain('/api/auth/error?error=AccessDenied');
    // Nothing was linked to A, no user was made for B, and A's session is untouched.
    expect(t.identity.linked).toEqual([
      { userId: 'usr_1', type: 'oidc', provider: 'google', providerAccountId: 'google-sub-123' },
    ]);
    expect(t.identity.users.size).toBe(1);
    expect(await t.identity.getUserByAccount('google', 'google-sub-sibling')).toBeNull();
    expect(t.jar.values.get(SESSION_COOKIE)).toBe(aCookie);
    expect(t.identity.sessions.size).toBe(1);

    // After A signs out, B can sign in and gets their own account.
    await t.call('POST', '/api/auth/signout', {
      csrfToken: await t.csrf(),
      callbackUrl: `${ORIGIN}/`,
    });
    await t.signIn();
    expect(await principalOf(t.identity, t.jar)).toEqual({ userId: 'usr_2', role: 'student' });
  });

  it('signing in again with the same Google account while signed in is allowed', async () => {
    await t.signIn();
    const { callback } = await t.signIn();
    expect(callback.headers.get('location')).toBe(`${ORIGIN}/`);
    expect(t.identity.users.size).toBe(1);
  });

  it('sign-out deletes the session', async () => {
    await t.signIn();
    expect(t.identity.sessions.size).toBe(1);
    const res = await t.call('POST', '/api/auth/signout', {
      csrfToken: await t.csrf(),
      callbackUrl: `${ORIGIN}/`,
    });
    expect(res.status).toBe(302);
    expect(t.identity.sessions.size).toBe(0);
    expect(await principalOf(t.identity, t.jar)).toBeNull();
  });

  it('never used the global fetch', async () => {
    await t.signIn();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// Task 1.3: Google sign-in end to end through Auth.js's real handlers. Google's discovery, token
// and key endpoints are served by an injected fetch with a test keypair; the global fetch rejects
// (test/setup.ts), so nothing reaches the network.
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import NextAuth from 'next-auth';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { memoryIdentity, type MemoryIdentity } from '../../test/memory-identity';
import { createAuthConfig, principalFromIdentity, sessionCookieName } from './config';
import { readAuthEnv } from './env';
import { createGuard } from './guard';

const ORIGIN = 'http://localhost:8080';
const CLIENT_ID = 'test-client-id.apps.example';
const ISSUER = 'https://accounts.google.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const SESSION_COOKIE = sessionCookieName(false);

const env = readAuthEnv({
  AUTH_SECRET: 'test-only-secret-'.padEnd(48, 'x'),
  AUTH_URL: ORIGIN,
  AUTH_TRUST_HOST: 'true',
  AUTH_GOOGLE_ID: CLIENT_ID,
  AUTH_GOOGLE_SECRET: 'test-only-google-client-secret',
});

let privateKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
});

interface GoogleUser {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

/** A fake Google: discovery, JWKS and a token endpoint that issues an id_token for `user`. */
function fakeGoogle(state: { user: GoogleUser; nonce?: string; calls: string[] }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    state.calls.push(`${url.origin}${url.pathname}`);
    if (url.href === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/o/oauth2/v2/auth`,
        token_endpoint: TOKEN_URL,
        userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
        jwks_uri: JWKS_URL,
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.href === JWKS_URL) return Response.json({ keys: [jwk] });
    if (url.href === TOKEN_URL) {
      const body = new URLSearchParams(String(init?.body ?? ''));
      if (body.get('code') !== 'good-code' || !body.get('code_verifier')) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      const idToken = await new SignJWT({
        ...state.user,
        ...(state.nonce ? { nonce: state.nonce } : {}),
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setSubject(state.user.sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return Response.json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email profile',
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

/** A tiny cookie jar over Set-Cookie headers. */
class Jar {
  readonly values = new Map<string, string>();
  readonly raw: string[] = [];
  take(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      this.raw.push(c);
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.values.delete(name);
      else this.values.set(name, value);
    }
  }
  header(): string {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function setup() {
  const identity = memoryIdentity();
  const google = { user: verifiedUser(), calls: [] as string[] } as {
    user: GoogleUser;
    nonce?: string;
    calls: string[];
  };
  const logs: string[] = [];
  const { handlers } = NextAuth(
    createAuthConfig({
      identity,
      env,
      providerFetch: fakeGoogle(google),
      log: (l) => logs.push(l),
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

  it('does not link a new Google account to an existing email (no dangerous linking)', async () => {
    await t.identity.createStudent({
      email: 'asha.student@example.test',
      emailVerifiedAt: null,
      name: 'Existing',
    });
    const { callback } = await t.signIn();
    expect(callback.headers.get('location')).toContain('error=OAuthAccountNotLinked');
    expect(t.identity.accounts.size).toBe(0);
    expect(t.identity.sessions.size).toBe(0);
    // The logger printed the error name only, never the email.
    expect(t.logs.join('\n')).not.toMatch(/asha|example\.test/i);
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

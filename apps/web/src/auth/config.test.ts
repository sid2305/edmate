import { randomUUID } from 'node:crypto';
import type { IdentityStore } from '@edmate/db';
import type { Account, Profile, Session, User } from 'next-auth';
import type { AdapterUser } from 'next-auth/adapters';
import { describe, expect, it } from 'vitest';
import { memoryIdentity } from '../../test/memory-identity';
import {
  createAuthConfig,
  principalFromIdentity,
  sessionCookieName,
  SESSION_MAX_AGE_S,
  SESSION_UPDATE_AGE_S,
} from './config';
import { readAuthEnv } from './env';

function envFor(url: string, trust?: string) {
  return readAuthEnv({
    AUTH_SECRET: 'test-only-'.padEnd(40, 'x'),
    AUTH_URL: url,
    AUTH_GOOGLE_ID: 'test-client.apps.example',
    AUTH_GOOGLE_SECRET: 'test-google-client-value',
    ...(trust ? { AUTH_TRUST_HOST: trust } : {}),
  });
}

const identity = memoryIdentity() as IdentityStore;

describe('createAuthConfig', () => {
  it('uses database sessions with 30-day expiry refreshed daily, and no debug output', () => {
    const c = createAuthConfig({ identity, env: envFor('http://localhost:8080') });
    expect(c.session).toEqual({
      strategy: 'database',
      maxAge: SESSION_MAX_AGE_S,
      updateAge: SESSION_UPDATE_AGE_S,
    });
    expect(SESSION_MAX_AGE_S).toBe(2_592_000);
    expect(SESSION_UPDATE_AGE_S).toBe(86_400);
    expect(c.debug).toBe(false);
    expect(c.basePath).toBe('/api/auth');
    expect(c.adapter).toBeDefined();
    expect(c.trustHost).toBe(false);
    expect(createAuthConfig({ identity, env: envFor('http://x.example', 'true') }).trustHost).toBe(
      true,
    );
  });

  it('over http: httpOnly, SameSite=Lax, path /, not Secure, no prefix', () => {
    const c = createAuthConfig({ identity, env: envFor('http://localhost:8080') });
    expect(c.useSecureCookies).toBe(false);
    expect(c.cookies?.sessionToken).toEqual({
      name: 'authjs.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: false },
    });
  });

  it('over https: Secure with the __Secure- prefix (follows AUTH_URL, not NODE_ENV)', () => {
    const c = createAuthConfig({ identity, env: envFor('https://edmate.example') });
    expect(c.useSecureCookies).toBe(true);
    expect(c.cookies?.sessionToken).toEqual({
      name: '__Secure-authjs.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: true },
    });
    expect(sessionCookieName(true)).toBe('__Secure-authjs.session-token');
  });

  it('configures Google only, with no dangerous email linking and state + nonce + PKCE', () => {
    const c = createAuthConfig({ identity, env: envFor('http://localhost:8080') });
    expect(c.providers).toHaveLength(1);
    const google = c.providers[0] as unknown as {
      id: string;
      options: Record<string, unknown> & { profile: (p: unknown) => unknown };
    };
    expect(google.id).toBe('google');
    expect(google.options).toMatchObject({
      clientId: 'test-client.apps.example',
      allowDangerousEmailAccountLinking: false,
      checks: ['pkce', 'state', 'nonce'],
    });
    // The profile keeps no photo and nothing else Google sends.
    expect(
      google.options.profile({
        sub: 's1',
        email: 'a@example.test',
        name: 'A',
        picture: 'https://photo.example/a.jpg',
        email_verified: true,
        locale: 'en',
      }),
    ).toEqual({ id: 's1', email: 'a@example.test', name: 'A' });
    expect(google.options.profile({ sub: 's2', email: 'b@example.test' })).toEqual({
      id: 's2',
      email: 'b@example.test',
      name: '',
    });
  });

  describe('signIn callback', () => {
    const c = createAuthConfig({ identity, env: envFor('http://localhost:8080') });
    const signIn = (account: Partial<Account> | null, profile?: Partial<Profile>) =>
      c.callbacks!.signIn!({
        user: {} as User,
        account: account as Account | null,
        ...(profile ? { profile: profile as Profile } : {}),
      });

    it('accepts a Google profile with a verified email', async () => {
      expect(
        await signIn({ provider: 'google' }, { email: 'a@example.test', email_verified: true }),
      ).toBe(true);
    });

    it.each([
      ['unverified', { provider: 'google' }, { email: 'a@example.test', email_verified: false }],
      [
        'verified as a string',
        { provider: 'google' },
        { email: 'a@example.test', email_verified: 'true' as never },
      ],
      ['no email', { provider: 'google' }, { email_verified: true }],
      ['empty email', { provider: 'google' }, { email: '', email_verified: true }],
      ['no profile', { provider: 'google' }, undefined],
      [
        'another provider',
        { provider: 'github' },
        { email: 'a@example.test', email_verified: true },
      ],
      ['no account', null, { email: 'a@example.test', email_verified: true }],
    ])('refuses %s', async (_label, account, profile) => {
      expect(await signIn(account, profile)).toBe(false);
    });
  });

  it('the session payload is { user: { id, role }, expires } only', async () => {
    const c = createAuthConfig({ identity, env: envFor('http://localhost:8080') });
    const user = {
      id: 'usr_1',
      email: 'a@example.test',
      emailVerified: null,
      name: 'Asha',
      image: 'https://photo.example/a.jpg',
      role: 'teacher',
    } as AdapterUser;
    const out = await c.callbacks!.session!({
      session: {
        user: { name: 'Asha', email: 'a@example.test', image: 'x' },
        expires: '2026-11-17T00:00:00.000Z',
      } as unknown as Session & { user: AdapterUser; sessionToken: string; userId: string },
      user,
    } as never);
    expect(out).toEqual({
      user: { id: 'usr_1', role: 'teacher' },
      expires: '2026-11-17T00:00:00.000Z',
    });
  });

  it('the logger prints the error name and type only, never its message or input', () => {
    const lines: string[] = [];
    const c = createAuthConfig({
      identity,
      env: envFor('http://localhost:8080'),
      log: (l) => lines.push(l),
    });
    const err = Object.assign(new Error('failed for asha@example.test token abc123'), {
      name: 'CallbackRouteError',
      type: 'CallbackRouteError',
      cause: { email: 'asha@example.test' },
    });
    c.logger!.error!(err);
    c.logger!.error!(
      Object.assign(new Error('x asha@example.test'), { type: 'AdapterError' }) as never,
    );
    c.logger!.error!('raw string asha@example.test' as never);
    c.logger!.warn!('debug-enabled');
    c.logger!.debug!('details', { email: 'asha@example.test' });
    expect(lines).toEqual([
      '[auth] error CallbackRouteError',
      '[auth] error Error (AdapterError)',
      '[auth] error non-error',
      '[auth] warn debug-enabled',
    ]);
  });

  it('logs to console.error by default', () => {
    const c = createAuthConfig({ identity, env: envFor('http://localhost:8080') });
    const original = console.error;
    const seen: unknown[] = [];
    console.error = (...a: unknown[]) => seen.push(a.join(' '));
    try {
      c.logger!.warn!('experimental-webauthn');
    } finally {
      console.error = original;
    }
    expect(seen).toEqual(['[auth] warn experimental-webauthn']);
  });
});

describe('principalFromIdentity', () => {
  const cookie = (value?: string) => ({
    get: (name: string) =>
      name === 'authjs.session-token' && value !== undefined ? { value } : undefined,
  });

  it('reads id and role for a live session; nothing else', async () => {
    const id = memoryIdentity();
    const u = await id.createStudent({ email: 'p@example.test', emailVerifiedAt: null, name: 'P' });
    const token = randomUUID();
    await id.createSession(token, u.id, new Date(Date.now() + 60_000));
    const get = principalFromIdentity(id, 'authjs.session-token');
    expect(await get(cookie(token))).toEqual({ userId: u.id, role: 'student' });
  });

  it('is null with no cookie, a malformed cookie (no lookup), or an unknown token', async () => {
    const id = memoryIdentity();
    let lookups = 0;
    const counting = {
      ...id,
      getSessionAndUser: async (t: string) => ((lookups += 1), id.getSessionAndUser(t)),
    };
    const get = principalFromIdentity(counting, 'authjs.session-token');
    expect(await get(cookie())).toBeNull();
    expect(await get(cookie(''))).toBeNull();
    expect(await get(cookie('short'))).toBeNull();
    expect(await get(cookie('has spaces and ; semicolons in it'))).toBeNull();
    expect(lookups).toBe(0);
    expect(await get(cookie('0b5f9a3c-1111-4222-8333-000000000000'))).toBeNull();
    expect(lookups).toBe(1);
  });

  it('propagates a store failure (the guard turns it into 500, never anonymous)', async () => {
    const id = memoryIdentity();
    const broken = {
      ...id,
      getSessionAndUser: async () => {
        throw new Error('down');
      },
    };
    await expect(
      principalFromIdentity(
        broken,
        'authjs.session-token',
      )(cookie('0b5f9a3c-1111-4222-8333-000000000000')),
    ).rejects.toThrow('down');
  });
});

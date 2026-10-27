import { randomUUID } from 'node:crypto';
import { RepositoryError, type IdentityStore } from '@edmate/db';
import type { Account, Profile, Session, User } from 'next-auth';
import type { AdapterUser } from 'next-auth/adapters';
import { describe, expect, it, vi } from 'vitest';
import { memoryIdentity } from '../../test/memory-identity';
import { memoryMail } from '../../test/memory-mail';
import {
  createAuthConfig,
  RATE_LIMITED_PATH,
  safeRedirect,
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
const NO_HEADERS = new Headers();
const SMTP = ['smtp://', 'sandbox.example.test:1025'].join('');

function emailEnv(withGoogle: boolean) {
  return readAuthEnv({
    AUTH_SECRET: 'test-only-'.padEnd(40, 'x'),
    AUTH_URL: 'http://localhost:8080',
    EMAIL_SERVER: SMTP,
    EMAIL_FROM: 'Edmate <sign-in@example.test>',
    REDIS_URL: 'redis://127.0.0.1:6379',
    ...(withGoogle
      ? {
          AUTH_GOOGLE_ID: 'test-client.apps.example',
          AUTH_GOOGLE_SECRET: 'test-google-client-value',
        }
      : {}),
  });
}

describe('safeRedirect', () => {
  const app = new URL('http://localhost:8080');
  it.each([
    ['/teachers', 'http://localhost:8080/teachers'],
    ['/teachers?x=1#y', 'http://localhost:8080/teachers?x=1#y'],
    ['http://localhost:8080/me', 'http://localhost:8080/me'],
    [RATE_LIMITED_PATH, `http://localhost:8080${RATE_LIMITED_PATH}`],
  ])('keeps %s', (url, out) => {
    expect(safeRedirect(url, app)).toBe(out);
  });

  it.each([
    'https://evil.test',
    'https://evil.test/api/auth/callback/email',
    '//evil.test',
    '/\\evil.test',
    '/\t/evil.test',
    'javascript:alert(1)',
    'http://localhost:8080.evil.test',
    'http://localhost:9090/me',
    'https://localhost:8080/me',
    'http://[::1',
  ])('maps %s to the AUTH_URL origin', (url) => {
    expect(safeRedirect(url, app)).toBe('http://localhost:8080');
  });

  it('the redirect callback compares with AUTH_URL, not the (forwardable) baseUrl', async () => {
    const c = createAuthConfig({ identity, env: envFor('http://localhost:8080', 'true') });
    const redirect = (url: string, baseUrl: string) => c.callbacks!.redirect!({ url, baseUrl });
    expect(await redirect('https://evil.test/x', 'https://evil.test')).toBe(
      'http://localhost:8080',
    );
    expect(await redirect('/teachers', 'https://evil.test')).toBe('http://localhost:8080/teachers');
  });
});

describe('providers by env', () => {
  const emailSignIn = { mail: memoryMail(), limiter: { allow: vi.fn(async () => true) } };
  const ids = (c: ReturnType<typeof createAuthConfig>) =>
    (c.providers as unknown as { id: string }[]).map((p) => p.id);

  it('email only: just the email provider, 15-minute links', () => {
    const c = createAuthConfig({ identity, env: emailEnv(false), emailSignIn });
    expect(ids(c)).toEqual(['email']);
    expect((c.providers[0] as unknown as { maxAge: number }).maxAge).toBe(900);
  });

  it('both: Google then email', () => {
    expect(ids(createAuthConfig({ identity, env: emailEnv(true), emailSignIn }))).toEqual([
      'google',
      'email',
    ]);
  });

  it('email env without a mail sender and limiter is refused (no unlimited links)', () => {
    expect(() => createAuthConfig({ identity, env: emailEnv(false) })).toThrow(
      'email sign-in needs a mail sender and a limiter',
    );
  });
});

describe('signIn callback: email', () => {
  const account = (over: Partial<Account> = {}) =>
    ({
      provider: 'email',
      type: 'email',
      providerAccountId: 'link@example.test',
      ...over,
    }) as Account;
  const xff = new Headers({ 'x-forwarded-for': '203.0.113.7' });

  function make(allowed: boolean | Error, request: boolean = true) {
    const allow = vi.fn(async () => {
      if (allowed instanceof Error) throw allowed;
      return allowed;
    });
    const c = createAuthConfig({
      identity,
      env: emailEnv(false),
      emailSignIn: { mail: memoryMail(), limiter: { allow } },
      ...(request ? { request: { cookies: { get: () => undefined }, headers: xff } } : {}),
    });
    const signIn = (verificationRequest: boolean | undefined, acc: Account = account()) =>
      c.callbacks!.signIn!({
        user: { id: 'stand-in', email: 'link@example.test' } as User,
        account: acc,
        ...(verificationRequest === undefined ? {} : { email: { verificationRequest } }),
      });
    return { allow, signIn };
  }

  it('a link request under the limit is allowed; the limiter sees the address and the headers', async () => {
    const { allow, signIn } = make(true);
    expect(await signIn(true)).toBe(true);
    expect(allow).toHaveBeenCalledWith({ email: 'link@example.test', headers: xff });
  });

  it('over the limit: the RateLimited error page, never a branch on the user', async () => {
    const { signIn } = make(false);
    expect(await signIn(true)).toBe(RATE_LIMITED_PATH);
  });

  it('a limiter error propagates (Auth.js fails the request closed)', async () => {
    const { signIn } = make(new Error('redis down'));
    await expect(signIn(true)).rejects.toThrow('redis down');
  });

  it('no request (a server action) is refused without touching the limiter', async () => {
    const { allow, signIn } = make(true, false);
    expect(await signIn(true)).toBe(false);
    expect(allow).not.toHaveBeenCalled();
  });

  it('a request but no email wiring is refused', async () => {
    const c = createAuthConfig({
      identity,
      env: envFor('http://localhost:8080'),
      request: { cookies: { get: () => undefined }, headers: NO_HEADERS },
    });
    expect(
      await c.callbacks!.signIn!({
        user: {} as User,
        account: account(),
        email: { verificationRequest: true },
      }),
    ).toBe(false);
  });

  it('the link callback (token already used up by Auth.js) is allowed without a limiter take', async () => {
    const { allow, signIn } = make(false);
    expect(await signIn(undefined)).toBe(true);
    expect(await signIn(false)).toBe(true);
    expect(allow).not.toHaveBeenCalled();
  });

  it('a provider called email that is not of type email falls to the Google rules (refused)', async () => {
    const { signIn } = make(true);
    expect(await signIn(true, account({ type: 'oauth' }))).toBe(false);
  });
});

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

  it('over https: Secure with the __Host- prefix, path / and no Domain (follows AUTH_URL, not NODE_ENV)', () => {
    const c = createAuthConfig({ identity, env: envFor('https://edmate.example') });
    expect(c.useSecureCookies).toBe(true);
    expect(c.cookies?.sessionToken).toEqual({
      name: '__Host-authjs.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: true },
    });
    expect(sessionCookieName(true)).toBe('__Host-authjs.session-token');
    expect(c.cookies?.sessionToken?.options).not.toHaveProperty('domain');
  });

  it('configures Google only, with dangerous email linking gated by signIn and state + nonce + PKCE', () => {
    const c = createAuthConfig({ identity, env: envFor('http://localhost:8080') });
    expect(c.providers).toHaveLength(1);
    const google = c.providers[0] as unknown as {
      id: string;
      options: Record<string, unknown> & { profile: (p: unknown) => unknown };
    };
    expect(google.id).toBe('google');
    expect(google.options).toMatchObject({
      clientId: 'test-client.apps.example',
      allowDangerousEmailAccountLinking: true,
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
    const noCookies = { cookies: { get: () => undefined }, headers: NO_HEADERS };
    const c = createAuthConfig({
      identity,
      env: envFor('http://localhost:8080'),
      request: noCookies,
    });
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

    it('refuses every sign-in from a browser the age gate closed (1.7), before any lookup', async () => {
      for (const secure of [false, true]) {
        const url = secure ? 'https://edmate.example' : 'http://localhost:8080';
        const blockName = secure ? '__Host-edmate.age-block' : 'edmate.age-block';
        const allow = vi.fn(async () => true);
        const blocked = createAuthConfig({
          identity,
          env: { ...envFor(url), email: emailEnv(false).email! },
          emailSignIn: { mail: memoryMail(), limiter: { allow } },
          request: {
            cookies: { get: (n: string) => (n === blockName ? { value: '1' } : undefined) },
            headers: NO_HEADERS,
          },
        });
        const call = (account: Partial<Account>, extra: object = {}) =>
          blocked.callbacks!.signIn!({ user: {} as User, account: account as Account, ...extra });
        expect(
          await call(
            { provider: 'google', providerAccountId: 'g' },
            { profile: { email: 'a@example.test', email_verified: true } },
          ),
        ).toBe(false);
        expect(
          await call(
            { provider: 'email', type: 'email', providerAccountId: 'a@example.test' },
            { email: { verificationRequest: true } },
          ),
        ).toBe(false);
        expect(
          await call({ provider: 'email', type: 'email', providerAccountId: 'a@example.test' }),
        ).toBe(false);
        expect(allow).not.toHaveBeenCalled();
      }
    });

    it('fails closed with no request to read the current session from', async () => {
      const bare = createAuthConfig({ identity, env: envFor('http://localhost:8080') });
      expect(
        await bare.callbacks!.signIn!({
          user: {} as User,
          account: { provider: 'google', providerAccountId: 'g' } as Account,
          profile: { email: 'a@example.test', email_verified: true } as Profile,
        }),
      ).toBe(false);
    });

    it('an owner whose standing cannot be read (not a student) is not treated as blocked (fix round 1)', async () => {
      const owner = { id: 'owner-1' };
      const fake: Partial<IdentityStore> = {
        getUserByAccount: vi.fn(async () => owner as never),
        getUserByEmail: vi.fn(async () => owner as never),
        learnerStatus: vi.fn(async () => {
          throw new RepositoryError('scope', 'learnerStatus');
        }),
        getSessionAndUser: vi.fn(async () => null),
      };
      const notAStudent = createAuthConfig({
        identity: fake as IdentityStore,
        env: envFor('http://localhost:8080'),
        request: noCookies,
      });
      expect(
        await notAStudent.callbacks!.signIn!({
          user: {} as User,
          account: { provider: 'google', providerAccountId: 'g' } as Account,
          profile: { email: 'a@example.test', email_verified: true } as Profile,
        }),
      ).toBe(true);
    });

    it('1.4c: an existing owner whose email is not verified refuses the link, without checking hasLinkedAccount', async () => {
      const owner = { id: 'owner-2', emailVerifiedAt: null };
      const hasLinkedAccount = vi.fn(async () => false);
      const fake: Partial<IdentityStore> = {
        getUserByAccount: vi.fn(async () => null),
        getUserByEmail: vi.fn(async () => owner as never),
        hasLinkedAccount,
        getSessionAndUser: vi.fn(async () => null),
      };
      const unverifiedOwner = createAuthConfig({
        identity: fake as IdentityStore,
        env: envFor('http://localhost:8080'),
        request: noCookies,
      });
      expect(
        await unverifiedOwner.callbacks!.signIn!({
          user: {} as User,
          account: { provider: 'google', providerAccountId: 'g-new' } as Account,
          profile: { email: 'a@example.test', email_verified: true } as Profile,
        }),
      ).toBe(false);
      expect(hasLinkedAccount).not.toHaveBeenCalled();
    });

    it('1.4c: an existing, verified owner who already has a different linked Google account refuses the link', async () => {
      const owner = { id: 'owner-3', emailVerifiedAt: new Date() };
      const hasLinkedAccount = vi.fn(async () => true);
      const fake: Partial<IdentityStore> = {
        getUserByAccount: vi.fn(async () => null),
        getUserByEmail: vi.fn(async () => owner as never),
        hasLinkedAccount,
        getSessionAndUser: vi.fn(async () => null),
      };
      const alreadyLinked = createAuthConfig({
        identity: fake as IdentityStore,
        env: envFor('http://localhost:8080'),
        request: noCookies,
      });
      expect(
        await alreadyLinked.callbacks!.signIn!({
          user: {} as User,
          account: { provider: 'google', providerAccountId: 'g-new' } as Account,
          profile: { email: 'a@example.test', email_verified: true } as Profile,
        }),
      ).toBe(false);
      expect(hasLinkedAccount).toHaveBeenCalledWith('owner-3', 'google');
    });

    it('1.4c: a verified owner with no other linked Google account links (hasLinkedAccount only runs when unlinked)', async () => {
      const owner = { id: 'owner-4', emailVerifiedAt: new Date() };
      const hasLinkedAccount = vi.fn(async () => false);
      const fake: Partial<IdentityStore> = {
        getUserByAccount: vi.fn(async () => null),
        getUserByEmail: vi.fn(async () => owner as never),
        hasLinkedAccount,
        learnerStatus: vi.fn(async () => 'clear' as never),
        getSessionAndUser: vi.fn(async () => null),
      };
      const linkable = createAuthConfig({
        identity: fake as IdentityStore,
        env: envFor('http://localhost:8080'),
        request: noCookies,
      });
      expect(
        await linkable.callbacks!.signIn!({
          user: {} as User,
          account: { provider: 'google', providerAccountId: 'g-new' } as Account,
          profile: { email: 'a@example.test', email_verified: true } as Profile,
        }),
      ).toBe(true);
      expect(hasLinkedAccount).toHaveBeenCalledWith('owner-4', 'google');
    });
  });

  describe('signIn callback while already signed in (shared device)', () => {
    async function world() {
      const id = memoryIdentity();
      const a = await id.createStudent({
        email: 'a@example.test',
        emailVerifiedAt: null,
        name: 'A',
      });
      await id.linkAccount({
        userId: a.id,
        type: 'oidc',
        provider: 'google',
        providerAccountId: 'g-a',
      });
      const b = await id.createStudent({
        email: 'b@example.test',
        emailVerifiedAt: null,
        name: 'B',
      });
      await id.linkAccount({
        userId: b.id,
        type: 'oidc',
        provider: 'google',
        providerAccountId: 'g-b',
      });
      const token = randomUUID();
      await id.createSession(token, a.id, new Date(Date.now() + 60_000));
      const signedInAsA = {
        cookies: {
          get: (n: string) => (n === 'authjs.session-token' ? { value: token } : undefined),
        },
        headers: NO_HEADERS,
      };
      const config = createAuthConfig({
        identity: id,
        env: envFor('http://localhost:8080'),
        request: signedInAsA,
      });
      const signIn = (providerAccountId: string, email: string) =>
        config.callbacks!.signIn!({
          user: {} as User,
          account: { provider: 'google', providerAccountId } as Account,
          profile: { email, email_verified: true } as Profile,
        });
      return { id, signIn };
    }

    it("refuses a new Google account: it would be linked to the signed-in user's account", async () => {
      const { signIn, id } = await world();
      expect(await signIn('g-new', 'sibling@example.test')).toBe(false);
      expect(id.linked).toHaveLength(2);
    });

    it("refuses another user's Google account", async () => {
      const { signIn } = await world();
      expect(await signIn('g-b', 'b@example.test')).toBe(false);
    });

    it('allows signing in again with the same Google account', async () => {
      const { signIn } = await world();
      expect(await signIn('g-a', 'a@example.test')).toBe(true);
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
      '[auth] error AdapterError',
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

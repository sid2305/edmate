// Task 1.7 acceptance, end to end: Google sign-in through Auth.js's real handlers (fake Google,
// in-memory identity store, the real content/ packs and notices, a fixed clock), then the age gate.
// An under-13 answer erases the account, closes the browser and blocks it for 24 hours; a 13-17
// learner in a consent market can't start the agent or subscribe; an adult can do everything.
import { fileURLToPath } from 'node:url';
import NextAuth from 'next-auth';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_ID, fakeGoogle, Jar, type GoogleUser } from '../../test/fake-google';
import { memoryIdentity } from '../../test/memory-identity';
import {
  AGE_BLOCK_MAX_AGE_S,
  ageBlockCookieName,
  loadAgeContent,
  submitAgeAnswer,
  type AgeGateDeps,
} from './age';
import { createAuthConfig, principalFromIdentity, sessionCookieName } from './config';
import { readAuthEnv } from './env';
import { AGE_GATE_PATH, createGuard, resolvePrincipal, type GuardDeps } from './guard';
import { ROUTE_POLICY } from './policy';

const ORIGIN = 'http://localhost:8080';
const SESSION_COOKIE = sessionCookieName(false);
const BLOCK_COOKIE = ageBlockCookieName(false);
const NOW = new Date('2026-10-20T12:00:00Z');
const content = loadAgeContent(fileURLToPath(new URL('../../../../content', import.meta.url)));

const env = readAuthEnv({
  AUTH_SECRET: 'test-only-secret-'.padEnd(48, 'x'),
  AUTH_URL: ORIGIN,
  AUTH_TRUST_HOST: 'true',
  AUTH_GOOGLE_ID: CLIENT_ID,
  AUTH_GOOGLE_SECRET: 'test-only-google-client-secret',
});

/** Every student route as [method, sample path, needs the agent clearance]. */
const STUDENT_ROUTES = ROUTE_POLICY.flatMap((row) =>
  typeof row.access !== 'string' && row.access.includes('student')
    ? row.methods.map(
        (m) =>
          [
            m,
            row.pattern.replace(/\/\*\*$/, '/x/y').replace(/\/\*(?=\/|$)/g, '/item_1'),
            row.clearance === 'agent',
          ] as const,
      )
    : [],
);

function setup() {
  // The real store's clock is the database's; the fake's is fixed so the birth-year edges hold.
  const identity = memoryIdentity(
    () => NOW,
    (m) => content.agePolicy(m),
  );
  const google = { user: learner(), calls: [] as string[] } as {
    user: GoogleUser;
    nonce?: string;
    calls: string[];
  };
  const { handlers } = NextAuth((req) =>
    createAuthConfig({
      identity,
      env,
      providerFetch: fakeGoogle(google),
      log: () => {},
      ...(req ? { request: req } : {}),
    }),
  );
  const jar = new Jar();
  /** Signs in on a given browser (jar); `signIn()` below is this on the one `t.jar` keeps. */
  async function signInOn(j: Jar): Promise<Response> {
    async function c(method: 'GET' | 'POST', path: string, form?: Record<string, string>) {
      const headers: Record<string, string> = { cookie: j.header() };
      if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
      const req = new NextRequest(`${ORIGIN}${path}`, {
        method,
        headers,
        ...(form ? { body: new URLSearchParams(form).toString() } : {}),
      });
      const res = await (method === 'GET' ? handlers.GET(req) : handlers.POST(req));
      j.take(res);
      return res;
    }
    const csrf = await c('GET', '/api/auth/csrf');
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const start = await c('POST', '/api/auth/signin/google', {
      csrfToken,
      callbackUrl: `${ORIGIN}/`,
    });
    const authorize = new URL(start.headers.get('location')!);
    const nonce = authorize.searchParams.get('nonce');
    if (nonce) google.nonce = nonce;
    const state = authorize.searchParams.get('state') ?? '';
    return c('GET', `/api/auth/callback/google?code=good-code&state=${encodeURIComponent(state)}`);
  }
  const signIn = () => signInOn(jar);

  const guardDeps: GuardDeps = {
    getPrincipal: principalFromIdentity(identity, SESSION_COOKIE),
    learnerStatus: (userId) => identity.learnerStatus(userId),
    allowedOrigin: ORIGIN,
  };
  const redirects: string[] = [];
  const guard = createGuard(
    () => guardDeps,
    () => ({
      cookies: async () => cookieView(),
      redirect: (url: string): never => {
        redirects.push(url);
        throw new Error(`REDIRECT ${url}`);
      },
      notFound: (): never => {
        throw new Error('NOT_FOUND');
      },
    }),
  );
  /** The jar as a server action sees it (Next's cookies()), with the options of every set. */
  const sets: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  function cookieView(): AgeGateDeps['cookies'] {
    return {
      get: (name) => {
        const value = jar.values.get(name);
        return value === undefined ? undefined : { value };
      },
      set: (name, value, options) => {
        sets.push({ name, value, options: { ...options } });
        if (options.maxAge === 0) jar.values.delete(name);
        else jar.values.set(name, value);
      },
    };
  }
  /** The age gate's server action (index.ts wires the same deps). */
  function answer(input: unknown) {
    return submitAgeAnswer(input, {
      cookies: cookieView(),
      resolve: (c) => resolvePrincipal(guardDeps, c),
      identity,
      content,
      secureCookies: false,
      sessionCookie: SESSION_COOKIE,
      now: () => NOW,
    });
  }
  /** Calls a student route through the guard, as the browser would. */
  async function route(method: string, path: string): Promise<number> {
    const handler = guard.withRole(['student'], () => new Response('ok'));
    const req = new NextRequest(`${ORIGIN}${path}`, {
      method,
      headers: {
        cookie: jar.header(),
        ...(method === 'GET' ? {} : { origin: ORIGIN }),
      },
    });
    return (await handler(req)).status;
  }
  return { identity, google, jar, sets, redirects, guard, signIn, signInOn, answer, route };
}

function learner(over: Partial<GoogleUser> = {}): GoogleUser {
  return {
    sub: 'google-sub-age',
    email: 'Learner.Age@Example.TEST',
    email_verified: true,
    name: 'Learner',
    ...over,
  };
}

describe('the age gate, end to end (1.7)', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('sign-in creates a locked account: every student route is 403 and pages go to the gate', async () => {
    const callback = await t.signIn();
    expect(callback.status).toBe(302);
    expect(t.jar.values.has(SESSION_COOKIE)).toBe(true);
    expect(t.identity.users.size).toBe(1);
    expect(STUDENT_ROUTES.length).toBeGreaterThanOrEqual(6);
    for (const [method, path] of STUDENT_ROUTES) {
      expect(await t.route(method, path), `${method} ${path}`).toBe(403);
    }
    await expect(t.guard.requireRole(['student'])).rejects.toThrow(`REDIRECT ${AGE_GATE_PATH}`);
    // The gate page itself opens.
    expect(await t.guard.requireRole(['student'], { clearance: 'none' })).toMatchObject({
      role: 'student',
    });
  });

  it('under 13: erased, signed out, blocked; the next request is 401 and a retry is refused', async () => {
    await t.signIn();
    expect(await t.answer({ market: 'IN', birthYear: '2014' })).toEqual({ status: 'closed' });

    // Erased: no user, account link, session or consent is left.
    expect(t.identity.users.size).toBe(0);
    expect(t.identity.accounts.size).toBe(0);
    expect(t.identity.sessions.size).toBe(0);
    expect(t.identity.consents).toEqual([]);
    expect(t.identity.ages.size).toBe(0);
    // The session cookie is cleared; the block cookie is httpOnly, Lax, 24 h, and says nothing.
    expect(t.jar.values.has(SESSION_COOKIE)).toBe(false);
    expect(t.sets.find((s) => s.name === BLOCK_COOKIE)).toEqual({
      name: BLOCK_COOKIE,
      value: '1',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: AGE_BLOCK_MAX_AGE_S,
      },
    });

    expect(await t.route('GET', '/api/me/progress')).toBe(401);

    // A retry from this browser: Google sign-in is refused and creates nothing.
    const retry = await t.signIn();
    expect(retry.headers.get('location')).toContain('/api/auth/error?error=AccessDenied');
    expect(t.identity.users.size).toBe(0);
    expect(t.jar.values.has(SESSION_COOKIE)).toBe(false);
    // And the gate refuses another answer.
    expect(await t.answer({ market: 'IN', birthYear: '1990' })).toEqual({ status: 'closed' });
  });

  it('a year that may be 13 or 12 counts as 12 (the younger age)', async () => {
    await t.signIn();
    expect(await t.answer({ market: 'US', birthYear: '2013' })).toEqual({ status: 'closed' });
    expect(t.identity.users.size).toBe(0);
  });

  it('after the block expires the browser may sign in again', async () => {
    await t.signIn();
    await t.answer({ market: 'IN', birthYear: '2014' });
    // The browser drops the cookie after its Max-Age.
    t.jar.values.delete(BLOCK_COOKIE);
    expect((await t.signIn()).headers.get('location')).not.toContain('error');
    expect(t.identity.users.size).toBe(1);
  });

  it('13-17 in a consent market: may use the site, not start the agent or subscribe', async () => {
    await t.signIn();
    expect(await t.answer({ market: 'IN', birthYear: '2010' })).toEqual({
      status: 'parent_needed',
    });
    for (const [method, path, agent] of STUDENT_ROUTES) {
      expect(await t.route(method, path), `${method} ${path}`).toBe(agent ? 403 : 200);
    }
    expect(await t.route('POST', '/api/sessions')).toBe(403);
    expect(await t.route('POST', '/api/subscriptions')).toBe(403);
    expect(await t.route('GET', '/api/me/progress')).toBe(200);
    await expect(t.guard.requireRole(['student'], { clearance: 'agent' })).rejects.toThrow(
      `REDIRECT ${AGE_GATE_PATH}`,
    );
    // The consent recorded is the notice version the server showed for IN.
    expect(t.identity.consents).toEqual([
      expect.objectContaining({
        kind: 'privacy_notice',
        version: content.notice('IN').version,
        grantedBy: 'self',
      }),
    ]);
  });

  it('the US pack is signed, so US 13-17 may use the site without a parent', async () => {
    await t.signIn();
    expect(await t.answer({ market: 'US', birthYear: '2010' })).toEqual({ status: 'clear' });
  });

  it('an adult is clear on every student route', async () => {
    await t.signIn();
    expect(await t.answer({ market: 'global', birthYear: '1990' })).toEqual({ status: 'clear' });
    for (const [method, path] of STUDENT_ROUTES) {
      expect(await t.route(method, path), `${method} ${path}`).toBe(200);
    }
    expect(t.redirects).toEqual([]);
  });

  it('the form cannot choose the notice version or add fields', async () => {
    await t.signIn();
    const r = await t.answer({ market: 'IN', birthYear: '1990', noticeVersion: 'signed-v9' });
    expect(r).toMatchObject({ error: { code: 'validation', retryable: false } });
    expect(t.identity.consents).toEqual([]);
    expect(await t.route('GET', '/api/me/progress')).toBe(403);
  });

  it('an erase the store could not finish still closes and blocks the browser', async () => {
    await t.signIn();
    t.identity.blockErase = true;
    expect(await t.answer({ market: 'IN', birthYear: '2014' })).toEqual({ status: 'closed' });
    expect(t.identity.users.size).toBe(1); // left for staff to erase (12.1)
    expect(t.identity.sessions.size).toBe(0);
    expect(t.jar.values.get(BLOCK_COOKIE)).toBe('1');
    expect(await t.route('GET', '/api/me/progress')).toBe(401);
    expect((await t.signIn()).headers.get('location')).toContain('error=AccessDenied');
  });

  it('fix round 1: a blocked erase refuses sign-in from any browser, not only the one blocked', async () => {
    await t.signIn();
    t.identity.blockErase = true;
    expect(await t.answer({ market: 'IN', birthYear: '2014' })).toEqual({ status: 'closed' });
    const userId = [...t.identity.users.keys()][0]!;
    await expect(t.identity.learnerStatus(userId)).resolves.toBe('under_age');

    // A second browser, with no block cookie of its own, tries the same Google account.
    const other = new Jar();
    const retry = await t.signInOn(other);
    expect(retry.headers.get('location')).toContain('/api/auth/error?error=AccessDenied');
    expect(other.values.has(SESSION_COOKIE)).toBe(false);

    // Even a session created some other way for this account can never clear the gate.
    const leftover = 'leftover'.padEnd(32, '0');
    await t.identity.createSession(leftover, userId, new Date(NOW.getTime() + 86_400_000));
    t.jar.values.set(SESSION_COOKIE, leftover);
    expect(await t.route('GET', '/api/me/progress')).toBe(403);
    expect(await t.route('POST', '/api/subscriptions')).toBe(403);
    await expect(t.guard.requireRole(['student'])).rejects.toThrow(`REDIRECT ${AGE_GATE_PATH}`);
  });
});

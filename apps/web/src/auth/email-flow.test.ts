// Task 1.4: email magic-link sign-in end to end through Auth.js's real handlers, with the in-memory
// identity store, an in-memory MailSender and in-memory counters. No socket is opened: the global
// fetch rejects (test/setup.ts) and nothing here reaches SMTP or Redis.
import NextAuth from 'next-auth';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { memoryIdentity } from '../../test/memory-identity';
import { memoryMail } from '../../test/memory-mail';
import { createAuthConfig, principalFromIdentity, sessionCookieName } from './config';
import { buildEmailCallbackUrl } from './confirm';
import { CONFIRM_PATH } from './email';
import { readAuthEnv } from './env';
import { ADDRESS_LIMIT, createSignInLimiter, IP_LIMIT, type SignInCounter } from './rate-limit';

const ORIGIN = 'http://localhost:8080';
const SESSION_COOKIE = sessionCookieName(false);
const VERIFY = `${ORIGIN}/api/auth/verify-request?provider=email&type=email`;
const RATE_LIMITED = `${ORIGIN}/api/auth/error?error=RateLimited`;

const env = readAuthEnv({
  AUTH_SECRET: 'test-only-secret-'.padEnd(48, 'x'),
  AUTH_URL: ORIGIN,
  AUTH_TRUST_HOST: 'true',
  AUTH_GOOGLE_ID: 'test-client-id.apps.example',
  AUTH_GOOGLE_SECRET: 'test-only-google-client-secret',
  EMAIL_SERVER: ['smtp://', 'sandbox.example.test:1025'].join(''),
  EMAIL_FROM: 'Edmate <sign-in@example.test>',
  REDIS_URL: 'redis://127.0.0.1:6379',
});

/** An in-memory counter with the sliding window's contract (no expiry needed within one test). */
function memoryCounter(): SignInCounter & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    tryTake(key, max) {
      keys.push(key);
      const n = counts.get(key) ?? 0;
      if (n >= max) return false;
      counts.set(key, n + 1);
      return true;
    },
  };
}

class Jar {
  readonly values = new Map<string, string>();
  take(res: Response) {
    for (const c of res.headers.getSetCookie()) {
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

function setup(opts: { failMail?: boolean } = {}) {
  let clock = Date.now();
  const identity = memoryIdentity(() => new Date(clock));
  const mail = memoryMail(opts.failMail ? { fail: new Error('550 rejected for x@example.test') } : {});
  const counters = { ip: memoryCounter(), addr: memoryCounter() };
  const limiter = createSignInLimiter({ secret: env.secret, trustHost: env.trustHost, counters });
  const logs: string[] = [];
  const { handlers } = NextAuth((req) =>
    createAuthConfig({
      identity,
      env,
      emailSignIn: { mail, limiter },
      log: (l) => logs.push(l),
      ...(req ? { request: req } : {}),
    }),
  );
  const jar = new Jar();

  async function call(
    method: 'GET' | 'POST',
    pathOrUrl: string,
    form?: Record<string, string>,
    extra: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = { cookie: jar.header(), ...extra };
    if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${ORIGIN}${pathOrUrl}`;
    const req = new NextRequest(url, {
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
  /** POST /api/auth/signin/email for `email` from `ip`. */
  async function requestLink(
    email: string,
    o: { ip?: string; headers?: Record<string, string>; callbackUrl?: string } = {},
  ) {
    return call(
      'POST',
      '/api/auth/signin/email',
      { csrfToken: await csrf(), email, callbackUrl: o.callbackUrl ?? `${ORIGIN}/` },
      { 'x-forwarded-for': o.ip ?? '203.0.113.10', ...o.headers },
    );
  }
  /** The link in the last mail, as mailed: the confirm page (task 1.4b). */
  function mailedLink(): URL {
    const m = mail.sent.at(-1);
    if (!m) throw new Error('no mail sent');
    const found = /^http\S+$/m.exec(m.text);
    if (!found) throw new Error('no link in mail');
    return new URL(found[0]);
  }
  /**
   * The real Auth.js callback the confirm page forwards to for the last mail's link, built by the
   * confirm page's own `buildEmailCallbackUrl`, so the two hops are exercised together.
   */
  function lastLink(): string {
    const link = mailedLink();
    if (link.pathname !== CONFIRM_PATH) throw new Error(`mailed link is not the confirm page`);
    const url = buildEmailCallbackUrl(new URL(ORIGIN), Object.fromEntries(link.searchParams));
    if (!url) throw new Error('mailed link query is not a valid confirm query');
    return url;
  }
  async function session() {
    return (await call('GET', '/api/auth/session')).json() as Promise<{
      user?: Record<string, unknown>;
    } | null>;
  }
  const advance = (ms: number) => {
    clock += ms;
  };
  return {
    identity,
    mail,
    counters,
    logs,
    jar,
    call,
    csrf,
    requestLink,
    mailedLink,
    lastLink,
    session,
    advance,
  };
}

describe('email magic-link sign-in through Auth.js', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('request → one mail → link → session cookie → a new student with a verified email', async () => {
    const res = await t.requestLink('New.Student@Example.TEST');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(VERIFY);
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0]).toMatchObject({
      to: 'new.student@example.test',
      subject: 'Your Edmate sign-in link',
    });
    // The store holds Auth.js's hashed token, never the token in the link.
    // The mail points at the confirm page, never at the callback that spends the token.
    const mailed = t.mailedLink();
    expect(mailed.origin).toBe(ORIGIN);
    expect(mailed.pathname).toBe('/sign-in/confirm');
    expect(t.mail.sent[0]?.text).not.toContain('/api/auth/callback/');
    const link = new URL(t.lastLink());
    expect(link.origin).toBe(ORIGIN);
    expect(link.pathname).toBe('/api/auth/callback/email');
    const stored = t.identity.links.get('new.student@example.test');
    expect(stored?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.token).not.toBe(link.searchParams.get('token'));

    const cb = await t.call('GET', link.toString());
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe(`${ORIGIN}/`);
    expect(t.jar.values.has(SESSION_COOKIE)).toBe(true);
    expect(await t.session()).toMatchObject({ user: { id: 'usr_1', role: 'student' } });
    const user = t.identity.users.get('usr_1');
    expect(user).toMatchObject({ role: 'student', email: 'new.student@example.test', name: '' });
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(t.identity.linked).toEqual([]);
  });

  it('a link works once: the second use is refused with no new session', async () => {
    await t.requestLink('once@example.test');
    const link = t.lastLink();
    await t.call('GET', link);
    t.jar.values.clear();
    const again = await t.call('GET', link);
    expect(again.headers.get('location')).toBe(`${ORIGIN}/api/auth/error?error=Verification`);
    expect(t.jar.values.has(SESSION_COOKIE)).toBe(false);
    expect(t.identity.sessions.size).toBe(1);
  });

  it('an expired link (past 15 minutes) is refused', async () => {
    await t.requestLink('late@example.test');
    t.advance(15 * 60 * 1000 + 1_000);
    const res = await t.call('GET', t.lastLink());
    expect(res.headers.get('location')).toBe(`${ORIGIN}/api/auth/error?error=Verification`);
    expect(t.identity.users.size).toBe(0);
    expect(t.identity.sessions.size).toBe(0);
  });

  it('an older link stops working once a newer one is issued', async () => {
    await t.requestLink('twice@example.test');
    const first = t.lastLink();
    await t.requestLink('twice@example.test');
    const second = t.lastLink();
    expect(second).not.toBe(first);
    const old = await t.call('GET', first);
    expect(old.headers.get('location')).toBe(`${ORIGIN}/api/auth/error?error=Verification`);
    const ok = await t.call('GET', second);
    expect(ok.headers.get('location')).toBe(`${ORIGIN}/`);
  });

  it('an existing Google user who signs in by link reaches the same user; nothing is linked', async () => {
    const g = await t.identity.createStudent({
      email: 'asha@example.test',
      emailVerifiedAt: null,
      name: 'Asha',
    });
    await t.identity.linkAccount({
      userId: g.id,
      type: 'oidc',
      provider: 'google',
      providerAccountId: 'google-sub-asha',
    });
    await t.requestLink('Asha@Example.test');
    await t.call('GET', t.lastLink());
    expect((await t.session())?.user).toEqual({ id: g.id, role: 'student' });
    expect(t.identity.users.size).toBe(1);
    expect(t.identity.accounts.size).toBe(1);
    expect(t.identity.linked).toHaveLength(1);
    expect(t.identity.users.get(g.id)?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('signed in as A, following existing user B’s link deletes A’s session and signs in B (no linking)', async () => {
    const b = await t.identity.createStudent({ email: 'b@example.test', emailVerifiedAt: null, name: 'B' });
    await t.requestLink('a@example.test');
    await t.call('GET', t.lastLink());
    const aToken = t.jar.values.get(SESSION_COOKIE)!;
    await t.requestLink('b@example.test');
    await t.call('GET', t.lastLink());
    expect(t.identity.sessions.has(aToken)).toBe(false);
    expect((await t.session())?.user).toEqual({ id: b.id, role: 'student' });
    expect(t.identity.linked).toEqual([]);
  });

  it('signed in as A, following a new address’s link signs in a new user B; A’s cookie is replaced', async () => {
    await t.requestLink('a@example.test');
    await t.call('GET', t.lastLink());
    const aToken = t.jar.values.get(SESSION_COOKIE)!;
    await t.requestLink('newb@example.test');
    await t.call('GET', t.lastLink());
    // Auth.js only deletes the old session when the address already has a user; A's row stays
    // until it expires, but the browser no longer holds its token.
    expect(t.jar.values.get(SESSION_COOKIE)).not.toBe(aToken);
    expect((await t.session())?.user).toEqual({ id: 'usr_2', role: 'student' });
    expect(t.identity.linked).toEqual([]);
  });

  it('no enumeration: a known and an unknown address get identical responses and one mail each', async () => {
    await t.identity.createStudent({ email: 'known@example.test', emailVerifiedAt: null, name: 'K' });
    const known = await t.requestLink('known@example.test');
    const unknown = await t.requestLink('unknown@example.test');
    expect(unknown.status).toBe(known.status);
    expect(unknown.headers.get('location')).toBe(known.headers.get('location'));
    expect(await unknown.text()).toBe(await known.text());
    expect(t.mail.sent.map((m) => m.to)).toEqual(['known@example.test', 'unknown@example.test']);
  });

  it('per address: the 6th request in the window is refused with no token and no mail; +tag and case share it', async () => {
    const variants = ['ravi@example.test', 'RAVI@example.test', 'ravi+a@example.test', 'Ravi+b@Example.Test'];
    for (let i = 0; i < ADDRESS_LIMIT; i += 1) {
      const res = await t.requestLink(variants[i % variants.length]!, { ip: `203.0.113.${20 + i}` });
      expect(res.headers.get('location')).toBe(VERIFY);
    }
    expect(t.mail.sent).toHaveLength(ADDRESS_LIMIT);
    t.identity.links.clear();
    const refused = await t.requestLink('ravi+c@example.test', { ip: '203.0.113.99' });
    expect(refused.status).toBe(302);
    expect(refused.headers.get('location')).toBe(RATE_LIMITED);
    expect(t.mail.sent).toHaveLength(ADDRESS_LIMIT);
    expect(t.identity.links.size).toBe(0);
    // Another address is unaffected.
    expect((await t.requestLink('other@example.test')).headers.get('location')).toBe(VERIFY);
  });

  it('a rate-limited known and a rate-limited unknown address get identical responses', async () => {
    await t.identity.createStudent({ email: 'known@example.test', emailVerifiedAt: null, name: 'K' });
    for (let i = 0; i < ADDRESS_LIMIT; i += 1) {
      await t.requestLink('known@example.test', { ip: `198.51.100.${i + 1}` });
      await t.requestLink('ghost@example.test', { ip: `198.51.100.${i + 50}` });
    }
    const known = await t.requestLink('known@example.test', { ip: '198.51.100.200' });
    const unknown = await t.requestLink('ghost@example.test', { ip: '198.51.100.201' });
    expect(known.headers.get('location')).toBe(RATE_LIMITED);
    expect(unknown.status).toBe(known.status);
    expect(unknown.headers.get('location')).toBe(known.headers.get('location'));
    expect(await unknown.text()).toBe(await known.text());
  });

  it('per IP: the 51st request from one IP (any addresses) is refused; spoofed left XFF entries are ignored', async () => {
    for (let i = 0; i < IP_LIMIT; i += 1) {
      const res = await t.requestLink(`s${i}@example.test`, {
        headers: { 'x-forwarded-for': `192.0.2.${i}, 203.0.113.77` },
      });
      expect(res.headers.get('location')).toBe(VERIFY);
    }
    const refused = await t.requestLink('fresh@example.test', {
      headers: { 'x-forwarded-for': '192.0.2.250, 203.0.113.77' },
    });
    expect(refused.headers.get('location')).toBe(RATE_LIMITED);
    expect(t.mail.sent).toHaveLength(IP_LIMIT);
    // Redis would see only HMAC keys: no address or IP in any key the counters got.
    const keys = [...t.counters.ip.keys, ...t.counters.addr.keys].join(' ');
    expect(keys).not.toMatch(/example\.test|203\.0\.113|192\.0\.2/);
  });

  it('no host-header poisoning: a forged forwarded host still mails a link on AUTH_URL', async () => {
    const res = await t.requestLink('host@example.test', {
      headers: { 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' },
    });
    expect(res.status).toBe(302);
    expect(t.mailedLink().origin).toBe(ORIGIN);
    expect(t.mail.sent[0]?.html).not.toContain('evil.test');
  });

  it('no open redirect: callbackUrl=https://evil.test ends at the app origin after the link', async () => {
    await t.requestLink('redir@example.test', { callbackUrl: 'https://evil.test/steal' });
    const link = new URL(t.lastLink());
    expect(new URL(t.mailedLink().searchParams.get('callbackUrl')!).href).toBe(`${ORIGIN}/`);
    const cb = await t.call('GET', link.toString());
    expect(new URL(cb.headers.get('location')!).href).toBe(`${ORIGIN}/`);
  });

  it('a sign-in POST without the CSRF token is refused and sends no mail', async () => {
    await t.csrf();
    const res = await t.call(
      'POST',
      '/api/auth/signin/email',
      { email: 'csrf@example.test', callbackUrl: `${ORIGIN}/` },
      { 'x-forwarded-for': '203.0.113.10' },
    );
    expect(res.headers.get('location')).toContain('error=MissingCSRF');
    expect(t.mail.sent).toHaveLength(0);
    expect(t.identity.links.size).toBe(0);
  });

  it.each([
    'two@@example.test',
    'a@example.test,b@example.test',
    'a@example.test\r\nBcc: x@example.test',
    'not-an-address',
  ])('a bad address (%j) gets the generic error page, no token and no mail', async (bad) => {
    const res = await t.requestLink(bad);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/api/auth/error?error=Configuration`);
    expect(t.mail.sent).toHaveLength(0);
    expect(t.identity.links.size).toBe(0);
    expect(t.logs.join('\n')).not.toMatch(/example\.test/);
  });

  it('a mail failure gets the generic error page and logs the error name only', async () => {
    const f = setup({ failMail: true });
    await f.identity.createStudent({ email: 'x@example.test', emailVerifiedAt: null, name: 'X' });
    const known = await f.requestLink('x@example.test');
    const unknown = await f.requestLink('y@example.test');
    expect(known.headers.get('location')).toBe(`${ORIGIN}/api/auth/error?error=Configuration`);
    expect(unknown.headers.get('location')).toBe(known.headers.get('location'));
    expect(f.logs).toContain('[auth] sign-in mail failed: Error');
    expect(f.logs.join('\n')).not.toMatch(/example\.test|550/);
  });

  it('the link callback without a token or with a forged token signs nobody in', async () => {
    await t.requestLink('forge@example.test');
    const link = new URL(t.lastLink());
    link.searchParams.set('token', 'f'.repeat(64));
    const forged = await t.call('GET', link.toString());
    expect(forged.headers.get('location')).toBe(`${ORIGIN}/api/auth/error?error=Verification`);
    link.searchParams.delete('token');
    const missing = await t.call('GET', link.toString());
    expect(missing.headers.get('location')).toContain('/api/auth/error');
    expect(t.identity.sessions.size).toBe(0);
    expect(
      await principalFromIdentity(t.identity, SESSION_COOKIE)({ get: () => undefined }),
    ).toBeNull();
  });

  it('never used the global fetch', async () => {
    await t.requestLink('fetch@example.test');
    await t.call('GET', t.lastLink());
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

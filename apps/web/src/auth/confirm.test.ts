// Task 1.4b: the confirm page's pure logic. The binding cookie is an HMAC of the normalised address
// (lead answer to Q3), so a cookie from a browser that asked for its own link never auto-signs it
// into a different address someone else mailed it.
import { describe, expect, it } from 'vitest';
import {
  buildEmailCallbackUrl,
  confirmView,
  CONFIRMED_MAX_AGE_S,
  createLinkBindingCookieValue,
  createLinkConfirmedCookieValue,
  emailCallbackGate,
  isSameOriginRequest,
  isVerifyRequestRedirect,
  LINK_BINDING_COOKIE,
  LINK_CONFIRMED_COOKIE,
  linkBindingCookie,
  linkBindingCookieName,
  linkConfirmedCookie,
  linkConfirmedCookieName,
  parseConfirmParams,
  shouldBindLink,
  verifyLinkBindingCookieValue,
  verifyLinkConfirmedCookieValue,
} from './confirm';
import { LINK_MAX_AGE_S, MAX_EMAIL_LENGTH } from './email';

// Built at run time: never a literal secret in the repo.
const SECRET = ['test', 'only', 'binding'].join('-').padEnd(40, 'x');
const OTHER_SECRET = ['other', 'test', 'only'].join('-').padEnd(40, 'y');
const ORIGIN = new URL('https://app.example.test');
const TOKEN = 'ab'.repeat(32);
const EMAIL = 'student1@example.test';
const CALLBACK = 'https://app.example.test/teachers';
const PARAMS = { token: TOKEN, email: EMAIL, callbackUrl: CALLBACK };
const NOW = Date.UTC(2026, 9, 23, 12);
const NOW_S = NOW / 1000;

describe('the link binding cookie', () => {
  it('round-trips for the same address', () => {
    const value = createLinkBindingCookieValue(SECRET, EMAIL);
    expect(value).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(verifyLinkBindingCookieValue(SECRET, value, EMAIL)).toBe(true);
  });

  it('holds no trace of the address', () => {
    const value = createLinkBindingCookieValue(SECRET, EMAIL)!;
    expect(value).not.toContain('student1');
    expect(value).not.toContain('example');
  });

  it.each([
    ['upper case', 'Student1@Example.TEST'],
    ['surrounding whitespace', '  student1@example.test\t'],
    ['fullwidth at sign', 'student1＠example.test'],
  ])('a %s variant of the same address matches', (_label, variant) => {
    const value = createLinkBindingCookieValue(SECRET, variant);
    expect(verifyLinkBindingCookieValue(SECRET, value, EMAIL)).toBe(true);
    expect(verifyLinkBindingCookieValue(SECRET, createLinkBindingCookieValue(SECRET, EMAIL), variant)).toBe(
      true,
    );
  });

  it('a cookie for one address never matches another address', () => {
    const mine = createLinkBindingCookieValue(SECRET, 'victim@example.test');
    expect(verifyLinkBindingCookieValue(SECRET, mine, 'attacker@example.test')).toBe(false);
  });

  it('a different secret fails closed', () => {
    const value = createLinkBindingCookieValue(OTHER_SECRET, EMAIL);
    expect(verifyLinkBindingCookieValue(SECRET, value, EMAIL)).toBe(false);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['truncated', createLinkBindingCookieValue(SECRET, EMAIL)!.slice(0, 63)],
    ['over-long', `${createLinkBindingCookieValue(SECRET, EMAIL)!}0`],
    ['non-hex', `1.${'z'.repeat(64)}`],
    ['without an issue time', createLinkBindingCookieValue(SECRET, EMAIL)!.split('.')[1]],
    ['with a forged issue time', `${NOW_S + 1}.${createLinkBindingCookieValue(SECRET, EMAIL, NOW)!.split('.')[1]!}`],
    ['upper-case hex', createLinkBindingCookieValue(SECRET, EMAIL)!.toUpperCase()],
    ['not a string', 42],
  ])('a %s cookie fails closed', (_label, value) => {
    expect(verifyLinkBindingCookieValue(SECRET, value, EMAIL)).toBe(false);
  });

  it.each([undefined, '', 'not-an-address', 'two@@example.test', 7])(
    'an invalid address (%j) makes no cookie and matches nothing',
    (bad) => {
      expect(createLinkBindingCookieValue(SECRET, bad)).toBeNull();
      const value = createLinkBindingCookieValue(SECRET, EMAIL);
      expect(verifyLinkBindingCookieValue(SECRET, value, bad)).toBe(false);
    },
  );

  it('an empty secret fails closed', () => {
    expect(createLinkBindingCookieValue('', EMAIL)).toBeNull();
    expect(verifyLinkBindingCookieValue('', `1.${'a'.repeat(64)}`, EMAIL)).toBe(false);
  });

  it('is named with the __Host- prefix only when secure', () => {
    expect(linkBindingCookieName(true)).toBe(`__Host-${LINK_BINDING_COOKIE}`);
    expect(linkBindingCookieName(false)).toBe(LINK_BINDING_COOKIE);
  });

  it('is httpOnly, SameSite=Lax, Path=/ and lives as long as the link', () => {
    expect(linkBindingCookie(SECRET, true, EMAIL, NOW)).toEqual({
      name: `__Host-${LINK_BINDING_COOKIE}`,
      value: createLinkBindingCookieValue(SECRET, EMAIL, NOW),
      options: { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: LINK_MAX_AGE_S },
    });
    expect(linkBindingCookie(SECRET, false, EMAIL)?.options.secure).toBe(false);
    expect(linkBindingCookie(SECRET, false, 'nope')).toBeNull();
  });

  it('carries its issue time: valid for the link life, refused after it or far in the future', () => {
    const value = createLinkBindingCookieValue(SECRET, EMAIL, NOW)!;
    expect(value.startsWith(`${NOW_S}.`)).toBe(true);
    expect(verifyLinkBindingCookieValue(SECRET, value, EMAIL, NOW + LINK_MAX_AGE_S * 1000)).toBe(true);
    expect(verifyLinkBindingCookieValue(SECRET, value, EMAIL, NOW + (LINK_MAX_AGE_S + 1) * 1000)).toBe(false);
    expect(verifyLinkBindingCookieValue(SECRET, value, EMAIL, NOW - 30_000)).toBe(true);
    expect(verifyLinkBindingCookieValue(SECRET, value, EMAIL, NOW - 31_000)).toBe(false);
  });
});

describe('the confirm click cookie', () => {
  it('round-trips for this token and address, 2 minutes at most', () => {
    const value = createLinkConfirmedCookieValue(SECRET, TOKEN, EMAIL, NOW)!;
    expect(value).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(verifyLinkConfirmedCookieValue(SECRET, value, TOKEN, ' Student1@Example.TEST', NOW)).toBe(true);
    expect(verifyLinkConfirmedCookieValue(SECRET, value, TOKEN, EMAIL, NOW + 120_000)).toBe(true);
    expect(verifyLinkConfirmedCookieValue(SECRET, value, TOKEN, EMAIL, NOW + 121_000)).toBe(false);
    expect(CONFIRMED_MAX_AGE_S).toBeLessThanOrEqual(120);
  });

  it('never matches another token, address, secret, or a binding value', () => {
    const value = createLinkConfirmedCookieValue(SECRET, TOKEN, EMAIL, NOW);
    expect(verifyLinkConfirmedCookieValue(SECRET, value, 'cd'.repeat(32), EMAIL, NOW)).toBe(false);
    expect(verifyLinkConfirmedCookieValue(SECRET, value, TOKEN, 'other@example.test', NOW)).toBe(false);
    expect(verifyLinkConfirmedCookieValue(OTHER_SECRET, value, TOKEN, EMAIL, NOW)).toBe(false);
    const binding = createLinkBindingCookieValue(SECRET, EMAIL, NOW);
    expect(verifyLinkConfirmedCookieValue(SECRET, binding, TOKEN, EMAIL, NOW)).toBe(false);
    expect(verifyLinkBindingCookieValue(SECRET, value, EMAIL, NOW)).toBe(false);
  });

  it('bad input makes no cookie and matches nothing', () => {
    expect(createLinkConfirmedCookieValue(SECRET, 'nope', EMAIL)).toBeNull();
    expect(createLinkConfirmedCookieValue(SECRET, TOKEN, 'nope')).toBeNull();
    expect(createLinkConfirmedCookieValue('', TOKEN, EMAIL)).toBeNull();
    const value = createLinkConfirmedCookieValue(SECRET, TOKEN, EMAIL);
    expect(verifyLinkConfirmedCookieValue(SECRET, value, 7, EMAIL)).toBe(false);
    expect(verifyLinkConfirmedCookieValue('', value, TOKEN, EMAIL)).toBe(false);
    expect(linkConfirmedCookie(SECRET, false, { token: 'nope', email: EMAIL })).toBeNull();
  });

  it('is HttpOnly, SameSite=Lax, __Host- when secure, and lives 2 minutes', () => {
    expect(linkConfirmedCookie(SECRET, true, { token: TOKEN, email: EMAIL }, NOW)).toEqual({
      name: `__Host-${LINK_CONFIRMED_COOKIE}`,
      value: createLinkConfirmedCookieValue(SECRET, TOKEN, EMAIL, NOW),
      options: { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: CONFIRMED_MAX_AGE_S },
    });
    expect(linkConfirmedCookieName(false)).toBe(LINK_CONFIRMED_COOKIE);
  });
});

describe('shouldBindLink (sign-in POST)', () => {
  const VERIFY = new Response(null, {
    status: 302,
    headers: { location: 'https://app.example.test/api/auth/verify-request?provider=email' },
  });
  const h = (init: Record<string, string>) => new Headers(init);

  it('same Origin + the verify-request redirect → yes', () => {
    expect(shouldBindLink(h({ origin: ORIGIN.origin }), VERIFY, ORIGIN)).toBe(true);
    expect(shouldBindLink(h({ 'sec-fetch-site': 'same-origin' }), VERIFY, ORIGIN)).toBe(true);
  });

  it.each([
    ['another Origin', { origin: 'https://evil.test' }],
    ['Origin null', { origin: 'null' }],
    ['another Origin despite Sec-Fetch-Site', { origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' }],
    ['same-site but not same-origin', { 'sec-fetch-site': 'same-site' }],
    ['no signal', {}],
  ])('%s → no', (_l, init) => {
    expect(isSameOriginRequest(h(init), ORIGIN)).toBe(false);
    expect(shouldBindLink(h(init), VERIFY, ORIGIN)).toBe(false);
  });

  it.each([
    ['a CSRF error redirect', 302, '/api/auth/signin?error=MissingCSRF'],
    ['an error page redirect', 302, '/api/auth/error?error=Configuration'],
    ['a look-alike path', 302, '/api/auth/verify-request/../error'],
    ['a 200', 200, '/api/auth/verify-request'],
    ['no Location', 302, null],
  ])('%s → not a success', (_l, status, location) => {
    const res = new Response(null, { status, headers: location ? { location } : {} });
    expect(isVerifyRequestRedirect(res)).toBe(false);
  });

  it('an unparsable Location → not a success', () => {
    const res = new Response(null, { status: 302, headers: { location: 'http://[bad' } });
    expect(isVerifyRequestRedirect(res)).toBe(false);
  });
});

describe('emailCallbackGate', () => {
  const query = new URLSearchParams(PARAMS);
  const deps = (binding: unknown, confirmed: unknown) => ({ secret: SECRET, origin: ORIGIN, binding, confirmed, now: NOW });
  const toConfirm = `https://app.example.test/sign-in/confirm?${query.toString()}`;

  it('no cookie → the confirm page with the same query', () => {
    expect(emailCallbackGate(query, deps(undefined, undefined))).toBe(toConfirm);
  });

  it('a binding cookie for the link address, or a confirm cookie for this token → through', () => {
    expect(emailCallbackGate(query, deps(createLinkBindingCookieValue(SECRET, EMAIL, NOW), undefined))).toBeNull();
    const confirmed = createLinkConfirmedCookieValue(SECRET, TOKEN, EMAIL, NOW);
    expect(emailCallbackGate(query, deps('junk', confirmed))).toBeNull();
  });

  it('defaults to the current time', () => {
    const live = { secret: SECRET, origin: ORIGIN, binding: createLinkBindingCookieValue(SECRET, EMAIL), confirmed: undefined };
    expect(emailCallbackGate(query, live)).toBeNull();
  });

  it('cookies for another address or token → the confirm page', () => {
    const other = createLinkBindingCookieValue(SECRET, 'other@example.test', NOW);
    const otherToken = createLinkConfirmedCookieValue(SECRET, 'cd'.repeat(32), EMAIL, NOW);
    expect(emailCallbackGate(query, deps(other, otherToken))).toBe(toConfirm);
  });

  it('a repeated or missing key → the confirm page', () => {
    const bound = createLinkBindingCookieValue(SECRET, EMAIL, NOW);
    const repeated = new URLSearchParams(query);
    repeated.append('email', 'other@example.test');
    expect(emailCallbackGate(repeated, deps(bound, undefined))).toContain('/sign-in/confirm?');
    const missing = new URLSearchParams({ token: TOKEN, email: EMAIL });
    expect(emailCallbackGate(missing, deps(bound, undefined))).toContain('/sign-in/confirm?');
  });
});

describe('parseConfirmParams', () => {
  it('accepts a well-formed link query', () => {
    expect(parseConfirmParams(PARAMS)).toEqual(PARAMS);
  });

  it('accepts a relative callbackUrl (Auth.js validates it again on the callback)', () => {
    expect(parseConfirmParams({ ...PARAMS, callbackUrl: '/teachers' })?.callbackUrl).toBe('/teachers');
  });

  it.each([
    ['no token', { email: EMAIL, callbackUrl: CALLBACK }],
    ['a non-hex token', { ...PARAMS, token: 'g'.repeat(64) }],
    ['an upper-case token', { ...PARAMS, token: 'AB'.repeat(32) }],
    ['a short token', { ...PARAMS, token: 'a'.repeat(31) }],
    ['a long token', { ...PARAMS, token: 'a'.repeat(129) }],
    ['no email', { token: TOKEN, callbackUrl: CALLBACK }],
    ['a bad email', { ...PARAMS, email: 'not-an-address' }],
    ['an over-length email', { ...PARAMS, email: `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.test` }],
    ['no callbackUrl', { token: TOKEN, email: EMAIL }],
    ['an empty callbackUrl', { ...PARAMS, callbackUrl: '' }],
    ['an over-long callbackUrl', { ...PARAMS, callbackUrl: `/${'a'.repeat(2048)}` }],
    ['a repeated token', { ...PARAMS, token: [TOKEN, TOKEN] }],
    ['a repeated email', { ...PARAMS, email: [EMAIL, 'other@example.test'] }],
  ])('refuses %s', (_label, raw) => {
    expect(parseConfirmParams(raw)).toBeNull();
  });

  it.each([null, undefined, 'token=x', 3])('refuses a non-object (%j)', (raw) => {
    expect(parseConfirmParams(raw)).toBeNull();
  });
});

describe('buildEmailCallbackUrl', () => {
  it('rebuilds the exact Auth.js email callback on the given origin', () => {
    const url = new URL(buildEmailCallbackUrl(ORIGIN, PARAMS)!);
    expect(url.origin).toBe('https://app.example.test');
    expect(url.pathname).toBe('/api/auth/callback/email');
    expect(Object.fromEntries(url.searchParams)).toEqual(PARAMS);
  });

  it('encodes each value exactly once (a plus-tagged address survives both hops)', () => {
    const email = 'ravi+tag@example.test';
    const url = buildEmailCallbackUrl(ORIGIN, { ...PARAMS, email, callbackUrl: '/a?b=c&d=e' })!;
    expect(url).toContain('email=ravi%2Btag%40example.test');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('email')).toBe(email);
    expect(parsed.searchParams.get('callbackUrl')).toBe('/a?b=c&d=e');
    expect([...parsed.searchParams.keys()]).toEqual(['token', 'email', 'callbackUrl']);
  });

  it('ignores the origin\'s own path and any extra keys', () => {
    const url = new URL(
      buildEmailCallbackUrl(new URL('https://app.example.test/some/path?x=1'), { ...PARAMS, extra: '1' })!,
    );
    expect(url.pathname).toBe('/api/auth/callback/email');
    expect(url.searchParams.has('extra')).toBe(false);
    expect(url.searchParams.has('x')).toBe(false);
  });

  it('returns null for invalid input', () => {
    expect(buildEmailCallbackUrl(ORIGIN, { ...PARAMS, token: 'nope' })).toBeNull();
  });
});

describe('confirmView', () => {
  const deps = (cookie: unknown) => ({ secret: SECRET, origin: ORIGIN, cookie });

  it('invalid params → invalid, whatever the cookie', () => {
    const cookie = createLinkBindingCookieValue(SECRET, EMAIL);
    expect(confirmView({ email: EMAIL }, deps(cookie))).toEqual({ kind: 'invalid' });
  });

  it('a cookie for this address → auto, straight to the real callback', () => {
    const cookie = createLinkBindingCookieValue(SECRET, EMAIL);
    expect(confirmView(PARAMS, deps(cookie))).toEqual({
      kind: 'auto',
      url: buildEmailCallbackUrl(ORIGIN, PARAMS),
    });
  });

  it('a cookie for a case or whitespace variant of this address → auto', () => {
    const cookie = createLinkBindingCookieValue(SECRET, ' STUDENT1@example.test ');
    expect(confirmView(PARAMS, deps(cookie)).kind).toBe('auto');
  });

  it.each([
    ['no cookie', undefined],
    ['a forged cookie', `${Math.floor(Date.now() / 1000)}.${'f'.repeat(64)}`],
    ['a cookie for another address', createLinkBindingCookieValue(SECRET, 'other@example.test')],
    ['a cookie made with another secret', createLinkBindingCookieValue(OTHER_SECRET, EMAIL)],
  ])('%s → manual, showing the address being signed into', (_label, cookie) => {
    expect(confirmView(PARAMS, deps(cookie))).toEqual({ kind: 'manual', ...PARAMS });
  });
});

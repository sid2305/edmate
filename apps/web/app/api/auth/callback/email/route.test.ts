// Task 1.4b (fix round): the email callback GET spends the token only for a browser holding the
// binding cookie for the link's address, or the confirm click's cookie for this token and address.
// Anyone else goes to the confirm page with the same query, and Auth.js is never called.
import { NextRequest } from 'next/server';
import { getSortedRoutes } from 'next/dist/shared/lib/router/utils/sorted-routes';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLinkBindingCookieValue,
  createLinkConfirmedCookieValue,
  emailCallbackGate,
} from '../../../../../src/auth/confirm';

const SECRET = ['callback', 'test', 'only'].join('-').padEnd(40, 'q');
const ORIGIN = 'http://localhost:8080';

const authGet = vi.fn<(req: NextRequest) => Promise<Response>>();
const authPost = vi.fn<(req: NextRequest) => Promise<Response>>();
vi.mock('../../../../../src/auth', () => ({
  handlers: { GET: (req: NextRequest) => authGet(req), POST: (req: NextRequest) => authPost(req) },
  publicRoute: <H,>(h: H) => h,
  emailCallbackRedirect: (req: NextRequest) =>
    emailCallbackGate(req.nextUrl.searchParams, {
      secret: SECRET,
      origin: new URL(ORIGIN),
      binding: req.cookies.get('edmate.link-bound')?.value,
      confirmed: req.cookies.get('edmate.link-confirmed')?.value,
    }),
}));

import * as route from './route';
import { GET } from './route';

const TOKEN = 'ab'.repeat(32);
const OTHER_TOKEN = 'cd'.repeat(32);
const EMAIL = 'attacker@example.test';
const QUERY = new URLSearchParams({ token: TOKEN, email: EMAIL, callbackUrl: `${ORIGIN}/` }).toString();

function get(cookies: Record<string, string> = {}, query = QUERY): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(`${ORIGIN}/api/auth/callback/email?${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

const SIGNED_IN = new Response(null, { status: 302, headers: { location: `${ORIGIN}/` } });

beforeEach(() => {
  authGet.mockReset();
  authPost.mockReset();
  authGet.mockResolvedValue(SIGNED_IN);
});

function expectConfirmRedirect(res: Response, query = QUERY): void {
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe(`${ORIGIN}/sign-in/confirm?${query}`);
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(authGet).not.toHaveBeenCalled();
}

describe('/api/auth/callback/email', () => {
  it('a bare GET with no cookie (victim sent straight here) → confirm page, token not spent', async () => {
    expectConfirmRedirect(await GET(get()));
  });

  it('the binding cookie for this address → passed through to Auth.js', async () => {
    const req = get({ 'edmate.link-bound': createLinkBindingCookieValue(SECRET, EMAIL)! });
    expect(await GET(req)).toBe(SIGNED_IN);
    expect(authGet).toHaveBeenCalledExactlyOnceWith(req);
  });

  it('the binding cookie for another address → confirm page', async () => {
    const bound = createLinkBindingCookieValue(SECRET, 'victim@example.test')!;
    expectConfirmRedirect(await GET(get({ 'edmate.link-bound': bound })));
  });

  it('an expired binding cookie → confirm page', async () => {
    const old = createLinkBindingCookieValue(SECRET, EMAIL, Date.now() - 901_000)!;
    expectConfirmRedirect(await GET(get({ 'edmate.link-bound': old })));
  });

  it('a valid confirmed cookie for this token and address → passed through', async () => {
    const confirmed = createLinkConfirmedCookieValue(SECRET, TOKEN, EMAIL)!;
    expect(await GET(get({ 'edmate.link-confirmed': confirmed }))).toBe(SIGNED_IN);
    expect(authGet).toHaveBeenCalledOnce();
  });

  it.each([
    ['another token', () => createLinkConfirmedCookieValue(SECRET, OTHER_TOKEN, EMAIL)!],
    ['another address', () => createLinkConfirmedCookieValue(SECRET, TOKEN, 'victim@example.test')!],
    ['an expired click', () => createLinkConfirmedCookieValue(SECRET, TOKEN, EMAIL, Date.now() - 121_000)!],
    ['a binding value in its place', () => createLinkBindingCookieValue(SECRET, EMAIL)!],
  ])('a confirmed cookie for %s → confirm page', async (_label, value) => {
    expectConfirmRedirect(await GET(get({ 'edmate.link-confirmed': value() })));
  });

  it('a repeated email param → confirm page even with a binding cookie', async () => {
    const query = `${QUERY}&email=victim%40example.test`;
    const bound = createLinkBindingCookieValue(SECRET, EMAIL)!;
    expectConfirmRedirect(await GET(get({ 'edmate.link-bound': bound }, query)), query);
  });

  it('a malformed query → confirm page (which shows "invalid"), Auth.js untouched', async () => {
    expectConfirmRedirect(await GET(get({}, 'token=nope')), 'token=nope');
  });

  it('POST is refused: no POST handler, so Next answers 405 and Auth.js never sees it', () => {
    // A cross-site form POST with an attacker's token in the query would otherwise be spent by
    // Auth.js (it reads token and email from the query on any method). Next resolves this literal
    // path ahead of `[...nextauth]` by path, before the method, so a missing POST is a 405 here,
    // never a fall-through to the catch-all.
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic']);
    expect('POST' in route).toBe(false);
    expect(authPost).not.toHaveBeenCalled();
  });

  it("Next's own route order puts this literal path ahead of the [...nextauth] catch-all", () => {
    // Next picks the route file by path first (this order), then the method, so a POST to this
    // path lands on this module (405), never on the catch-all's POST.
    expect(getSortedRoutes(['/api/auth/[...nextauth]', '/api/auth/callback/email'])).toEqual([
      '/api/auth/callback/email',
      '/api/auth/[...nextauth]',
    ]);
  });
});

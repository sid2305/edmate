// Task 1.4b: the email sign-in POST runs Auth.js unchanged, then adds the address-bound link
// binding cookie, whatever the outcome (sent, rate-limited, mail failure), so its presence carries
// no enumeration signal. Auth.js's own headers and cookies survive untouched.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLinkBindingCookieValue, linkBindingCookie } from '../../../../../src/auth/confirm';

const SECRET = ['route', 'test', 'only'].join('-').padEnd(40, 'z');
const ORIGIN = 'http://localhost:8080';
const state = vi.hoisted(() => ({ secure: false }));

const authPost = vi.fn<(req: NextRequest) => Promise<Response>>();
const authGet = vi.fn<(req: NextRequest) => Promise<Response>>();
vi.mock('../../../../../src/auth', () => ({
  handlers: { GET: (req: NextRequest) => authGet(req), POST: (req: NextRequest) => authPost(req) },
  publicRoute: <H,>(h: H) => h,
  linkBindingCookie: (email: unknown) => linkBindingCookie(SECRET, state.secure, email),
}));

import { GET, POST } from './route';

/** Two Auth.js cookies on a redirect, like a real sign-in POST response. */
function authJsResponse(location: string): Response {
  const headers = new Headers({ location, 'cache-control': 'private, no-store' });
  headers.append('set-cookie', 'authjs.csrf-token=abc; Path=/; HttpOnly; SameSite=Lax');
  headers.append('set-cookie', 'authjs.callback-url=http%3A%2F%2Flocalhost%3A8080; Path=/; HttpOnly');
  return new Response(null, { status: 302, headers });
}

function formPost(body: string, contentType = 'application/x-www-form-urlencoded') {
  return new NextRequest(`${ORIGIN}/api/auth/signin/email`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

const VERIFY = `${ORIGIN}/api/auth/verify-request?provider=email&type=email`;

function bindingCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((c) => /^(__Host-)?edmate\.link-bound=/.test(c));
}

beforeEach(() => {
  state.secure = false;
  authPost.mockReset();
  authGet.mockReset();
});

describe('/api/auth/signin/email', () => {
  it('GET passes through to Auth.js unchanged', async () => {
    const original = new Response('page', { status: 200 });
    authGet.mockResolvedValue(original);
    const req = new NextRequest(`${ORIGIN}/api/auth/signin/email`);
    expect(await GET(req)).toBe(original);
    expect(authGet).toHaveBeenCalledWith(req);
  });

  it('POST: Auth.js gets the request with its body intact', async () => {
    authPost.mockImplementation(async (req) => {
      const form = await req.formData();
      expect(form.get('email')).toBe('a@example.test');
      expect(form.get('csrfToken')).toBe('t');
      return authJsResponse(VERIFY);
    });
    await POST(formPost('csrfToken=t&email=a%40example.test'));
    expect(authPost).toHaveBeenCalledOnce();
  });

  it('POST: keeps every Auth.js header and both its cookies, plus one binding cookie', async () => {
    authPost.mockResolvedValue(authJsResponse(VERIFY));
    const res = await POST(formPost('csrfToken=t&email=Student%40Example.TEST'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(VERIFY);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(cookies[0]).toMatch(/^authjs\.csrf-token=abc;/);
    expect(cookies[1]).toMatch(/^authjs\.callback-url=/);
    const bound = bindingCookie(res)!;
    const value = createLinkBindingCookieValue(SECRET, 'student@example.test');
    expect(bound.startsWith(`edmate.link-bound=${value};`)).toBe(true);
    expect(bound).toMatch(/;\s*Path=\//i);
    expect(bound).toMatch(/;\s*Max-Age=900/i);
    expect(bound).toMatch(/;\s*HttpOnly/i);
    expect(bound).toMatch(/;\s*SameSite=Lax/i);
    expect(bound).not.toMatch(/;\s*Secure/i);
    expect(bound).not.toMatch(/student|example/i);
  });

  it('POST on https: the cookie is __Host- prefixed and Secure', async () => {
    state.secure = true;
    authPost.mockResolvedValue(authJsResponse(VERIFY));
    const bound = bindingCookie(await POST(formPost('email=s%40example.test')))!;
    expect(bound).toMatch(/^__Host-edmate\.link-bound=[0-9a-f]{64};/);
    expect(bound).toMatch(/;\s*Secure/i);
  });

  it.each([
    ['rate-limited', `${ORIGIN}/api/auth/error?error=RateLimited`],
    ['mail failure', `${ORIGIN}/api/auth/error?error=Configuration`],
    ['missing CSRF', `${ORIGIN}/api/auth/signin?error=MissingCSRF`],
  ])('POST: the binding cookie is set on a %s response too', async (_label, location) => {
    authPost.mockResolvedValue(authJsResponse(location));
    const res = await POST(formPost('email=s%40example.test'));
    expect(res.headers.get('location')).toBe(location);
    expect(bindingCookie(res)).toBeDefined();
  });

  it('POST: a JSON body is read too', async () => {
    authPost.mockResolvedValue(authJsResponse(VERIFY));
    const res = await POST(formPost(JSON.stringify({ email: 'j@example.test' }), 'application/json'));
    expect(bindingCookie(res)).toContain(createLinkBindingCookieValue(SECRET, 'j@example.test')!);
  });

  it.each([
    ['an invalid address', 'email=not-an-address', undefined],
    ['no address', 'csrfToken=t', undefined],
    ['a repeated address', 'email=a%40example.test&email=b%40example.test', undefined],
    ['a malformed JSON body', '{nope', 'application/json'],
    ['a JSON array', '["a@example.test"]', 'application/json'],
    ['an unknown content type', 'email=a%40example.test', 'text/plain'],
  ])('POST with %s: Auth.js response untouched, no binding cookie', async (_l, body, type) => {
    const original = authJsResponse(`${ORIGIN}/api/auth/error?error=Configuration`);
    authPost.mockResolvedValue(original);
    const res = await POST(formPost(body, type));
    expect(res).toBe(original);
    expect(bindingCookie(res)).toBeUndefined();
  });

  it('POST: Auth.js throwing is not swallowed', async () => {
    authPost.mockRejectedValue(new Error('boom'));
    await expect(POST(formPost('email=s%40example.test'))).rejects.toThrow('boom');
  });
});

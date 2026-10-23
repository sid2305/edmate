// Task 1.4b: the email magic-link request. Auth.js handles it exactly as before (CSRF, rate limit,
// token, mail); this route then adds one cookie binding this browser to the posted address, so the
// confirm page (`/sign-in/confirm`) can forward the link straight to Auth.js only in the browser
// that asked for it, for that address. The cookie is set only for a same-origin POST that Auth.js
// answered with its "check your email" redirect (fix round): a cross-site form, which has no valid
// CSRF token, can't plant a cookie for the attacker's own address. Next resolves this literal path ahead of the
// `[...nextauth]` catch-all; every other Auth.js path is unaffected.
import { NextResponse, type NextRequest } from 'next/server';
import { handlers, linkBindingCookie, publicRoute, signInBindsLink } from '../../../../../src/auth';

export const dynamic = 'force-dynamic';

/** The posted address, read from a clone so Auth.js still gets the untouched body. */
async function postedEmail(req: NextRequest): Promise<unknown> {
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body: unknown = await req.clone().json();
      return body !== null && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).email
        : undefined;
    }
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      const all = (await req.clone().formData()).getAll('email');
      return all.length === 1 ? all[0] : undefined;
    }
  } catch {
    // An unreadable body: Auth.js answers it; there is no address to bind.
  }
  return undefined;
}

export const GET = publicRoute(handlers.GET);

export const POST = publicRoute(async (req: NextRequest): Promise<Response> => {
  const email = await postedEmail(req);
  const res = await handlers.POST(req);
  if (!signInBindsLink(req, res)) return res;
  const cookie = linkBindingCookie(email);
  if (!cookie) return res;
  // A copy, so an immutable Auth.js response is fine; `new Headers(headers)` keeps each Set-Cookie.
  const out = new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
  out.cookies.set(cookie.name, cookie.value, cookie.options);
  return out;
});

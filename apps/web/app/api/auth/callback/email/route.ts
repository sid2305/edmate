// Task 1.4b (fix round): Auth.js's email callback spends the single-use token on a plain GET, so
// an attacker could send a victim straight here with the attacker's own token and skip the confirm
// page. This literal path (resolved ahead of the `[...nextauth]` catch-all) passes the GET to
// Auth.js only for a browser holding the binding cookie for the link's address or the confirm
// click's short-lived cookie for this token; anyone else is redirected to the confirm page with
// the same query, and no token is spent.
import { NextResponse, type NextRequest } from 'next/server';
import { emailCallbackRedirect, handlers, publicRoute } from '../../../../../src/auth';

export const dynamic = 'force-dynamic';

export const GET = publicRoute(async (req: NextRequest): Promise<Response> => {
  const confirm = emailCallbackRedirect(req);
  if (confirm === null) return handlers.GET(req);
  const res = NextResponse.redirect(confirm, 303);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('referrer-policy', 'no-referrer');
  return res;
});

export const POST = publicRoute(handlers.POST);

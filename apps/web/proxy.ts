// Task 13.3a: per-request security headers that `next.config.ts`'s static `headers()` can't
// set. Next's own App Router hydration/RSC bootstrap emits inline `<script>` content that differs
// per request (it carries the page's data), so a build-time hash can never match it; a nonce is
// the only workable `script-src` allowlist, and Next needs it minted per request, which only
// `proxy.ts` (Next 16's renamed `middleware.ts`) can do. Every page and API route under
// `apps/web/app/**` already declares `export const dynamic = 'force-dynamic'`, so forcing dynamic
// rendering here (a nonce-bearing CSP always does) costs nothing extra.
//
// `proxy.ts` sets only `Content-Security-Policy` (needs the per-request nonce) and
// `Strict-Transport-Security` (needs `NODE_ENV`, kept alongside the CSP for one place to read
// every security header's per-request logic). The three header-only values that need no
// per-request data (X-Frame-Options, X-Content-Type-Options, Referrer-Policy) are set once in
// `next.config.ts`'s `headers()`; this file does not duplicate them.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** A plain env-like record; lets tests pass a partial object without satisfying the full,
 * platform-specific `NodeJS.ProcessEnv` shape. */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * Where the browser reaches the upload bucket directly (`RecordingUpload.tsx`, `UploadsView.tsx`
 * sign a PUT URL and call it straight from the client, bypassing the Next server). Must be in
 * `connect-src` or presigned uploads fail under this CSP. Read the same way
 * `storageConfigFromEnv` (`src/storage/presign.ts`) reads it (`S3_PUBLIC_ENDPOINT` falling back
 * to `S3_ENDPOINT`), but this never throws: a missing or malformed value fails the CSP *closed*
 * (no extra origin is added, so uploads fail with a CSP violation) rather than silently widening
 * the policy.
 */
export function storageOrigin(env: Env = process.env): string | null {
  const raw = env.S3_PUBLIC_ENDPOINT?.trim() || env.S3_ENDPOINT?.trim() || '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Builds the `Content-Security-Policy` header value for one request's nonce. */
export function buildCsp(nonce: string, env: Env = process.env): string {
  // Lead amendment 3 (25 Oct 2026): dev's React build uses eval for Fast Refresh/stack frames, so
  // `script-src` needs `'unsafe-eval'` outside production only; never in production.
  const isProd = env.NODE_ENV === 'production';
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (!isProd) scriptSrc.push("'unsafe-eval'");

  const connectSrc = ["'self'"];
  const storage = storageOrigin(env);
  if (storage) connectSrc.push(storage);

  // `style-src 'unsafe-inline'`: three files use React's `style={{...}}` prop
  // (`src/chat/renderReply.tsx`, `app/staff/reports/report-row.tsx`, `app/welcome/age/page.tsx`),
  // which the browser enforces as `style-src`/`style-src-attr`, not `script-src`; nonces don't
  // attach to style attributes in the browsers this pilot targets. CSS-attribute injection is a
  // much smaller blast radius than script injection, so `'unsafe-inline'` stays on `style-src`
  // only, never `script-src`.
  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `connect-src ${connectSrc.join(' ')}`,
    `img-src 'self'`,
    `font-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ];
  return directives.join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  // Next 16 reads the nonce it stamps its own inline bootstrap/hydration scripts with from the
  // *request's* `content-security-policy` header, not from an `x-nonce` convention (Next's own
  // doc: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md). Setting the
  // CSP only on the response leaves Next's inline scripts nonce-less, so `'strict-dynamic'`
  // blocks them and no page hydrates. No app code reads `x-nonce` (grepped), so it is dropped
  // rather than kept alongside this.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  // Production only, no per-request `x-forwarded-proto` check: there is no in-repo reverse
  // proxy/TLS terminator for a real deploy (one US cloud region terminates TLS), so a flat
  // production check is correct for how this app is actually deployed. The local docker stack
  // also runs NODE_ENV=production (docker/compose.yaml) but over plain HTTP
  // (docker/Caddyfile has `auto_https off`); browsers ignore a Strict-Transport-Security header
  // delivered over plain HTTP, so this flat check never mis-promotes that stack to HTTPS-only.
  // No `preload` (lead amendment 1, 25 Oct 2026): it is a one-way submission to browsers' preload
  // lists from the real production domain, which isn't chosen yet.
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }

  return response;
}

export const config = {
  // Every other path gets the CSP/HSTS too (including API routes); only build assets and the
  // favicon are excluded, per Next's own recommendation.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

// Route guards (task 1.3). Every API route handler is wrapped in exactly one of withRole,
// publicRoute or providerRoute; route-coverage.test.ts fails on an unwrapped export or one whose
// wrapper disagrees with ROUTE_POLICY. Dependencies are injected so tests need no Next runtime.
import type { Role } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { apiError } from './errors';
import { policyFor, sameAccess, type Access } from './policy';

/** The signed-in user as route code sees it: an id and one role, nothing personal. */
export interface Principal {
  userId: string;
  role: Role;
}

/** Reads one cookie: NextRequest.cookies and next/headers cookies() both fit. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export interface GuardDeps {
  /** The principal for the request's session cookie, or null. Throws if the lookup fails. */
  getPrincipal(cookies: CookieReader): Promise<Principal | null>;
  /** The app's own origin (`AUTH_URL`); unsafe methods must come from it. */
  allowedOrigin: string;
}

/** What a server component or action uses instead of the route guard. */
export interface PageDeps {
  cookies(): Promise<CookieReader>;
  redirect(url: string): never;
  notFound(): never;
}

/** Marks a route handler as guarded, with the access it enforces. */
export const GUARD: unique symbol = Symbol.for('edmate.auth.guard');
export type Guarded<H> = H & { readonly [GUARD]: Access };

export interface RoleContext {
  principal: Principal;
  /** Next's dynamic route params, unvalidated: parse them with Zod. */
  params: Promise<unknown>;
}

type RouteHandler = (req: NextRequest, ctx?: unknown) => Promise<Response>;

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SIGN_IN = '/api/auth/signin';

function brand<H extends object>(handler: H, access: Access): Guarded<H> {
  return Object.defineProperty(handler, GUARD, { value: access, enumerable: false }) as Guarded<H>;
}

/**
 * An unsafe method must come from our own origin: an `Origin` header equal to it, or (no Origin)
 * `Sec-Fetch-Site: same-origin`. A missing, `null` or foreign Origin is refused.
 */
function sameOrigin(req: Request, allowed: string): boolean {
  const origin = req.headers.get('origin');
  if (origin !== null) return origin === allowed;
  return req.headers.get('sec-fetch-site') === 'same-origin';
}

function paramsOf(ctx: unknown): Promise<unknown> {
  const params = (ctx as { params?: unknown } | undefined)?.params;
  return Promise.resolve(params ?? {});
}

/**
 * The one place a request becomes a principal. 1.7 adds its "age not confirmed: no access" check
 * here; 1.3 adds no gate.
 */
export async function resolvePrincipal(
  deps: Pick<GuardDeps, 'getPrincipal'>,
  cookies: CookieReader,
): Promise<Principal | null> {
  return deps.getPrincipal(cookies);
}

/** The guards over lazily resolved dependencies (env and database are read on first use). */
export function createGuard(guardDeps: () => GuardDeps, pageDeps: () => PageDeps) {
  /**
   * Signed-in users with one of `roles` only. In order: the route policy must agree (else 403),
   * an unsafe method must be same-origin (403), no session is 401, a wrong role is 403, a failed
   * lookup is 500 (never anonymous, never allowed). Then the handler runs.
   */
  function withRole(
    roles: readonly Role[],
    handler: (req: NextRequest, ctx: RoleContext) => Response | Promise<Response>,
  ): Guarded<RouteHandler> {
    const allowed = [...roles];
    const route: RouteHandler = async (req, ctx) => {
      const access = policyFor(req.method, req.nextUrl.pathname);
      if (access === null || !sameAccess(access, allowed)) {
        return apiError('forbidden', 'This route is not open to you.', 403);
      }
      let deps: GuardDeps;
      let principal: Principal | null;
      try {
        deps = guardDeps();
        if (UNSAFE.has(req.method) && !sameOrigin(req, deps.allowedOrigin)) {
          return apiError('forbidden', 'Cross-site request refused.', 403);
        }
        principal = await resolvePrincipal(deps, req.cookies);
      } catch {
        return apiError('provider_error', 'Could not check your sign-in. Try again.', 500);
      }
      if (!principal) return apiError('unauthorized', 'Sign in first.', 401);
      if (!allowed.includes(principal.role)) {
        return apiError('forbidden', 'This route is not open to you.', 403);
      }
      return handler(req, { principal, params: paramsOf(ctx) });
    };
    return brand(route, allowed);
  }

  /** Open to anyone; only marks the handler. Auth.js's own POSTs keep its CSRF token check. */
  function publicRoute<H extends (...args: never[]) => unknown>(handler: H): Guarded<H> {
    return brand(((...args: Parameters<H>) => handler(...args)) as H, 'public');
  }

  /** Called by a provider (webhooks): no session, no Origin check; signatures come with 10.x. */
  function providerRoute<H extends (...args: never[]) => unknown>(handler: H): Guarded<H> {
    return brand(((...args: Parameters<H>) => handler(...args)) as H, 'provider');
  }

  /**
   * For server components and server actions (which keep Next's own Origin check): the principal,
   * a redirect to sign-in when anonymous, or not-found for a wrong role.
   */
  async function requireRole(roles: readonly Role[]): Promise<Principal> {
    const page = pageDeps();
    const principal = await resolvePrincipal(guardDeps(), await page.cookies());
    if (!principal) return page.redirect(SIGN_IN);
    if (!roles.includes(principal.role)) return page.notFound();
    return principal;
  }

  return { withRole, publicRoute, providerRoute, requireRole };
}

export type Guard = ReturnType<typeof createGuard>;

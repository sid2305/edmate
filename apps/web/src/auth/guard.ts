// Route guards (task 1.3). Every API route handler is wrapped in exactly one of withRole,
// publicRoute or providerRoute; route-coverage.test.ts fails on an unwrapped export or one whose
// wrapper disagrees with ROUTE_POLICY. Dependencies are injected so tests need no Next runtime.
import { RepositoryError, type AgeStatus, type Role } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { apiError } from './errors';
import { ruleFor, sameAccess, type Access, type Clearance } from './policy';

/** The age gate page (1.7): where a learner with no age answer is sent. */
export const AGE_GATE_PATH = '/welcome/age';

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
  /** A student's age-gate standing, read fresh (1.7). Throws if the lookup fails. */
  learnerStatus(userId: string): Promise<AgeStatus>;
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

/** A signed-in user and, for a student, their age-gate standing (`null` for other roles). */
export interface Resolved {
  principal: Principal;
  status: AgeStatus | null;
}

/**
 * The one place a request becomes a principal (1.3), with a student's age standing (1.7). A
 * student erased since the session was read (an under-age answer in another tab) is signed out.
 */
export async function resolvePrincipal(
  deps: Pick<GuardDeps, 'getPrincipal' | 'learnerStatus'>,
  cookies: CookieReader,
): Promise<Resolved | null> {
  const principal = await deps.getPrincipal(cookies);
  if (!principal) return null;
  if (principal.role !== 'student') return { principal, status: null };
  try {
    return { principal, status: await deps.learnerStatus(principal.userId) };
  } catch (error) {
    if (error instanceof RepositoryError && error.kind === 'not_found') return null;
    throw error;
  }
}

/**
 * Whether a standing meets a clearance; `null` (not a student) always does. `under_age` (fix
 * round 1: a blocked erase) fails every clearance, including `none` (the age gate page itself),
 * so a live session from before the block can't be used to re-answer or reach anything.
 */
export function cleared(status: AgeStatus | null, clearance: Clearance): boolean {
  if (status === 'under_age') return false;
  if (status === null || clearance === 'none') return true;
  if (status === 'age_needed') return false;
  return clearance === 'age' || status === 'clear';
}

/** The guards over lazily resolved dependencies (env and database are read on first use). */
export function createGuard(guardDeps: () => GuardDeps, pageDeps: () => PageDeps) {
  /**
   * Signed-in users with one of `roles` only. In order: the route policy must agree (else 403),
   * an unsafe method must be same-origin (403), no session is 401, a wrong role is 403, a failed
   * lookup is 500 (never anonymous, never allowed), and a student short of the route's clearance
   * is 403 (1.7). Then the handler runs.
   */
  function withRole(
    roles: readonly Role[],
    handler: (req: NextRequest, ctx: RoleContext) => Response | Promise<Response>,
  ): Guarded<RouteHandler> {
    const allowed = [...roles];
    const route: RouteHandler = async (req, ctx) => {
      const rule = ruleFor(req.method, req.nextUrl.pathname);
      if (rule === null || !sameAccess(rule.access, allowed)) {
        return apiError('forbidden', 'This route is not open to you.', 403);
      }
      let deps: GuardDeps;
      let resolved: Resolved | null;
      try {
        deps = guardDeps();
        if (UNSAFE.has(req.method) && !sameOrigin(req, deps.allowedOrigin)) {
          return apiError('forbidden', 'Cross-site request refused.', 403);
        }
        resolved = await resolvePrincipal(deps, req.cookies);
      } catch {
        return apiError('provider_error', 'Could not check your sign-in. Try again.', 500);
      }
      if (!resolved) return apiError('unauthorized', 'Sign in first.', 401);
      const { principal, status } = resolved;
      if (!allowed.includes(principal.role)) {
        return apiError('forbidden', 'This route is not open to you.', 403);
      }
      if (!cleared(status, rule.clearance)) {
        return apiError(
          'forbidden',
          status === 'age_needed'
            ? 'Answer the welcome questions first.'
            : 'This needs a parent or guardian to agree first.',
          403,
        );
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
   * a redirect to sign-in when anonymous, not-found for a wrong role, or a redirect to the age gate
   * for a student short of `clearance` (default `age`; the gate page itself uses `none`).
   */
  async function requireRole(
    roles: readonly Role[],
    options: { clearance?: Clearance } = {},
  ): Promise<Principal> {
    const page = pageDeps();
    const resolved = await resolvePrincipal(guardDeps(), await page.cookies());
    if (!resolved) return page.redirect(SIGN_IN);
    if (!roles.includes(resolved.principal.role)) return page.notFound();
    if (!cleared(resolved.status, options.clearance ?? 'age')) return page.redirect(AGE_GATE_PATH);
    return resolved.principal;
  }

  return { withRole, publicRoute, providerRoute, requireRole };
}

export type Guard = ReturnType<typeof createGuard>;

// Auth.js configuration (task 1.3) as a pure factory: tests inject the identity store, env, the
// provider's fetch and the log sink. Google only (the email magic link is 1.4), database sessions.
import type { IdentityStore, Role } from '@edmate/db';
import { customFetch, type NextAuthConfig, type Session } from 'next-auth';
import Google, { type GoogleProfile } from 'next-auth/providers/google';
import { toAuthAdapter, type EdmateAdapterUser } from './adapter';
import type { AuthEnv } from './env';
import type { CookieReader, Principal } from './guard';

// The browser-visible session (`/api/auth/session`, and `auth()` if it is ever used) carries only
// the user's id and role.
declare module 'next-auth' {
  interface Session {
    user: { id: string; role: Role };
  }
}

export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_S = 24 * 60 * 60;

export interface AuthConfigDeps {
  identity: IdentityStore;
  env: AuthEnv;
  /** Replaces fetch for Google's discovery, token and key endpoints (tests). */
  providerFetch?: typeof fetch;
  /** Where Auth.js errors go, as name and code only (default: console.error). */
  log?: (line: string) => void;
  /**
   * The request being handled (NextAuth's per-request config). The signIn callback reads its
   * session cookie; without one, sign-in is refused (fail closed).
   */
  request?: { cookies: CookieReader };
}

/**
 * The session cookie's name: `__Host-` prefixed iff the app is served over https, which makes the
 * browser require Secure, Path=/ and no Domain (so no subdomain can set or read it).
 */
export function sessionCookieName(secure: boolean): string {
  return `${secure ? '__Host-' : ''}authjs.session-token`;
}

/** Session tokens Auth.js issues are UUIDs; anything far outside that is not looked up. */
const TOKEN = /^[A-Za-z0-9_-]{16,512}$/;

/** Reads the principal for a session cookie from the identity store (role read fresh each time). */
export function principalFromIdentity(identity: IdentityStore, cookieName: string) {
  return async (cookies: CookieReader): Promise<Principal | null> => {
    const token = cookies.get(cookieName)?.value;
    if (!token || !TOKEN.test(token)) return null;
    const found = await identity.getSessionAndUser(token);
    return found ? { userId: found.user.id, role: found.user.role } : null;
  };
}

/** The error's name and Auth.js `type`, never its message or cause (they can hold emails). */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return 'non-error';
  const type = (error as { type?: unknown }).type;
  return typeof type === 'string' && type !== error.name ? `${error.name} (${type})` : error.name;
}

export function createAuthConfig(deps: AuthConfigDeps): NextAuthConfig {
  const { env, identity } = deps;
  const log = deps.log ?? ((line: string) => console.error(line));
  const secure = env.secureCookies;
  const currentPrincipal = principalFromIdentity(identity, sessionCookieName(secure));
  return {
    secret: env.secret,
    trustHost: env.trustHost,
    basePath: '/api/auth',
    debug: false,
    adapter: toAuthAdapter(identity),
    session: {
      strategy: 'database',
      maxAge: SESSION_MAX_AGE_S,
      updateAge: SESSION_UPDATE_AGE_S,
    },
    // Follows AUTH_URL, not NODE_ENV: compose runs NODE_ENV=production over http.
    useSecureCookies: secure,
    cookies: {
      sessionToken: {
        name: sessionCookieName(secure),
        // Lax, not Strict: the OAuth callback is a cross-site top-level redirect.
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure },
      },
    },
    providers: [
      Google({
        clientId: env.googleId,
        clientSecret: env.googleSecret,
        allowDangerousEmailAccountLinking: false,
        // Auth.js defaults to PKCE only; state and nonce add CSRF and replay protection.
        checks: ['pkce', 'state', 'nonce'],
        // Only these fields reach createUser (no photo). Auth.js itself passes emailVerified: null
        // for OAuth users; the signIn callback below is what requires Google's email_verified.
        profile(p: GoogleProfile) {
          return { id: p.sub, email: p.email, name: p.name ?? '' };
        },
        ...(deps.providerFetch ? { [customFetch]: deps.providerFetch } : {}),
      }),
    ],
    callbacks: {
      // Google must vouch for the address; nothing else signs in yet. While a session is live,
      // only that user's own Google account may sign in: Auth.js would otherwise link a new
      // Google account to the signed-in user (a sibling on a shared device opening A's account).
      async signIn({ account, profile }) {
        if (account?.provider !== 'google') return false;
        const p = profile as Partial<GoogleProfile> | undefined;
        const verified =
          p?.email_verified === true && typeof p.email === 'string' && p.email.length > 0;
        if (!verified || !deps.request) return false;
        const current = await currentPrincipal(deps.request.cookies);
        if (!current) return true;
        const owner = await identity.getUserByAccount(account.provider, account.providerAccountId);
        return owner?.id === current.userId;
      },
      // `/api/auth/session` is readable by the browser: id and role only, no email or name.
      session({ session, user }): Session {
        const u = user as EdmateAdapterUser;
        return { user: { id: u.id, role: u.role }, expires: session.expires };
      },
    },
    logger: {
      error(error) {
        log(`[auth] error ${describe(error)}`);
      },
      warn(code) {
        log(`[auth] warn ${code}`);
      },
      debug() {},
    },
  };
}

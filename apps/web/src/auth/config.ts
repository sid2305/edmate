// Auth.js configuration (tasks 1.3, 1.4) as a pure factory: tests inject the identity store, env,
// the provider's fetch, the mail sender, the sign-in limiter and the log sink. Google and/or the
// email magic link, database sessions.
import type { IdentityStore, Role } from '@edmate/db';
import { customFetch, type NextAuthConfig, type Session } from 'next-auth';
import Google, { type GoogleProfile } from 'next-auth/providers/google';
import { toAuthAdapter, type EdmateAdapterUser } from './adapter';
import { ageBlockCookieName } from './age';
import { describeError } from './describe-error';
import { EMAIL_PROVIDER_ID, emailProvider } from './email';
import type { AuthEnv } from './env';
import type { CookieReader, Principal } from './guard';
import type { MailSender } from './mail';
import type { HeaderReader, SignInLimiter } from './rate-limit';

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
  request?: { cookies: CookieReader; headers: HeaderReader };
  /** Email magic link: how links are mailed and how requests are limited (needed iff env.email). */
  emailSignIn?: { mail: MailSender; limiter: SignInLimiter };
}

/** Where an over-limit link request goes: the same for both limits and for every address. */
export const RATE_LIMITED_PATH = '/api/auth/error?error=RateLimited';

/**
 * Where Auth.js may send the browser: a same-origin target on AUTH_URL, else AUTH_URL's origin.
 * It compares with `appUrl`, never Auth.js's `baseUrl`, which can follow a forwarded host. The
 * check is on the parsed result, so `//host`, `/\host`, `javascript:` and tab or newline tricks
 * that the URL parser folds into another origin all land on the app origin.
 */
export function safeRedirect(url: string, appUrl: URL): string {
  const origin = appUrl.origin;
  try {
    const target = new URL(url, origin);
    return target.origin === origin ? target.toString() : origin;
  } catch {
    return origin;
  }
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
    providers: providers(deps),
    callbacks: {
      // Email link requests are rate-limited here, before any token or mail exists; Auth.js passes
      // a stand-in user for an unknown address, so nothing below branches on whether one exists.
      // Google must vouch for the address. While a session is live, only that user's own Google
      // account may sign in: Auth.js would otherwise link a new Google account to the signed-in
      // user (a sibling on a shared device opening A's account).
      async signIn({ account, profile, email }) {
        // A browser that gave an under-age answer is refused for 24 hours (1.7, age.ts).
        if (deps.request?.cookies.get(ageBlockCookieName(secure))) return false;
        if (account?.provider === EMAIL_PROVIDER_ID && account.type === 'email') {
          // The link callback: Auth.js has already used up the single-use token.
          if (email?.verificationRequest !== true) return true;
          // A server action has no request (and so no IP): refused, fail closed.
          if (!deps.request || !deps.emailSignIn) return false;
          const allowed = await deps.emailSignIn.limiter.allow({
            email: account.providerAccountId,
            headers: deps.request.headers,
          });
          return allowed ? true : RATE_LIMITED_PATH;
        }
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
      redirect({ url }) {
        return safeRedirect(url, env.url);
      },
      // `/api/auth/session` is readable by the browser: id and role only, no email or name.
      session({ session, user }): Session {
        const u = user as EdmateAdapterUser;
        return { user: { id: u.id, role: u.role }, expires: session.expires };
      },
    },
    logger: {
      error(error) {
        log(`[auth] error ${describeError(error)}`);
      },
      warn(code) {
        log(`[auth] warn ${code}`);
      },
      debug() {},
    },
  };
}

/** Only the configured providers: Google, the email magic link, or both. */
function providers(deps: AuthConfigDeps): NextAuthConfig['providers'] {
  const { env } = deps;
  const list: NextAuthConfig['providers'] = [];
  if (env.google) {
    list.push(
      Google({
        clientId: env.google.id,
        clientSecret: env.google.secret,
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
    );
  }
  if (env.email) {
    if (!deps.emailSignIn) throw new Error('email sign-in needs a mail sender and a limiter');
    list.push(
      emailProvider({
        origin: env.url,
        from: env.email.from,
        mail: deps.emailSignIn.mail,
        ...(deps.log ? { log: deps.log } : {}),
      }),
    );
  }
  return list;
}

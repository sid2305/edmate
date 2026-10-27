// The app's one door for sign-in (tasks 1.3, 1.4). Nothing is read at import: env, the database
// pool, and (with email sign-in) the Redis client and SMTP transport are created on the first auth
// call, so `/api/health` and `next build` work without AUTH_* set.
// Only this folder imports next-auth (lint rule in @edmate/config/eslint/app).
import { resolve as resolvePath } from 'node:path';
import { openDatabase, type IdentityStore, type Repositories } from '@edmate/db';
import type { Redis } from 'ioredis';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import NextAuth, { type NextAuthResult } from 'next-auth';
import type { NextRequest } from 'next/server';
import {
  ageGateView as viewAgeGate,
  loadAgeContent,
  submitAgeAnswer as answerAge,
  type AgeAnswerResult,
  type AgeContent,
  type AgeGateDeps,
  type AgeGateView,
  type AgeNotice,
} from './age';
import {
  createAuthConfig,
  principalFromIdentity,
  sessionCookieName,
  type AuthConfigDeps,
} from './config';
import {
  buildEmailCallbackUrl,
  confirmView,
  emailCallbackGate,
  linkBindingCookie as makeLinkBindingCookie,
  linkBindingCookieName,
  linkConfirmedCookie,
  linkConfirmedCookieName,
  parseConfirmParams,
  shouldBindLink,
  type ConfirmView,
  type LinkBindingCookie,
} from './confirm';
import { describeError } from './describe-error';
import { EMAIL_PROVIDER_ID } from './email';
import { readAuthEnv, type AuthEnv } from './env';
import { createGuard, resolvePrincipal, type GuardDeps, type Principal } from './guard';
import { readyCounters } from './redis-ready';

interface Runtime {
  env: AuthEnv;
  identity: IdentityStore;
  repos: Repositories;
  nextAuth: NextAuthResult;
  guard: GuardDeps;
}

/**
 * The dev-mode ioredis singleton (task 1.4d): one client reused across repeated module reloads
 * (Next's dev server hot-reloads this module on every edit, which would otherwise open a fresh
 * connection per edit). Cached on `globalThis` because `runtime` below is a module-scoped
 * variable and does not survive a reload; `globalThis` does. Never reused across a real process
 * restart: a fresh process starts with no entry here. Unused in production, where `runtime` is
 * cached once per process and no reload ever happens.
 */
declare global {
  var __edmateAuthRedis: Redis | undefined;
}

let runtime: Runtime | undefined;
let ageContent: AgeContent | undefined;
let emailDeps: Promise<AuthConfigDeps['emailSignIn']> | undefined;

/**
 * Locale packs and privacy notices for the age gate (1.7), loaded on first use from
 * EDMATE_CONTENT_DIR, else the repo's `content/` (Next runs from apps/web). If they can't be
 * loaded, every age check fails (500) and learners stay blocked; other roles are unaffected.
 */
function getAgeContent(): AgeContent {
  const dir = process.env.EDMATE_CONTENT_DIR?.trim() || resolvePath(process.cwd(), '../../content');
  const production = process.env.NODE_ENV === 'production';
  // Same S3_ALLOW_HTTP precedent (apps/web/src/storage/presign.ts, docker/compose.yaml): an exact
  // 'true' string lets the local try-it stack run with NODE_ENV=production and an unsigned notice
  // (1.7a, lead amendment); any other value, or unset, refuses an unsigned notice in production.
  const allowUnsigned = process.env.AGE_NOTICE_ALLOW_UNSIGNED === 'true';
  ageContent ??= loadAgeContent(dir, undefined, production, allowUnsigned);
  return ageContent;
}

/**
 * The email magic link's mail sender and rate limiter, built once (memoized) on first use.
 * `ioredis`, `nodemailer` and the rate-limit module are imported here, dynamically, not at the
 * top of this file: every other consumer of this module (about 30 route files that only want
 * `withRole`/`Principal`) would otherwise pull in both packages at module-load time whether or
 * not email sign-in is even configured. The Redis client fails fast in an outage (no offline
 * queue, one retry), and each take first waits, bounded, for the connection to be ready, so the
 * first request after a cold start isn't refused just for being early. A throw during the build
 * (a bad dynamic import, or a synchronous throw from `new Redis(...)`/`createSignInLimiter`)
 * resets the memo to `undefined` so the next request retries, instead of every later request
 * getting the same cached rejection until the process restarts.
 */
function emailSignIn(env: AuthEnv): Promise<AuthConfigDeps['emailSignIn']> {
  if (!env.email) return Promise.resolve(undefined);
  const config = env.email;
  emailDeps ??= (async () => {
    const [{ Redis }, { smtpMailSender }, { createSignInLimiter, redisSignInCounters }] =
      await Promise.all([import('ioredis'), import('./mail'), import('./rate-limit')]);
    const dev = process.env.NODE_ENV !== 'production';
    const existing = dev && globalThis.__edmateAuthRedis;
    let redis = existing;
    if (!redis) {
      redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
      // Attached only once, here, when the client is created: a dev-mode reload reuses the
      // `existing` singleton above and skips this, so a listener added on every hot reload
      // doesn't pile up (MaxListeners warning after ~10 edits). ioredis errors can quote the
      // host; log the name only. A take during an outage rejects.
      redis.on('error', (error: unknown) => console.error(`[auth] redis ${describeError(error)}`));
      if (dev) globalThis.__edmateAuthRedis = redis;
    }
    return {
      mail: smtpMailSender({
        server: config.server,
        from: config.from,
        requireTls: env.secureCookies,
      }),
      limiter: createSignInLimiter({
        secret: env.secret,
        trustHost: env.trustHost,
        counters: readyCounters(redis, redisSignInCounters(redis)),
      }),
    };
  })().catch((error: unknown) => {
    // Reset to `undefined` (not left as a settled rejected promise) so the next request's
    // `emailSignIn` call retries the build from scratch, instead of every request after the
    // first failure getting the same cached rejection until the process restarts.
    emailDeps = undefined;
    throw error;
  });
  return emailDeps;
}

function getRuntime(): Runtime {
  if (runtime) return runtime;
  const env = readAuthEnv(process.env);
  const { identity, repos } = openDatabase(undefined, {
    identity: {
      agePolicy: (market) => getAgeContent().agePolicy(market),
      // The store takes only the version the server shows for the market.
      noticeVersion: (market) => getAgeContent().notice(market).version,
    },
  });
  runtime = {
    env,
    identity,
    repos,
    // Per-request config: the signIn callback needs the request's cookies and headers, and (on
    // the first call only) awaits emailSignIn's dynamic imports and Redis client.
    nextAuth: NextAuth(async (req) => {
      const email = await emailSignIn(env);
      return createAuthConfig({
        identity,
        env,
        ...(email ? { emailSignIn: email } : {}),
        ...(req ? { request: req } : {}),
      });
    }),
    guard: {
      getPrincipal: principalFromIdentity(identity, sessionCookieName(env.secureCookies)),
      learnerStatus: (userId) => identity.learnerStatus(userId),
      allowedOrigin: env.url.origin,
    },
  };
  return runtime;
}

/**
 * The scoped repositories and the identity store the guard uses (task 9.4: the chat routes), so
 * a turn's age check uses the same market age policy as sign-in. Opened lazily, like the rest.
 */
export function serverDatabase(): { repos: Repositories; identity: IdentityStore } {
  const { repos, identity } = getRuntime();
  return { repos, identity };
}

/** Auth.js's route handlers for `app/api/auth/[...nextauth]/route.ts`. */
export const handlers = {
  GET: (req: NextRequest) => getRuntime().nextAuth.handlers.GET(req),
  POST: (req: NextRequest) => getRuntime().nextAuth.handlers.POST(req),
};

/**
 * Server actions: start Google sign-in, or sign out (Auth.js's own redirects). Email sign-in is
 * refused here: it goes only through the rate-limited `/api/auth/signin/email` route.
 */
export const signIn: NextAuthResult['signIn'] = (...args) => {
  if (args[0] === EMAIL_PROVIDER_ID) {
    return Promise.reject(new Error('email sign-in goes through /api/auth/signin/email only'));
  }
  return getRuntime().nextAuth.signIn(...args);
};
export const signOut: NextAuthResult['signOut'] = (...args) =>
  getRuntime().nextAuth.signOut(...args);

export const { withRole, publicRoute, providerRoute, requireRole } = createGuard(
  () => getRuntime().guard,
  () => ({ cookies, redirect, notFound }),
);

export { HOME_PATH, SIGN_IN_PATH, TEACHER_PATH } from './guard';

/**
 * A soft, non-throwing read of who (if anyone) is signed in: the `/` dispatcher's (Phase C) "who,
 * if anyone" check. Any lookup failure -- a thrown error from `getRuntime()` or the session
 * lookup, not just the `not_found` case `resolvePrincipal` already handles -- reads as signed
 * out, the same fail-safe-to-signed-out direction as `resolvePrincipal`. Not security-enforcing
 * by itself: `/home` and `/teacher` still call `requireRole`. A lookup failure is logged (name
 * and Auth.js `type` only, matching the rest of this module: never the message, which can hold
 * an email) before it reads as signed out, so a broken lookup isn't silent.
 */
export async function currentPrincipal(): Promise<Principal | null> {
  try {
    const resolved = await resolvePrincipal(getRuntime().guard, await cookies());
    return resolved?.principal ?? null;
  } catch (error) {
    console.error(`[auth] currentPrincipal ${describeError(error)}`);
    return null;
  }
}

/** The age gate's dependencies over the request's cookies (server action or component). */
async function ageGateDeps(): Promise<AgeGateDeps> {
  const rt = getRuntime();
  const jar = await cookies();
  return {
    cookies: {
      get: (name) => jar.get(name),
      set: (name, value, options) => {
        jar.set(name, value, options);
      },
    },
    resolve: (c) => resolvePrincipal(rt.guard, c),
    identity: rt.identity,
    content: getAgeContent(),
    secureCookies: rt.env.secureCookies,
    sessionCookie: sessionCookieName(rt.env.secureCookies),
  };
}

/** The age gate's server action (app/welcome/age/actions.ts): see age.ts. */
export async function submitAgeAnswer(input: unknown): Promise<AgeAnswerResult> {
  return answerAge(input, await ageGateDeps());
}

/** What the age gate page shows. */
export async function ageGateView(): Promise<AgeGateView> {
  return viewAgeGate(await ageGateDeps());
}

/** The privacy notice the server shows for a market (its version is the one recorded). */
export function ageNotice(market: string): AgeNotice {
  return getAgeContent().notice(market);
}

/**
 * What the magic link's confirm page (`/sign-in/confirm`, task 1.4b) does with its query: refuse,
 * forward to Auth.js's callback (this browser holds the binding cookie for the link's address), or
 * ask for one click.
 */
export async function confirmSignInView(params: unknown): Promise<ConfirmView> {
  const { env } = getRuntime();
  const jar = await cookies();
  return confirmView(params, {
    secret: env.secret,
    origin: env.url,
    cookie: jar.get(linkBindingCookieName(env.secureCookies))?.value,
  });
}

/**
 * The confirm page's click (a Server Action, Origin-checked by Next): sets the short-lived
 * "confirmed" cookie for this token and address, which lets the callback through, and returns the
 * real callback URL; null (and no cookie) for bad fields.
 */
export async function confirmEmailSignIn(fields: unknown): Promise<string | null> {
  const { env } = getRuntime();
  const params = parseConfirmParams(fields);
  const cookie = params && linkConfirmedCookie(env.secret, env.secureCookies, params);
  if (!params || !cookie) return null;
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
  return buildEmailCallbackUrl(env.url, params);
}

/** The binding cookie the `/api/auth/signin/email` POST sets for the posted address, or null. */
export function linkBindingCookie(email: unknown): LinkBindingCookie | null {
  const { env } = getRuntime();
  return makeLinkBindingCookie(env.secret, env.secureCookies, email);
}

/** Whether that POST may set it: a same-origin request that Auth.js answered "check your email". */
export function signInBindsLink(req: Request, res: Response): boolean {
  return shouldBindLink(req.headers, res, getRuntime().env.url);
}

/**
 * The gate on Auth.js's email callback GET (`app/api/auth/callback/email`): null lets it through
 * (binding or confirmed cookie for this link), else the confirm page URL to redirect to.
 */
export function emailCallbackRedirect(req: NextRequest): string | null {
  const { env } = getRuntime();
  return emailCallbackGate(req.nextUrl.searchParams, {
    secret: env.secret,
    origin: env.url,
    binding: req.cookies.get(linkBindingCookieName(env.secureCookies))?.value,
    confirmed: req.cookies.get(linkConfirmedCookieName(env.secureCookies))?.value,
  });
}

export type { AgeAnswerResult, AgeGateView, AgeNotice } from './age';
export type { ConfirmView, LinkBindingCookie } from './confirm';
export type { Principal, RoleContext } from './guard';

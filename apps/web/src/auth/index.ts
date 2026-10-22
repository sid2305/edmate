// The app's one door for sign-in (tasks 1.3, 1.4). Nothing is read at import: env, the database
// pool, and (with email sign-in) the Redis client and SMTP transport are created on the first auth
// call, so `/api/health` and `next build` work without AUTH_* set.
// Only this folder imports next-auth (lint rule in @edmate/config/eslint/app).
import { resolve as resolvePath } from 'node:path';
import { openDatabase, type IdentityStore, type Repositories } from '@edmate/db';
import { Redis } from 'ioredis';
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
import { describeError } from './describe-error';
import { EMAIL_PROVIDER_ID } from './email';
import { readAuthEnv, type AuthEnv } from './env';
import { createGuard, resolvePrincipal, type GuardDeps, type Principal } from './guard';
import { smtpMailSender } from './mail';
import { createSignInLimiter, redisSignInCounters } from './rate-limit';
import { readyCounters } from './redis-ready';

interface Runtime {
  env: AuthEnv;
  identity: IdentityStore;
  repos: Repositories;
  nextAuth: NextAuthResult;
  guard: GuardDeps;
}

let runtime: Runtime | undefined;
let ageContent: AgeContent | undefined;

/**
 * Locale packs and privacy notices for the age gate (1.7), loaded on first use from
 * EDMATE_CONTENT_DIR, else the repo's `content/` (Next runs from apps/web). If they can't be
 * loaded, every age check fails (500) and learners stay blocked; other roles are unaffected.
 */
function getAgeContent(): AgeContent {
  const dir = process.env.EDMATE_CONTENT_DIR?.trim() || resolvePath(process.cwd(), '../../content');
  ageContent ??= loadAgeContent(dir);
  return ageContent;
}

/**
 * The email magic link's mail sender and rate limiter. The Redis client fails fast in an outage
 * (no offline queue, one retry), and each take first waits, bounded, for the connection to be
 * ready, so the first request after a cold start isn't refused just for being early.
 */
function emailSignIn(env: AuthEnv): AuthConfigDeps['emailSignIn'] {
  if (!env.email) return undefined;
  const redis = new Redis(env.email.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  // ioredis errors can quote the host; log the name only. A take during an outage rejects.
  redis.on('error', (error: unknown) => console.error(`[auth] redis ${describeError(error)}`));
  return {
    mail: smtpMailSender({
      server: env.email.server,
      from: env.email.from,
      requireTls: env.secureCookies,
    }),
    limiter: createSignInLimiter({
      secret: env.secret,
      trustHost: env.trustHost,
      counters: readyCounters(redis, redisSignInCounters(redis)),
    }),
  };
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
  const email = emailSignIn(env);
  runtime = {
    env,
    identity,
    repos,
    // Per-request config: the signIn callback needs the request's cookies and headers.
    nextAuth: NextAuth((req) =>
      createAuthConfig({
        identity,
        env,
        ...(email ? { emailSignIn: email } : {}),
        ...(req ? { request: req } : {}),
      }),
    ),
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

export type { AgeAnswerResult, AgeGateView, AgeNotice } from './age';
export type { Principal, RoleContext } from './guard';

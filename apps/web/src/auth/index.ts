// The app's one door for sign-in (tasks 1.3, 1.4). Nothing is read at import: env, the database
// pool, and (with email sign-in) the Redis client and SMTP transport are created on the first auth
// call, so `/api/health` and `next build` work without AUTH_* set.
// Only this folder imports next-auth (lint rule in @edmate/config/eslint/app).
import { openDatabase, type IdentityStore } from '@edmate/db';
import { Redis } from 'ioredis';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import NextAuth, { type NextAuthResult } from 'next-auth';
import type { NextRequest } from 'next/server';
import { createAuthConfig, principalFromIdentity, sessionCookieName, type AuthConfigDeps } from './config';
import { describeError } from './describe-error';
import { EMAIL_PROVIDER_ID } from './email';
import { readAuthEnv, type AuthEnv } from './env';
import { createGuard, type GuardDeps } from './guard';
import { smtpMailSender } from './mail';
import { createSignInLimiter, redisSignInCounters } from './rate-limit';
import { readyCounters } from './redis-ready';

interface Runtime {
  env: AuthEnv;
  identity: IdentityStore;
  nextAuth: NextAuthResult;
  guard: GuardDeps;
}

let runtime: Runtime | undefined;

/**
 * The email magic link's mail sender and rate limiter. The Redis client fails fast in an outage
 * (no offline queue, one retry), and each take first waits, bounded, for the connection to be
 * ready, so the first request after a cold start isn't refused just for being early.
 */
function emailSignIn(env: AuthEnv): AuthConfigDeps['emailSignIn'] {
  if (!env.email) return undefined;
  const redis = new Redis(env.email.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
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
  const { identity } = openDatabase();
  const email = emailSignIn(env);
  runtime = {
    env,
    identity,
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
      allowedOrigin: env.url.origin,
    },
  };
  return runtime;
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

export type { Principal, RoleContext } from './guard';

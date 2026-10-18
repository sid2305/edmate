// The app's one door for sign-in (task 1.3). Nothing is read at import: env and the database pool
// are created on the first auth call, so `/api/health` and `next build` work without AUTH_* set.
// Only this folder imports next-auth (lint rule in @edmate/config/eslint/app).
import { openDatabase, type IdentityStore } from '@edmate/db';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import NextAuth, { type NextAuthResult } from 'next-auth';
import type { NextRequest } from 'next/server';
import { createAuthConfig, principalFromIdentity, sessionCookieName } from './config';
import { readAuthEnv, type AuthEnv } from './env';
import { createGuard, type GuardDeps } from './guard';

interface Runtime {
  env: AuthEnv;
  identity: IdentityStore;
  nextAuth: NextAuthResult;
  guard: GuardDeps;
}

let runtime: Runtime | undefined;

function getRuntime(): Runtime {
  if (runtime) return runtime;
  const env = readAuthEnv(process.env);
  const { identity } = openDatabase();
  runtime = {
    env,
    identity,
    // Per-request config: the signIn callback needs the request's session cookie.
    nextAuth: NextAuth((req) =>
      createAuthConfig({ identity, env, ...(req ? { request: req } : {}) }),
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

/** Server actions: start Google sign-in, or sign out (Auth.js's own redirects). */
export const signIn: NextAuthResult['signIn'] = (...args) => getRuntime().nextAuth.signIn(...args);
export const signOut: NextAuthResult['signOut'] = (...args) =>
  getRuntime().nextAuth.signOut(...args);

export const { withRole, publicRoute, providerRoute, requireRole } = createGuard(
  () => getRuntime().guard,
  () => ({ cookies, redirect, notFound }),
);

export type { Principal, RoleContext } from './guard';

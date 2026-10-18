// Sign-in settings from env (task 1.3). Read lazily, on the first auth call, so `/api/health` and
// `next build` work without them. Messages name the variable, never its value.
import { z } from 'zod';

export interface AuthEnv {
  secret: string;
  /** The public origin of the app; it decides secure cookies and the allowed Origin. */
  url: URL;
  googleId: string;
  googleSecret: string;
  /** Trust the forwarded host (Caddy in front). */
  trustHost: boolean;
  /** True iff `AUTH_URL` is https: a `Secure` session cookie with the `__Host-` prefix. */
  secureCookies: boolean;
}

export type EnvSource = Record<string, string | undefined>;

/** A missing or invalid sign-in setting. Its message names the variable only. */
export class AuthConfigError extends Error {
  override readonly name = 'AuthConfigError';
}

const MIN_SECRET = 32;

const Url = z.url({ protocol: /^https?$/ });

function required(env: EnvSource, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new AuthConfigError(`${name} is not set`);
  return value;
}

/** Parses the sign-in settings or throws an AuthConfigError naming the first bad variable. */
export function readAuthEnv(env: EnvSource): AuthEnv {
  const secret = required(env, 'AUTH_SECRET');
  if (secret.length < MIN_SECRET) {
    throw new AuthConfigError(`AUTH_SECRET must be at least ${MIN_SECRET} characters`);
  }
  const rawUrl = required(env, 'AUTH_URL');
  if (!Url.safeParse(rawUrl).success) {
    throw new AuthConfigError('AUTH_URL must be an http or https URL');
  }
  const url = new URL(rawUrl);
  const googleId = required(env, 'AUTH_GOOGLE_ID');
  const googleSecret = required(env, 'AUTH_GOOGLE_SECRET');
  const trust = env.AUTH_TRUST_HOST?.trim().toLowerCase();
  return {
    secret,
    url,
    googleId,
    googleSecret,
    trustHost: trust === 'true' || trust === '1',
    secureCookies: url.protocol === 'https:',
  };
}

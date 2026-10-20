// Sign-in settings from env (tasks 1.3, 1.4). Read lazily, on the first auth call, so `/api/health`
// and `next build` work without them. Messages name the variable, never its value (an SMTP URL
// holds a password).
import { z } from 'zod';

export interface AuthEnv {
  secret: string;
  /** The public origin of the app; it decides secure cookies, the allowed Origin and mailed links. */
  url: URL;
  /** Google sign-in, when both AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set. */
  google?: { id: string; secret: string };
  /**
   * Email magic-link sign-in, when both EMAIL_SERVER and EMAIL_FROM are set. `redisUrl` (for the
   * link rate limits) is required with it, so there are no limit-less links.
   */
  email?: { server: string; from: string; redisUrl: string };
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
const SmtpUrl = z.url({ protocol: /^smtps?$/ });
const RedisUrl = z.url({ protocol: /^rediss?$/ });

function value(env: EnvSource, name: string): string | undefined {
  const v = env[name];
  return v === undefined || v.trim() === '' ? undefined : v;
}

function required(env: EnvSource, name: string): string {
  const v = value(env, name);
  if (v === undefined) throw new AuthConfigError(`${name} is not set`);
  return v;
}

/** Both set → the pair; both empty → undefined; one alone → an error naming the pair. */
function pair(env: EnvSource, a: string, b: string): [string, string] | undefined {
  const x = value(env, a);
  const y = value(env, b);
  if (x === undefined && y === undefined) return undefined;
  if (x === undefined || y === undefined) {
    throw new AuthConfigError(`${a} and ${b} must be set together`);
  }
  return [x, y];
}

function readEmail(env: EnvSource): AuthEnv['email'] {
  const email = pair(env, 'EMAIL_SERVER', 'EMAIL_FROM');
  if (!email) return undefined;
  const [server, from] = email;
  if (!SmtpUrl.safeParse(server).success) {
    throw new AuthConfigError('EMAIL_SERVER must be an smtp or smtps URL');
  }
  const redisUrl = value(env, 'REDIS_URL');
  if (redisUrl === undefined) {
    throw new AuthConfigError('REDIS_URL is not set (email sign-in needs it for rate limits)');
  }
  if (!RedisUrl.safeParse(redisUrl).success) {
    throw new AuthConfigError('REDIS_URL must be a redis or rediss URL');
  }
  return { server, from, redisUrl };
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
  const google = pair(env, 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET');
  const email = readEmail(env);
  if (!google && !email) {
    throw new AuthConfigError(
      'no sign-in provider: set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, or EMAIL_SERVER and EMAIL_FROM',
    );
  }
  const trust = env.AUTH_TRUST_HOST?.trim().toLowerCase();
  return {
    secret,
    url,
    ...(google ? { google: { id: google[0], secret: google[1] } } : {}),
    ...(email ? { email } : {}),
    trustHost: trust === 'true' || trust === '1',
    secureCookies: url.protocol === 'https:',
  };
}

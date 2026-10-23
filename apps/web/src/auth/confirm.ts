// Task 1.4b: the magic link's confirm page, pure logic. Auth.js consumes the single-use token on
// the bare GET of its callback before any Edmate callback runs, so the mailed link points at
// `/sign-in/confirm` instead. That page forwards straight to the real callback only when this
// browser holds a binding cookie for the link's own address (set when it POSTed the sign-in
// request); otherwise it asks for one click. A scanner, a different browser, or a browser that asked
// for a link to some other address never signs in just by opening the link.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CALLBACK_PATH, LINK_MAX_AGE_S, MAX_EMAIL_LENGTH, normalizeEmail } from './email';

export const LINK_BINDING_COOKIE = 'edmate.link-bound';

/** Domain separation: this HMAC key (AUTH_SECRET) signs other things too. */
const BINDING_PREFIX = 'linkbound:';

/** Auth.js's token is `randomString(32)`: 64 lowercase hex characters. 32–128 tolerates a change. */
const TOKEN_RE = /^[0-9a-f]{32,128}$/;
const COOKIE_RE = /^[0-9a-f]{64}$/;
const MAX_CALLBACK_URL_LENGTH = 2048;

export function linkBindingCookieName(secure: boolean): string {
  return secure ? `__Host-${LINK_BINDING_COOKIE}` : LINK_BINDING_COOKIE;
}

function normalizedOrNull(email: unknown): string | null {
  try {
    return normalizeEmail(email);
  } catch {
    return null;
  }
}

/** `HMAC-SHA256(secret, "linkbound:" + normalizeEmail(email))` as hex, or null for a bad input. */
export function createLinkBindingCookieValue(secret: string, email: unknown): string | null {
  const normalized = normalizedOrNull(email);
  if (!secret || normalized === null) return null;
  return createHmac('sha256', secret).update(`${BINDING_PREFIX}${normalized}`).digest('hex');
}

/** True only for a well-formed cookie made with `secret` for this same (normalised) address. */
export function verifyLinkBindingCookieValue(secret: string, cookie: unknown, email: unknown): boolean {
  if (typeof cookie !== 'string' || !COOKIE_RE.test(cookie)) return false;
  const expected = createLinkBindingCookieValue(secret, email);
  if (expected === null) return false;
  return timingSafeEqual(Buffer.from(cookie, 'hex'), Buffer.from(expected, 'hex'));
}

export interface LinkBindingCookie {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; maxAge: number };
}

/** The cookie the sign-in POST sets for `email`, or null when the address is invalid. */
export function linkBindingCookie(secret: string, secure: boolean, email: unknown): LinkBindingCookie | null {
  const value = createLinkBindingCookieValue(secret, email);
  if (value === null) return null;
  return {
    name: linkBindingCookieName(secure),
    value,
    options: { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: LINK_MAX_AGE_S },
  };
}

const ConfirmParamsSchema = z.object({
  token: z.string().regex(TOKEN_RE),
  email: z
    .string()
    .max(MAX_EMAIL_LENGTH)
    .refine((e) => normalizedOrNull(e) !== null),
  callbackUrl: z.string().min(1).max(MAX_CALLBACK_URL_LENGTH),
});

export type ConfirmParams = z.infer<typeof ConfirmParamsSchema>;

/** The link's query (from `searchParams` or a form), or null. A repeated key (an array) is refused. */
export function parseConfirmParams(raw: unknown): ConfirmParams | null {
  const parsed = ConfirmParamsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { token, email, callbackUrl } = parsed.data;
  return { token, email, callbackUrl };
}

/**
 * Auth.js's real email callback on `origin` (AUTH_URL), built with URLSearchParams so each value
 * is encoded exactly once. `callbackUrl` is passed through: Auth.js's redirect callback checks it.
 */
export function buildEmailCallbackUrl(origin: URL, raw: unknown): string | null {
  const params = parseConfirmParams(raw);
  return params ? callbackUrlFor(origin, params) : null;
}

function callbackUrlFor(origin: URL, params: ConfirmParams): string {
  const url = new URL(CALLBACK_PATH, origin.origin);
  url.search = new URLSearchParams({
    token: params.token,
    email: params.email,
    callbackUrl: params.callbackUrl,
  }).toString();
  return url.toString();
}

export type ConfirmView =
  | { kind: 'invalid' }
  | { kind: 'auto'; url: string }
  | ({ kind: 'manual' } & ConfirmParams);

export interface ConfirmViewDeps {
  secret: string;
  origin: URL;
  /** The binding cookie's value as this request carries it, if any. */
  cookie: unknown;
}

/** What the confirm page does: refuse, forward (cookie for this address), or ask for a click. */
export function confirmView(raw: unknown, deps: ConfirmViewDeps): ConfirmView {
  const params = parseConfirmParams(raw);
  if (!params) return { kind: 'invalid' };
  if (verifyLinkBindingCookieValue(deps.secret, deps.cookie, params.email)) {
    return { kind: 'auto', url: callbackUrlFor(deps.origin, params) };
  }
  return { kind: 'manual', ...params };
}

// Task 1.4b: the magic link's confirm page, pure logic. Auth.js consumes the single-use token on
// the bare GET of its callback before any Edmate callback runs, so the mailed link points at
// `/sign-in/confirm` instead. That page forwards straight to the real callback only when this
// browser holds a binding cookie for the link's own address (set when it POSTed the sign-in
// request); otherwise it asks for one click. A scanner, a different browser, or a browser that asked
// for a link to some other address never signs in just by opening the link. The callback itself is
// gated the same way (`emailCallbackGate`), so skipping the confirm page doesn't skip the check.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  CALLBACK_PATH,
  CONFIRM_PATH,
  LINK_MAX_AGE_S,
  MAX_EMAIL_LENGTH,
  normalizeEmail,
} from './email';

export const LINK_BINDING_COOKIE = 'edmate.link-bound';
export const LINK_CONFIRMED_COOKIE = 'edmate.link-confirmed';

/** How long the confirm click's cookie lets this browser into Auth.js's callback (≤ 2 minutes). */
export const CONFIRMED_MAX_AGE_S = 120;

/** Domain separation: this HMAC key (AUTH_SECRET) signs other things too. */
const BINDING_PREFIX = 'linkbound:';
const CONFIRMED_PREFIX = 'linkconfirmed:';

/** Auth.js's token is `randomString(32)`: 64 lowercase hex characters. 32–128 tolerates a change. */
const TOKEN_RE = /^[0-9a-f]{32,128}$/;
/** A signed cookie value: `<issued-at, unix seconds>.<HMAC-SHA256 hex>`. */
const SIGNED_RE = /^(\d{1,12})\.([0-9a-f]{64})$/;
/** Servers' clocks may differ a little: a value issued up to this far "in the future" still counts. */
const CLOCK_SKEW_S = 30;
const MAX_CALLBACK_URL_LENGTH = 2048;

/** Auth.js's answer to a sign-in POST that sent the mail (`basePath` is `/api/auth`). */
export const VERIFY_REQUEST_PATH = '/api/auth/verify-request';

export function linkBindingCookieName(secure: boolean): string {
  return secure ? `__Host-${LINK_BINDING_COOKIE}` : LINK_BINDING_COOKIE;
}

export function linkConfirmedCookieName(secure: boolean): string {
  return secure ? `__Host-${LINK_CONFIRMED_COOKIE}` : LINK_CONFIRMED_COOKIE;
}

function normalizedOrNull(email: unknown): string | null {
  try {
    return normalizeEmail(email);
  } catch {
    return null;
  }
}

function hmacHex(secret: string, prefix: string, issuedAt: number, payload: string): string {
  return createHmac('sha256', secret).update(`${prefix}${issuedAt}:${payload}`).digest('hex');
}

function signValue(secret: string, prefix: string, payload: string, now: number): string {
  const issuedAt = Math.floor(now / 1000);
  return `${issuedAt}.${hmacHex(secret, prefix, issuedAt, payload)}`;
}

/** A well-formed value, signed with `secret` for `payload`, issued no longer than `maxAgeS` ago. */
function verifySigned(
  secret: string,
  prefix: string,
  payload: string,
  cookie: unknown,
  maxAgeS: number,
  now: number,
): boolean {
  if (!secret || typeof cookie !== 'string') return false;
  const match = SIGNED_RE.exec(cookie);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  const age = Math.floor(now / 1000) - issuedAt;
  if (age > maxAgeS || age < -CLOCK_SKEW_S) return false;
  const expected = hmacHex(secret, prefix, issuedAt, payload);
  return timingSafeEqual(Buffer.from(match[2]!, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * `<issuedAt>.HMAC-SHA256(secret, "linkbound:" + issuedAt + ":" + normalizeEmail(email))`, or null
 * for a bad input. The issue time is signed, so a replayed value dies with the link (15 minutes).
 */
export function createLinkBindingCookieValue(
  secret: string,
  email: unknown,
  now: number = Date.now(),
): string | null {
  const normalized = normalizedOrNull(email);
  if (!secret || normalized === null) return null;
  return signValue(secret, BINDING_PREFIX, normalized, now);
}

/** True only for an unexpired cookie made with `secret` for this same (normalised) address. */
export function verifyLinkBindingCookieValue(
  secret: string,
  cookie: unknown,
  email: unknown,
  now: number = Date.now(),
): boolean {
  const normalized = normalizedOrNull(email);
  if (normalized === null) return false;
  return verifySigned(secret, BINDING_PREFIX, normalized, cookie, LINK_MAX_AGE_S, now);
}

/** The confirm click's payload: the token (hex, so no `:`) and the normalised address. */
function confirmedPayload(token: unknown, email: unknown): string | null {
  const normalized = normalizedOrNull(email);
  if (typeof token !== 'string' || !TOKEN_RE.test(token) || normalized === null) return null;
  return `${token}:${normalized}`;
}

/** `<issuedAt>.HMAC(secret, "linkconfirmed:" + issuedAt + ":" + token + ":" + email)`, or null. */
export function createLinkConfirmedCookieValue(
  secret: string,
  token: unknown,
  email: unknown,
  now: number = Date.now(),
): string | null {
  const payload = confirmedPayload(token, email);
  if (!secret || payload === null) return null;
  return signValue(secret, CONFIRMED_PREFIX, payload, now);
}

/** True only for a confirm-click cookie for this token and address, at most 2 minutes old. */
export function verifyLinkConfirmedCookieValue(
  secret: string,
  cookie: unknown,
  token: unknown,
  email: unknown,
  now: number = Date.now(),
): boolean {
  const payload = confirmedPayload(token, email);
  if (payload === null) return false;
  return verifySigned(secret, CONFIRMED_PREFIX, payload, cookie, CONFIRMED_MAX_AGE_S, now);
}

export interface LinkBindingCookie {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; maxAge: number };
}

function cookieOptions(secure: boolean, maxAge: number): LinkBindingCookie['options'] {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge };
}

/** The cookie the sign-in POST sets for `email`, or null when the address is invalid. */
export function linkBindingCookie(
  secret: string,
  secure: boolean,
  email: unknown,
  now: number = Date.now(),
): LinkBindingCookie | null {
  const value = createLinkBindingCookieValue(secret, email, now);
  if (value === null) return null;
  return { name: linkBindingCookieName(secure), value, options: cookieOptions(secure, LINK_MAX_AGE_S) };
}

/** The cookie the confirm click (a Server Action) sets for this link, or null for bad fields. */
export function linkConfirmedCookie(
  secret: string,
  secure: boolean,
  params: { token: unknown; email: unknown },
  now: number = Date.now(),
): LinkBindingCookie | null {
  const value = createLinkConfirmedCookieValue(secret, params.token, params.email, now);
  if (value === null) return null;
  return {
    name: linkConfirmedCookieName(secure),
    value,
    options: cookieOptions(secure, CONFIRMED_MAX_AGE_S),
  };
}

/**
 * Whether a request came from Edmate's own pages: its Origin is AUTH_URL's origin or, with no
 * Origin header, the browser says `Sec-Fetch-Site: same-origin`. A missing signal counts as no.
 */
export function isSameOriginRequest(headers: Headers, origin: URL): boolean {
  const sent = headers.get('origin');
  if (sent !== null) return sent === origin.origin;
  return headers.get('sec-fetch-site') === 'same-origin';
}

/** True only for Auth.js's "check your email" redirect, never an error or CSRF redirect. */
export function isVerifyRequestRedirect(res: Response): boolean {
  if (res.status < 300 || res.status > 399) return false;
  const location = res.headers.get('location');
  if (!location) return false;
  try {
    return new URL(location, 'http://base.invalid').pathname === VERIFY_REQUEST_PATH;
  } catch {
    return false;
  }
}

/**
 * Whether the sign-in POST may set the binding cookie: same-origin AND Auth.js sent the mail. A
 * cross-site form (no valid CSRF token) gets nothing, so it can't plant a cookie for its own address.
 */
export function shouldBindLink(headers: Headers, res: Response, origin: URL): boolean {
  return isSameOriginRequest(headers, origin) && isVerifyRequestRedirect(res);
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
  now?: number;
}

/** What the confirm page does: refuse, forward (cookie for this address), or ask for a click. */
export function confirmView(raw: unknown, deps: ConfirmViewDeps): ConfirmView {
  const params = parseConfirmParams(raw);
  if (!params) return { kind: 'invalid' };
  if (verifyLinkBindingCookieValue(deps.secret, deps.cookie, params.email, deps.now)) {
    return { kind: 'auto', url: callbackUrlFor(deps.origin, params) };
  }
  return { kind: 'manual', ...params };
}

/** The query keys a mailed link carries; each must appear exactly once. */
const LINK_KEYS = ['token', 'email', 'callbackUrl'] as const;

export interface CallbackGateDeps {
  secret: string;
  origin: URL;
  /** The binding cookie's value as this request carries it, if any. */
  binding: unknown;
  /** The confirm click's cookie value as this request carries it, if any. */
  confirmed: unknown;
  now?: number;
}

/**
 * The GET of Auth.js's email callback (which spends the token) goes through only for a browser
 * holding the binding cookie for the link's `email`, or the confirm click's cookie for this token
 * and address. Returns null to pass it on, else the confirm page with the same query (no token
 * spent): a link opened any other way, e.g. an attacker sending a victim straight to the callback
 * with the attacker's own token, must be confirmed with a click first.
 */
export function emailCallbackGate(search: URLSearchParams, deps: CallbackGateDeps): string | null {
  const raw: Record<string, string | undefined> = {};
  for (const key of LINK_KEYS) {
    const all = search.getAll(key);
    raw[key] = all.length === 1 ? all[0] : undefined;
  }
  const params = parseConfirmParams(raw);
  const now = deps.now ?? Date.now();
  if (
    params &&
    (verifyLinkBindingCookieValue(deps.secret, deps.binding, params.email, now) ||
      verifyLinkConfirmedCookieValue(deps.secret, deps.confirmed, params.token, params.email, now))
  ) {
    return null;
  }
  const url = new URL(CONFIRM_PATH, deps.origin.origin);
  url.search = search.toString();
  return url.toString();
}

// The web age gate (task 1.7). A signed-in student answers once: where they live and the year they
// were born. The screen is neutral (no pre-filled year, nothing about the cut-off). The privacy
// notice and its version come from the content the server loaded for that market, never from the
// form. An answer under the market's minimum erases the account (the identity store), closes this
// browser's session and sets a non-identifying, httpOnly cookie that refuses another try from this
// browser for 24 hours (here and at sign-in, config.ts).
import { join } from 'node:path';
import {
  agePolicyResolver,
  loadLocalePacks,
  noticeSigned,
  pickPrivacyNotice,
  readPrivacyNoticesDir,
} from '@edmate/content';
import { RepositoryError, type AgePolicy, type IdentityStore } from '@edmate/db';
import { z } from 'zod';
import { describeError } from './describe-error';
import { errorBody, type ErrorBody } from './errors';
import type { CookieReader, Resolved } from './guard';

/** How long a browser that gave an under-age answer is refused another try. */
export const AGE_BLOCK_MAX_AGE_S = 24 * 60 * 60;

/** The block cookie's name: `__Host-` prefixed over https, like the session cookie. */
export function ageBlockCookieName(secure: boolean): string {
  return `${secure ? '__Host-' : ''}edmate.age-block`;
}

/** The "somewhere else" choice: a market with no pack of its own. */
const ELSEWHERE = 'global';

/** A privacy notice as the gate shows it. `signed` is false while it is a placeholder. */
export interface AgeNotice {
  market: string;
  version: string;
  body: string;
  signed: boolean;
}

/** What the gate needs from content/: the market choices, each market's rule and notice. */
export interface AgeContent {
  /** Pack markets, sorted, then `global` ("somewhere else"). */
  markets: readonly string[];
  agePolicy(market: string): AgePolicy;
  notice(market: string): AgeNotice;
}

/**
 * Loads the locale packs (`<dir>/locales`) and privacy notices (`<dir>/legal/privacy-notice`).
 * Throws when either can't be used: the gate must not run without the notice it records.
 */
export function loadAgeContent(dir: string): AgeContent {
  const { notices, errors } = readPrivacyNoticesDir(join(dir, 'legal', 'privacy-notice'));
  if (errors.length > 0) {
    throw new Error(`privacy notices: ${errors.length} unusable file(s)`);
  }
  // Fails here, not on first use, when there is no default notice.
  pickPrivacyNotice(ELSEWHERE, notices);
  const { packs } = loadLocalePacks(join(dir, 'locales'));
  const markets = [...packs.keys()].filter((m) => m !== ELSEWHERE).sort();
  return {
    markets: Object.freeze([...markets, ELSEWHERE]),
    agePolicy: agePolicyResolver(packs),
    notice(market) {
      const n = pickPrivacyNotice(market, notices);
      return { market: n.market, version: n.version, body: n.body, signed: noticeSigned(n) };
    },
  };
}

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

/** Reads and sets cookies: next/headers `cookies()` in a server action fits. */
export interface CookieJar extends CookieReader {
  set(name: string, value: string, options: CookieOptions): void;
}

export interface AgeGateDeps {
  cookies: CookieJar;
  /** The guard's `resolvePrincipal` over these cookies. */
  resolve(cookies: CookieReader): Promise<Resolved | null>;
  identity: Pick<IdentityStore, 'recordAgeAnswer' | 'deleteSession'>;
  content: AgeContent;
  secureCookies: boolean;
  /** The session cookie's name (`sessionCookieName`). */
  sessionCookie: string;
  /** Where failures go, as names only (default: console.error). */
  log?: (line: string) => void;
  /** Clock (tests); a year after this one is no birth year. */
  now?: () => Date;
}

export type AgeAnswerResult =
  { status: 'clear' | 'parent_needed' | 'closed' } | { error: ErrorBody };

const YEAR = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^[0-9]{4}$/)
      .transform(Number),
  ])
  .pipe(z.number().int().min(1900));

/** The neutral message for any answer the gate can't take. */
const ASK_AGAIN = 'Choose where you live and enter the year you were born.';

function cookieOptions(secure: boolean, maxAge: number): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge };
}

/**
 * Closes this browser: the block cookie first, then the session cookie and the session row (the
 * store has already deleted it after an erase; after a blocked erase it is still there).
 */
async function close(deps: AgeGateDeps): Promise<{ status: 'closed' }> {
  const token = deps.cookies.get(deps.sessionCookie)?.value;
  deps.cookies.set(
    ageBlockCookieName(deps.secureCookies),
    '1',
    cookieOptions(deps.secureCookies, AGE_BLOCK_MAX_AGE_S),
  );
  deps.cookies.set(deps.sessionCookie, '', cookieOptions(deps.secureCookies, 0));
  if (token !== undefined) {
    try {
      await deps.identity.deleteSession(token);
    } catch (error) {
      const log = deps.log ?? ((line: string) => console.error(line));
      log(`[auth] age gate: session delete failed ${describeError(error)}`);
    }
  }
  return { status: 'closed' };
}

/** Takes the learner's one age answer (see the header). */
export async function submitAgeAnswer(input: unknown, deps: AgeGateDeps): Promise<AgeAnswerResult> {
  if (deps.cookies.get(ageBlockCookieName(deps.secureCookies))) return close(deps);
  const failed = { error: errorBody('provider_error', 'Could not save your answer. Try again.') };
  let resolved: Resolved | null;
  try {
    resolved = await deps.resolve(deps.cookies);
  } catch {
    return failed;
  }
  if (!resolved) return { error: errorBody('unauthorized', 'Sign in first.') };
  const { principal, status } = resolved;
  if (status === null) return { error: errorBody('forbidden', 'This page is for learners.') };
  // Blocked forever (fix round 1): a session from before the block must not get another try.
  if (status === 'under_age') return close(deps);
  // Answered already (another tab): the standing, and nothing written.
  if (status !== 'age_needed') return { status };

  const thisYear = (deps.now ?? (() => new Date()))().getUTCFullYear();
  const Answer = z.strictObject({
    market: z.enum(deps.content.markets),
    birthYear: YEAR.pipe(z.number().max(thisYear)),
  });
  const parsed = Answer.safeParse(input);
  if (!parsed.success) return { error: errorBody('validation', ASK_AGAIN) };
  const { market, birthYear } = parsed.data;
  try {
    const result = await deps.identity.recordAgeAnswer({
      userId: principal.userId,
      market,
      birthYear,
      noticeVersion: deps.content.notice(market).version,
    });
    if (result.status === 'erase_blocked') {
      // One non-PII line for staff (12.1): an opaque user id, never an email, name or birth year.
      const log = deps.log ?? ((line: string) => console.error(line));
      log(`[auth] age gate: erase blocked, account held for user ${principal.userId}`);
      return close(deps);
    }
    return result.status === 'under_age' ? close(deps) : { status: result.status };
  } catch (error) {
    // The account is gone, or its erase was blocked: either way this browser is closed.
    if (error instanceof RepositoryError && error.kind === 'not_found') return close(deps);
    if (error instanceof RepositoryError && error.kind === 'invalid') {
      return { error: errorBody('validation', ASK_AGAIN) };
    }
    return failed;
  }
}

export type AgeGateView =
  | { state: 'closed' }
  | { state: 'sign_in' }
  | { state: 'not_student' }
  | { state: 'parent_needed' }
  | { state: 'clear' }
  | { state: 'ask'; markets: readonly string[] };

/** What the age gate page shows (it never shows a cut-off). */
export async function ageGateView(
  deps: Pick<AgeGateDeps, 'cookies' | 'resolve' | 'content' | 'secureCookies'>,
): Promise<AgeGateView> {
  if (deps.cookies.get(ageBlockCookieName(deps.secureCookies))) return { state: 'closed' };
  const resolved = await deps.resolve(deps.cookies);
  if (!resolved) return { state: 'sign_in' };
  if (resolved.status === null) return { state: 'not_student' };
  if (resolved.status === 'age_needed') return { state: 'ask', markets: deps.content.markets };
  // Blocked forever (fix round 1): shown the same as a closed browser, never re-answerable.
  if (resolved.status === 'under_age') return { state: 'closed' };
  return { state: resolved.status };
}

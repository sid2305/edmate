// Timing-safe HMAC-SHA256 webhook signature checks (ADR-0015 §5), shared by every adapter.
// Nothing here throws on a bad candidate: a short, long, non-hex or empty signature simply does
// not match, so the caller turns "no match" into one `invalid_signature`. A missing, empty or
// blank secret is different: it is a configuration bug (`validation`), never a match, because an
// HMAC under an empty key is something anyone can compute.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentsError } from '../errors.js';
import { isBlankSecretValue, type Secret } from '../secret.js';
import { isoTimestampMs } from './body.js';

/** ADR-0015 §5: at most 300 s between a provider's signed timestamp and our receivedAt. */
export const MAX_TIMESTAMP_TOLERANCE_SECONDS = 300;

const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const encoder = new TextEncoder();

/** The bytes of several parts joined in order (a string part is UTF-8). */
export function concatBytes(...parts: readonly (Uint8Array | string)[]): Uint8Array {
  const chunks = parts.map((p) => (typeof p === 'string' ? encoder.encode(p) : p));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function digest(secret: Secret, payload: Uint8Array): Buffer {
  return createHmac('sha256', secret.reveal()).update(payload).digest();
}

/** Lower-case hex HMAC-SHA256 of `payload` (used by the fake to sign, and by tests). */
export function hmacSha256Hex(secret: Secret, payload: Uint8Array): string {
  return digest(secret, payload).toString('hex');
}

/**
 * True when any candidate signature (lower or upper-case hex) is the HMAC-SHA256 of `payload`
 * under any of the secrets (rotation). Each comparison is constant time, with the length checked
 * first so it never throws on a bad candidate; every pair is compared, with no early exit.
 * No secrets, or an empty or blank one, throws `validation`.
 */
export function matchesAnySignature(x: {
  payload: Uint8Array;
  candidates: readonly string[];
  secrets: readonly Secret[];
}): boolean {
  if (x.secrets.length === 0 || x.secrets.some((s) => isBlankSecretValue(s.reveal()))) {
    throw new PaymentsError('validation');
  }
  const expected = x.secrets.map((s) => digest(s, x.payload));
  let matched = false;
  for (const candidate of x.candidates) {
    const given = HEX_SHA256.test(candidate) ? Buffer.from(candidate, 'hex') : undefined;
    for (const want of expected) {
      if (given !== undefined && given.length === want.length && timingSafeEqual(given, want)) {
        matched = true;
      }
    }
  }
  return matched;
}

/**
 * Throws `stale_signature` when the signed timestamp (Unix seconds) is further than the
 * tolerance from `receivedAt`, in either direction. A tolerance above 300 s, or a receivedAt that
 * is not a contracts ISO timestamp (a `Z` or a numeric offset), is a configuration bug:
 * `validation`. The signed timestamp itself is whole Unix seconds (a safe integer), not ISO.
 */
export function checkSignedTimestamp(x: {
  signedAtSeconds: number;
  receivedAt: string;
  toleranceSeconds?: number;
}): void {
  const tolerance = x.toleranceSeconds ?? MAX_TIMESTAMP_TOLERANCE_SECONDS;
  const receivedMs = isoTimestampMs(x.receivedAt);
  if (
    receivedMs === undefined ||
    !(tolerance >= 0 && tolerance <= MAX_TIMESTAMP_TOLERANCE_SECONDS)
  ) {
    throw new PaymentsError('validation');
  }
  if (
    !Number.isSafeInteger(x.signedAtSeconds) ||
    Math.abs(receivedMs - x.signedAtSeconds * 1000) > tolerance * 1000
  ) {
    throw new PaymentsError('stale_signature');
  }
}

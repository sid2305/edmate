// Field formats (lead answers Q4), shared by the schema modules. Not part of the public API.
import { z } from 'zod';
import { LIMITS } from './limits.js';

/** Ids are pseudonymous: 1 to 128 letters, digits, `_` or `-` (fix round 1). */
export const id = () =>
  z
    .string()
    .min(1)
    .max(LIMITS.idMaxLength)
    .regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, _ or -');
/** Counts, token numbers, versions, money in minor units: non-negative safe integers. */
export const count = () => z.int().min(0);
/** Timestamps: ISO 8601 with a `Z` or a numeric offset. */
export const timestamp = () => z.iso.datetime({ offset: true });
/** Market: an ISO 3166-1 alpha-2 code of the locale pack, or the literal `global`. */
export const market = () =>
  z.string().regex(/^(?:[A-Z]{2}|global)$/, 'ISO 3166-1 alpha-2 code or "global"');
/** Currency: an ISO 4217 code. */
export const currencyCode = () => z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code');
export const tier = () => z.enum(['small', 'main']);
/**
 * `https://host[:port]` then an optional path, query or fragment: lower-case scheme, no userinfo,
 * no whitespace or backslash in the authority, nothing around the URL (ADR-0005 fix round 1).
 * The shape check runs first: `z.url` trims its input, so on its own it would accept " https://…".
 */
const HTTPS_URL = /^https:\/\/[^\s/?#@\\]+(?:[/?#]\S*)?$/;
export const httpsUrl = () =>
  z
    .string()
    .regex(HTTPS_URL, 'https://host/path, no userinfo')
    .pipe(z.url({ protocol: /^https$/ }));
/** Calendar dates: YYYY-MM-DD, a real day (ADR-0008). */
export const date = () => z.iso.date();
/**
 * Who signed something off (ADR-0008): a name or handle, not blank, at most 200 characters, never
 * an email address (the repo is public). Same rule as the content package's reviewer field.
 */
export const signer = () =>
  z
    .string()
    .max(LIMITS.signerMaxLength)
    .refine((s) => s.trim() !== '', 'must not be blank')
    .refine((s) => !/\S@\S+\.\S/.test(s), 'a name or handle, not an email address');

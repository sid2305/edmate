// India-market PII patterns (task 4.2). Task 3.10 ships the same four sources, byte for byte, in
// `content/locales/IN.yaml`; @edmate/content's tests check the two stay equal, so every piiScrub
// and piiPatterns test here also covers the real pack.
// The guard compiles every source with exactly the flags 'gu' and runs it on a copy of the text
// whose digits are folded to ASCII, so `\d` here also covers Devanagari and other digits.
// Task 3.10's safe-regex check allows no backreference and no quantifier inside a repeated group,
// so the Aadhaar pattern spells out its three separator forms and its three year groups.
import { demoLocalePack } from '@edmate/contracts/fixtures';
import type { LocalePack } from '@edmate/contracts';

/** Three year-shaped groups (19xx/20xx, e.g. "2023 2024 2025"), any separators: not an ID. */
const YEAR = String.raw`(?:19|20)\d\d[ -]?`;
/**
 * Aadhaar-like: 4-4-4 digits (same separator throughout, or none). Three year-shaped groups
 * are left alone so a list of years is not an ID.
 */
const AADHAAR = String.raw`(?<!\d)(?!${YEAR}${YEAR}${YEAR}(?!\d))\d{4}(?:\d{8}| \d{4} \d{4}|-\d{4}-\d{4})(?!\d)`;
/** PAN: five letters, four digits, one letter (either case: the guard never adds the i flag). */
const PAN = String.raw`(?<![A-Za-z0-9])[A-Za-z]{5}\d{4}[A-Za-z](?![A-Za-z0-9])`;
/** UPI id: handle@provider, where the provider has no dot (an email has one, and is caught there). */
const UPI = String.raw`(?<![\w.\-@])[\w.\-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}(?![\w.\-@])`;
/** Indian mobile: an unseparated [6-9] + 9 digits, optional +91/91/0 prefix. */
const PHONE_IN = String.raw`(?<![\d+])(?:\+?91[ \-]?|0)?[6-9]\d{9}(?!\d)`;

export const IN_PII_PATTERNS = Object.freeze({
  aadhaar: AADHAAR,
  pan: PAN,
  upi: UPI,
  phoneIn: PHONE_IN,
});

/** demoLocalePack with the India patterns above in place of its one generic pattern. */
export const indiaLocalePackWithPii: LocalePack = {
  ...demoLocalePack,
  piiPatterns: [AADHAAR, PAN, UPI, PHONE_IN],
};

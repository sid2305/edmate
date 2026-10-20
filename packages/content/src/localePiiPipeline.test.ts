// Task 3.10 acceptance: "the real IN pack passes 4.2's PII pipeline test (UPI included)". The
// committed `content/locales/IN.yaml` goes through the real loader, then through the real
// piiScrub guard with 4.2's shared cases (phone, email, card, OTP, name, Aadhaar-like, PAN, UPI).
import { fileURLToPath } from 'node:url';
import { IN_PII_PATTERNS, PII_SCRUB_CASES, piiScrubCaseFailures } from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { readLocalePack } from './localeLoader.js';
import { piiPatternsCompileWithGu, piiPatternsSafeRegex } from './localeRules.js';

const IN_FILE = fileURLToPath(new URL('../../../content/locales/IN.yaml', import.meta.url));

describe('the real IN pack in the PII pipeline', () => {
  const pack = readLocalePack(IN_FILE);

  it('passes every 4.2 piiScrub case, UPI included', async () => {
    expect(PII_SCRUB_CASES.map((c) => c.label)).toContain('UPI id (locale)');
    expect(await piiScrubCaseFailures({ locale: pack })).toEqual([]);
  });

  it('carries exactly the patterns the harness PII tests run, in order', () => {
    expect(pack.piiPatterns).toEqual([
      IN_PII_PATTERNS.aadhaar,
      IN_PII_PATTERNS.pan,
      IN_PII_PATTERNS.upi,
      IN_PII_PATTERNS.phoneIn,
    ]);
  });

  it('its patterns compile with gu and pass the safe-regex check', () => {
    const packs = new Map([[pack.market, pack]]);
    expect(piiPatternsCompileWithGu(packs)).toEqual([]);
    expect(piiPatternsSafeRegex(packs)).toEqual([]);
  });
});

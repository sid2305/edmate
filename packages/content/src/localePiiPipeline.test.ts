// Task 3.10 acceptance: "the real IN pack passes 4.2's PII pipeline test (UPI included)". The
// committed `content/locales/IN.yaml` goes through the real loader, then through the real
// piiScrub guard with 4.2's shared cases (phone, email, card, OTP, name, Aadhaar-like, PAN, UPI).
//
// Task 1.7h adds a second block below for the US pack's own SSN pattern: it does not reuse
// PII_SCRUB_CASES/piiScrubCaseFailures above, since that shared array is IN-specific (its
// "(locale)" rows are Aadhaar/PAN/UPI) and running it against the US pack would spuriously fail.
import { fileURLToPath } from 'node:url';
import { cancelSource, createPiiScrubGuard } from '@edmate/harness';
import {
  IN_PII_PATTERNS,
  PII_SCRUB_CASES,
  piiScrubCaseFailures,
  US_PII_PATTERNS,
} from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { readLocalePack } from './localeLoader.js';
import { piiPatternsCompileWithGu, piiPatternsSafeRegex } from './localeRules.js';

const IN_FILE = fileURLToPath(new URL('../../../content/locales/IN.yaml', import.meta.url));
const US_FILE = fileURLToPath(new URL('../../../content/locales/US.yaml', import.meta.url));

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

describe('the real US pack in the PII pipeline', () => {
  const pack = readLocalePack(US_FILE);

  it('carries exactly the SSN pattern the harness PII tests run', () => {
    expect(pack.piiPatterns).toEqual([US_PII_PATTERNS.ssn]);
  });

  it('its patterns compile with gu and pass the safe-regex check', () => {
    const packs = new Map([[pack.market, pack]]);
    expect(piiPatternsCompileWithGu(packs)).toEqual([]);
    expect(piiPatternsSafeRegex(packs)).toEqual([]);
  });

  it('the real piiScrub guard redacts a synthetic SSN as "redacted: id"', async () => {
    const guard = createPiiScrubGuard();
    const { token } = cancelSource();
    const run = await guard.run('my SSN is 000-00-0000, ok', { locale: pack }, token);
    expect(run.result).toEqual({
      ok: false,
      action: 'rewrite',
      text: 'my SSN is [id], ok',
      reason: 'redacted: id',
    });
  });
});

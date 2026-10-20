// Task 1.7: the age rule from a birth year, as a pure function. Age is the youngest possible age
// for that year (Q3 (a)): currentYearUTC - birthYear - 1, so the ambiguous year counts as younger.
// The market's rule is injected and fails closed: the minimum is never below 13, and only an
// explicit `consentRequired: false` waives parental consent for 13-17.
import { describe, expect, it } from 'vitest';
import {
  type AgePolicy,
  ageStatus,
  CONSENT_AGE,
  DEFAULT_AGE_POLICY,
  PLATFORM_MIN_AGE,
  youngestAge,
} from '../src/identity/age.js';

const NOW = new Date('2026-10-20T12:00:00Z');
const CONSENT: AgePolicy = { minAge: 13, consentRequired: true };
const NO_CONSENT: AgePolicy = { minAge: 13, consentRequired: false };

const status = (birthYear: number | null, policy: AgePolicy, parentConsent = false, now = NOW) =>
  ageStatus({ birthYear, policy, parentConsent, now });

describe('constants', () => {
  it('13 is the platform floor; 18 is ADR-0008’s "learners under 18"', () => {
    expect(PLATFORM_MIN_AGE).toBe(13);
    expect(CONSENT_AGE).toBe(18);
    expect(DEFAULT_AGE_POLICY).toEqual({ minAge: 13, consentRequired: true });
    expect(Object.isFrozen(DEFAULT_AGE_POLICY)).toBe(true);
  });
});

describe('youngestAge', () => {
  it('counts the year of birth as not yet had a birthday', () => {
    expect(youngestAge(2013, NOW)).toBe(12);
    expect(youngestAge(2012, NOW)).toBe(13);
    expect(youngestAge(2008, NOW)).toBe(17);
    expect(youngestAge(2007, NOW)).toBe(18);
  });

  it('uses the UTC year, at both edges of New Year', () => {
    expect(youngestAge(2013, new Date('2026-12-31T23:59:59Z'))).toBe(12);
    expect(youngestAge(2013, new Date('2027-01-01T00:00:00Z'))).toBe(13);
  });
});

describe('ageStatus', () => {
  it('no birth year yet is age_needed', () => {
    expect(status(null, CONSENT)).toBe('age_needed');
    expect(status(null, NO_CONSENT, true)).toBe('age_needed');
  });

  it('the 13 edge: 2013 is under_age, 2012 passes', () => {
    expect(status(2013, CONSENT)).toBe('under_age');
    expect(status(2013, NO_CONSENT, true)).toBe('under_age');
    expect(status(2012, NO_CONSENT)).toBe('clear');
    expect(status(2026, CONSENT)).toBe('under_age');
  });

  it('a child turning 13 this year passes on 1 January', () => {
    expect(status(2013, CONSENT, false, new Date('2027-01-01T00:00:00Z'))).toBe('parent_needed');
  });

  it('13-17 where the market requires consent: parent_needed until a live parental consent', () => {
    expect(status(2012, CONSENT)).toBe('parent_needed');
    expect(status(2008, CONSENT)).toBe('parent_needed');
    expect(status(2012, CONSENT, true)).toBe('clear');
    expect(status(2008, CONSENT, true)).toBe('clear');
  });

  it('the 18 edge: 2008 still needs consent, 2007 is clear without it', () => {
    expect(status(2008, CONSENT)).toBe('parent_needed');
    expect(status(2007, CONSENT)).toBe('clear');
    expect(status(1990, CONSENT)).toBe('clear');
  });

  it('a market that waives consent clears 13-17 without a parent', () => {
    expect(status(2012, NO_CONSENT)).toBe('clear');
    expect(status(2008, NO_CONSENT)).toBe('clear');
  });

  it('a market minimum above 13 is honoured', () => {
    const sixteen: AgePolicy = { minAge: 16, consentRequired: true };
    expect(status(2010, sixteen)).toBe('under_age'); // 15
    expect(status(2009, sixteen)).toBe('parent_needed'); // 16
  });

  it('fails closed on a bad policy: the floor stays 13 and consent stays required', () => {
    expect(status(2013, { minAge: 10, consentRequired: false })).toBe('under_age');
    const loose = { minAge: 13, consentRequired: 'no' } as unknown as AgePolicy;
    expect(status(2010, loose)).toBe('parent_needed');
    const missing = { minAge: 13 } as unknown as AgePolicy;
    expect(status(2010, missing)).toBe('parent_needed');
  });

  it('throws on a minimum that is not finite or above the consent age (never erases on it)', () => {
    for (const minAge of [Number.NaN, Infinity, -Infinity, CONSENT_AGE + 1, 99]) {
      expect(() => status(1990, { minAge, consentRequired: true }), String(minAge)).toThrow(
        'bad minAge',
      );
      expect(() => status(2020, { minAge, consentRequired: true }), String(minAge)).toThrow();
    }
    expect(status(2010, { minAge: CONSENT_AGE, consentRequired: true })).toBe('under_age');
    expect(status(1990, { minAge: CONSENT_AGE, consentRequired: true })).toBe('clear');
    // No birth year: still no answer, the policy is not read.
    const bad = { minAge: Number.NaN, consentRequired: true };
    expect(ageStatus({ birthYear: null, policy: bad, parentConsent: false, now: NOW })).toBe(
      'age_needed',
    );
  });
});

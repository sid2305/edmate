// `agePolicyFor` (task 1.7 Phase B): the per-market age rule from a locale pack, failing closed.
import type { LocalePack } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import {
  agePolicyFor,
  agePolicyResolver,
  complianceSigned,
  DEFAULT_AGE_POLICY,
  PLATFORM_MIN_AGE,
} from './agePolicy.js';
import { DEFAULT_LOCALE_MARKET } from './localeRules.js';

function pack(over: {
  market?: string;
  minAge?: number;
  consent?: boolean;
  reviewedBy?: string | undefined;
}): LocalePack {
  const p: LocalePack = {
    market: over.market ?? 'XX',
    languages: ['en'],
    timezone: 'UTC',
    currency: { code: 'XXX', format: '#,##0.00' },
    payments: { methods: [], provider: 'tbd' },
    helplines: [],
    compliance: {
      privacyLaw: 'Example Privacy Act',
      minAge: over.minAge ?? 13,
      dataRegion: 'test-region',
      grievance: 'Example grievance desk',
      parentalConsentRequired: over.consent ?? true,
    },
    regulatedDisclaimers: {},
    piiPatterns: [],
  };
  if ('reviewedBy' in over) {
    if (over.reviewedBy !== undefined) {
      p.reviewedBy = over.reviewedBy;
      p.reviewedOn = '2026-01-01';
    }
  } else {
    p.reviewedBy = 'Example Reviewer';
    p.reviewedOn = '2026-01-01';
  }
  return p;
}

describe('complianceSigned', () => {
  it('is true only when reviewedBy is set and not "pending"', () => {
    expect(complianceSigned(pack({}))).toBe(true);
    expect(complianceSigned(pack({ reviewedBy: undefined }))).toBe(false);
    expect(complianceSigned(pack({ reviewedBy: 'pending' }))).toBe(false);
    expect(complianceSigned(pack({ reviewedBy: '  Pending ' }))).toBe(false);
  });
});

describe('agePolicyFor', () => {
  it('a signed pack that waives consent waives it', () => {
    expect(agePolicyFor(pack({ consent: false }))).toEqual({ minAge: 13, consentRequired: false });
  });

  it('a signed pack that requires consent requires it', () => {
    expect(agePolicyFor(pack({ consent: true }))).toEqual({ minAge: 13, consentRequired: true });
  });

  it('an unsigned pack can never relax consent (fails closed)', () => {
    for (const reviewedBy of [undefined, 'pending', 'PENDING']) {
      expect(agePolicyFor(pack({ consent: false, reviewedBy }))).toEqual({
        minAge: 13,
        consentRequired: true,
      });
      expect(agePolicyFor(pack({ consent: true, reviewedBy })).consentRequired).toBe(true);
    }
  });

  it('never lets the minimum age fall below the platform floor of 13', () => {
    expect(PLATFORM_MIN_AGE).toBe(13);
    for (const minAge of [0, 5, 12]) expect(agePolicyFor(pack({ minAge })).minAge).toBe(13);
  });

  it('keeps a market minimum above the floor, signed or not', () => {
    expect(agePolicyFor(pack({ minAge: 16 })).minAge).toBe(16);
    expect(agePolicyFor(pack({ minAge: 16, reviewedBy: 'pending' })).minAge).toBe(16);
  });

  it('a malformed minimum (not a safe integer) reads as the floor', () => {
    for (const minAge of [Number.NaN, 13.5, -1]) {
      expect(agePolicyFor(pack({ minAge })).minAge).toBe(13);
    }
  });

  it('returns a fresh object (callers cannot change a shared policy)', () => {
    const p = pack({});
    expect(agePolicyFor(p)).not.toBe(agePolicyFor(p));
  });
});

describe('DEFAULT_AGE_POLICY', () => {
  it('needs consent at the floor and is frozen', () => {
    expect(DEFAULT_AGE_POLICY).toEqual({ minAge: 13, consentRequired: true });
    expect(Object.isFrozen(DEFAULT_AGE_POLICY)).toBe(true);
  });
});

describe('agePolicyResolver', () => {
  const packs = new Map<string, LocalePack>([
    [DEFAULT_LOCALE_MARKET, pack({ market: DEFAULT_LOCALE_MARKET, reviewedBy: undefined })],
    ['XX', pack({ market: 'XX', consent: false })],
    ['YY', pack({ market: 'YY', consent: false, reviewedBy: 'pending', minAge: 15 })],
  ]);
  const policy = agePolicyResolver(packs);

  it("uses each market's own pack", () => {
    expect(policy('XX')).toEqual({ minAge: 13, consentRequired: false });
    expect(policy('YY')).toEqual({ minAge: 15, consentRequired: true });
  });

  it('a market without a pack gets the default pack, which needs consent', () => {
    expect(policy('ZZ')).toEqual({ minAge: 13, consentRequired: true });
    expect(policy(DEFAULT_LOCALE_MARKET)).toEqual({ minAge: 13, consentRequired: true });
  });

  it('with no packs at all, every market gets the default policy', () => {
    expect(agePolicyResolver(new Map())('XX')).toEqual(DEFAULT_AGE_POLICY);
  });
});

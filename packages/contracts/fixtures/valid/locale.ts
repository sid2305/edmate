import type { LocalePack } from '../../src/index.js';

/** A made-up locale pack: the helpline is fictional and its number is not routable. */
export const demoLocalePack = {
  market: 'IN',
  languages: ['en', 'hi'],
  timezone: 'Asia/Kolkata',
  currency: { code: 'INR', format: '₹#,##,##0.00' },
  payments: { methods: ['upi', 'card'], provider: 'test-payments' },
  helplines: [
    {
      name: 'Example Helpline',
      number: '000-000-0000',
      kind: 'mental_health',
      verifiedBy: 'Example Reviewer',
      verifiedOn: '2026-01-01',
    },
  ],
  compliance: {
    privacyLaw: 'Example Privacy Act',
    minAge: 13,
    dataRegion: 'test-region-1',
    grievance: 'Example grievance desk',
    parentalConsentRequired: true,
  },
  reviewedBy: 'Example Reviewer',
  reviewedOn: '2026-01-01',
  regulatedDisclaimers: { investing: 'Example disclaimer: this is education, not advice.' },
  piiPatterns: ['\\b\\d{4}\\s?\\d{4}\\s?\\d{4}\\b'],
} satisfies LocalePack;

export const localePackMinimal = {
  market: 'global',
  languages: ['en'],
  timezone: 'UTC',
  currency: { code: 'USD', format: '$#,##0.00' },
  payments: { methods: [], provider: 'test-payments' },
  helplines: [],
  compliance: {
    privacyLaw: 'Example Privacy Act',
    minAge: 16,
    dataRegion: 'test-region-2',
    grievance: 'Example grievance desk',
    parentalConsentRequired: false,
  },
  regulatedDisclaimers: {},
  piiPatterns: [],
} satisfies LocalePack;

export const valid = {
  LocalePack: [demoLocalePack, localePackMinimal],
};

import { omit } from '../omit.js';
import { demoLocalePack } from '../valid/locale.js';
import type { InvalidCase } from './case.js';

export const invalid: InvalidCase[] = [
  {
    schema: 'LocalePack',
    name: 'lowercase currency code',
    value: { ...demoLocalePack, currency: { ...demoLocalePack.currency, code: 'inr' } },
    path: ['currency', 'code'],
  },
  {
    schema: 'LocalePack',
    name: 'disclaimer for an unknown regulated subject',
    value: { ...demoLocalePack, regulatedDisclaimers: { tax: 'Example disclaimer.' } },
    path: ['regulatedDisclaimers'],
  },
  {
    schema: 'LocalePack',
    name: 'negative minAge',
    value: { ...demoLocalePack, compliance: { ...demoLocalePack.compliance, minAge: -1 } },
    path: ['compliance', 'minAge'],
  },
  {
    schema: 'LocalePack',
    name: 'piiPattern that does not compile',
    value: { ...demoLocalePack, piiPatterns: ['(unclosed'] },
    path: ['piiPatterns', 0],
  },
  {
    schema: 'LocalePack',
    name: 'piiPattern over 500 characters',
    value: { ...demoLocalePack, piiPatterns: ['a'.repeat(501)] },
    path: ['piiPatterns', 0],
  },
  {
    schema: 'LocalePack',
    name: 'helpline without verifiedBy',
    value: {
      ...demoLocalePack,
      helplines: [{ name: 'Example Helpline', number: '000', kind: 'x', verifiedOn: '2026-01-01' }],
    },
    path: ['helplines', 0, 'verifiedBy'],
  },
  {
    schema: 'LocalePack',
    name: 'helpline verifiedOn not a calendar date',
    value: {
      ...demoLocalePack,
      helplines: [{ ...demoLocalePack.helplines[0], verifiedOn: '2026-02-30' }],
    },
    path: ['helplines', 0, 'verifiedOn'],
  },
  {
    schema: 'LocalePack',
    name: 'parentalConsentRequired not a boolean',
    value: {
      ...demoLocalePack,
      compliance: { ...demoLocalePack.compliance, parentalConsentRequired: 'yes' },
    },
    path: ['compliance', 'parentalConsentRequired'],
  },
  {
    schema: 'LocalePack',
    name: 'reviewedBy without reviewedOn',
    value: omit(demoLocalePack, 'reviewedOn'),
    path: ['reviewedOn'],
  },
];

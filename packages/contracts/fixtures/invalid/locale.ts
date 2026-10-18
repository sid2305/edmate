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
];

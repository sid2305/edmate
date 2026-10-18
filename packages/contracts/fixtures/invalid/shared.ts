import { moneyPaid, usageSmall } from '../valid/shared.js';
import type { InvalidCase } from './case.js';

export const invalid: InvalidCase[] = [
  { schema: 'Lang', name: 'region subtag is not allowed', value: 'en-IN', path: [] },
  { schema: 'Lang', name: 'uppercase', value: 'EN', path: [] },
  { schema: 'Skill', name: 'unknown skill', value: 'homework_solver', path: [] },
  {
    schema: 'Money',
    name: 'negative amountMinor',
    value: { ...moneyPaid, amountMinor: -1 },
    path: ['amountMinor'],
  },
  {
    schema: 'Money',
    name: 'float amountMinor',
    value: { ...moneyPaid, amountMinor: 499.5 },
    path: ['amountMinor'],
  },
  {
    schema: 'Money',
    name: 'unsafe integer amountMinor',
    value: { ...moneyPaid, amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    path: ['amountMinor'],
  },
  {
    schema: 'Money',
    name: 'lowercase currency',
    value: { ...moneyPaid, currency: 'inr' },
    path: ['currency'],
  },
  { schema: 'Money', name: 'unknown key', value: { ...moneyPaid, display: '₹499' }, path: [] },
  { schema: 'ErrorCode', name: 'unknown code', value: 'teapot', path: [] },
  {
    schema: 'Usage',
    name: 'unknown tier',
    value: { ...usageSmall, tier: 'large' },
    path: ['tier'],
  },
  {
    schema: 'Usage',
    name: 'negative tokens',
    value: { ...usageSmall, inputTokens: -5 },
    path: ['inputTokens'],
  },
  {
    schema: 'Usage',
    name: 'missing costMicroUsd',
    value: { ...usageSmall, costMicroUsd: undefined },
    path: ['costMicroUsd'],
  },
  { schema: 'ToolName', name: 'empty tool name', value: '', path: [] },
];

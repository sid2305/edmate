import { demoAgentConfig, demoPackageFree, demoStyleCard } from '../valid/teacher.js';
import type { InvalidCase } from './case.js';

export const invalid: InvalidCase[] = [
  {
    schema: 'AgentConfig',
    name: 'promptPackVersion is not semver',
    value: { ...demoAgentConfig, promptPackVersion: 'latest' },
    path: ['promptPackVersion'],
  },
  {
    schema: 'AgentConfig',
    name: 'unknown regulated subject',
    value: { ...demoAgentConfig, regulatedSubject: 'tax' },
    path: ['regulatedSubject'],
  },
  {
    schema: 'AgentConfig',
    name: 'more than one course (MVP: one course per agent)',
    value: { ...demoAgentConfig, courseIds: ['crs_test_01', 'crs_test_02'] },
    path: [],
  },
  {
    schema: 'StyleCard',
    name: '301 words',
    value: { ...demoStyleCard, text: Array.from({ length: 301 }, () => 'word').join(' ') },
    path: ['text'],
  },
  {
    schema: 'PackageConfig',
    name: 'helpCeiling 0',
    value: { ...demoPackageFree, helpCeiling: 0 },
    path: ['helpCeiling'],
  },
  {
    schema: 'PackageConfig',
    name: 'helpCeiling 5',
    value: { ...demoPackageFree, helpCeiling: 5 },
    path: ['helpCeiling'],
  },
  {
    schema: 'PackageConfig',
    name: 'negative price',
    value: { ...demoPackageFree, pricePerMonth: { amountMinor: -100, currency: 'INR' } },
    path: ['pricePerMonth', 'amountMinor'],
  },
  {
    schema: 'PackageConfig',
    name: 'dailyMessageLimit has no default',
    value: { ...demoPackageFree, dailyMessageLimit: undefined },
    path: ['dailyMessageLimit'],
  },
  {
    schema: 'PackageConfig',
    name: 'unknown skill',
    value: { ...demoPackageFree, skills: ['explain', 'homework_solver'] },
    path: ['skills', 1],
  },
];

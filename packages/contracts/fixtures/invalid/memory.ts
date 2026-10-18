import { demoLearnerProfile, evidenceCheck } from '../valid/memory.js';
import type { InvalidCase } from './case.js';

export const invalid: InvalidCase[] = [
  {
    schema: 'LearnerProfile',
    name: '61-word summary',
    value: {
      ...demoLearnerProfile,
      lastSummary: Array.from({ length: 61 }, () => 'word').join(' '),
    },
    path: ['lastSummary'],
  },
  {
    schema: 'LearnerProfile',
    name: 'mastery p above 1',
    value: {
      ...demoLearnerProfile,
      mastery: { topic_x: { p: 1.2, n: 1, updatedAt: '2026-10-17T10:00:00Z' } },
    },
    path: ['mastery', 'topic_x', 'p'],
  },
  {
    schema: 'LearnerProfile',
    name: 'mistake count is a float',
    value: {
      ...demoLearnerProfile,
      mistakes: [{ tag: 'sign_error', count: 1.5, lastSeen: '2026-10-17T10:00:00Z' }],
    },
    path: ['mistakes', 0, 'count'],
  },
  {
    schema: 'EvidenceEvent',
    name: 'unknown source',
    value: { ...evidenceCheck, source: 'guess' },
    path: ['source'],
  },
  {
    schema: 'EvidenceEvent',
    name: 'ts is not a timestamp',
    value: { ...evidenceCheck, ts: 1760695200000 },
    path: ['ts'],
  },
];

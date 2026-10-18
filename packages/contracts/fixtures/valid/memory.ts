import type { EvidenceEvent, LearnerProfile } from '../../src/index.js';

export const learnerProfileNew = {
  studentId: 'stu_test_01',
  teacherId: 'tch_test_01',
  lang: 'en',
  mastery: {},
  mistakes: [],
} satisfies LearnerProfile;

export const demoLearnerProfile = {
  studentId: 'stu_test_01',
  teacherId: 'tch_test_01',
  lang: 'hi',
  mastery: {
    topic_fractions_add: { p: 0.35, n: 4, updatedAt: '2026-10-17T10:00:00Z' },
    topic_fractions_compare: { p: 1, n: 9, updatedAt: '2026-10-16T08:15:00+05:30' },
    topic_decimals: { p: 0, n: 0, updatedAt: '2026-10-01T00:00:00Z' },
  },
  mistakes: [{ tag: 'sign_error', count: 3, lastSeen: '2026-10-17T10:00:00Z' }],
  lastSummary:
    'Worked on adding fractions with unlike denominators. Found a common denominator with help.',
} satisfies LearnerProfile;

export const evidenceCheck = {
  studentId: 'stu_test_01',
  teacherId: 'tch_test_01',
  topicId: 'topic_fractions_add',
  correct: true,
  source: 'check',
  weight: 1,
  ts: '2026-10-17T10:00:00Z',
} satisfies EvidenceEvent;

export const valid = {
  LearnerProfile: [learnerProfileNew, demoLearnerProfile],
  EvidenceEvent: [
    evidenceCheck,
    { ...evidenceCheck, correct: false, source: 'practice', weight: 0.5 } satisfies EvidenceEvent,
    { ...evidenceCheck, source: 'rubric', weight: 2 } satisfies EvidenceEvent,
  ],
};

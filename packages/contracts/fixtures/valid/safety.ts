import type { GuardResult, SafetyAlert } from '../../src/index.js';

export const demoSafetyAlert = {
  id: 'alr_test_01',
  level: 'alert',
  kind: 'distress',
  studentId: 'stu_test_01',
  teacherId: 'tch_test_01',
  sessionId: 'ses_test_01',
  excerptRedacted: 'I feel [REDACTED] about the exam.',
  createdAt: '2026-10-17T10:06:00Z',
} satisfies SafetyAlert;

export const safetyAlertCritical = {
  ...demoSafetyAlert,
  id: 'alr_test_02',
  level: 'critical',
  kind: 'other',
} satisfies SafetyAlert;

export const guardOk = { ok: true } satisfies GuardResult;
export const guardBlock = {
  ok: false,
  action: 'block',
  reason: 'prompt_injection',
} satisfies GuardResult;
export const guardRewrite = {
  ok: false,
  action: 'rewrite',
  text: 'Let us work through it step by step.',
  reason: 'final_answer_leak',
} satisfies GuardResult;
export const guardEscalate = {
  ok: false,
  action: 'escalate',
  alert: demoSafetyAlert,
} satisfies GuardResult;

export const valid = {
  SafetyAlert: [
    demoSafetyAlert,
    safetyAlertCritical,
    { ...demoSafetyAlert, level: 'info', kind: 'abuse' } satisfies SafetyAlert,
    { ...demoSafetyAlert, kind: 'misuse' } satisfies SafetyAlert,
  ],
  GuardResult: [guardOk, guardBlock, guardRewrite, guardEscalate],
};

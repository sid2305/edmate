import type { Entitlement } from '../../src/index.js';

export const demoEntitlementSubscription = {
  source: 'subscription',
  subscriptionId: 'sub_test_01',
  studentId: 'stu_test_01',
  teacherId: 'tch_test_01',
  agentId: 'agt_test_01',
  market: 'IN',
  packageId: 'pkg_test_paid',
  packageVersion: 2,
  status: 'active',
  periodEnd: '2026-11-18T00:00:00Z',
  allowedModuleIds: ['mod_test_01', 'mod_test_02'],
  lockedModuleIds: ['mod_test_03'],
  skills: ['explain', 'coach', 'practice'],
} satisfies Entitlement;

export const demoEntitlementPreview = {
  source: 'teacher_preview',
  studentId: 'stu_test_preview',
  teacherId: 'tch_test_01',
  agentId: 'agt_test_01',
  market: 'global',
  packageId: 'pkg_test_free',
  packageVersion: 1,
  status: 'trial',
  periodEnd: '2026-10-25T09:30:00+05:30',
  allowedModuleIds: ['mod_test_01'],
  lockedModuleIds: [],
  skills: ['explain'],
} satisfies Entitlement;

export const demoEntitlementEval = {
  source: 'eval',
  studentId: 'stu_test_eval',
  teacherId: 'tch_test_01',
  agentId: 'agt_test_01',
  market: 'US',
  packageId: 'pkg_test_free',
  packageVersion: 1,
  status: 'past_due',
  periodEnd: '2026-10-01T00:00:00.000Z',
  allowedModuleIds: [],
  lockedModuleIds: [],
  skills: [],
} satisfies Entitlement;

export const valid = {
  Entitlement: [demoEntitlementSubscription, demoEntitlementPreview, demoEntitlementEval],
};

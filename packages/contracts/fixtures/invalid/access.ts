import { demoEntitlementPreview, demoEntitlementSubscription } from '../valid/access.js';
import { omit } from '../omit.js';
import type { InvalidCase } from './case.js';

const subscriptionWithoutId = omit(demoEntitlementSubscription, 'subscriptionId');

export const invalid: InvalidCase[] = [
  {
    schema: 'Entitlement',
    name: 'subscription without subscriptionId',
    value: subscriptionWithoutId,
    path: ['subscriptionId'],
  },
  {
    schema: 'Entitlement',
    name: 'subscriptionId on a teacher preview',
    value: { ...demoEntitlementPreview, subscriptionId: 'sub_test_01' },
    path: ['subscriptionId'],
  },
  {
    schema: 'Entitlement',
    name: 'module both allowed and locked',
    value: { ...demoEntitlementSubscription, lockedModuleIds: ['mod_test_02', 'mod_test_03'] },
    path: ['lockedModuleIds'],
  },
  {
    schema: 'Entitlement',
    name: 'invented market code',
    value: { ...demoEntitlementSubscription, market: 'India' },
    path: ['market'],
  },
  {
    schema: 'Entitlement',
    name: 'periodEnd is not a timestamp',
    value: { ...demoEntitlementSubscription, periodEnd: 'next month' },
    path: ['periodEnd'],
  },
  {
    schema: 'Entitlement',
    name: 'periodEnd has no offset',
    value: { ...demoEntitlementSubscription, periodEnd: '2026-11-18T00:00:00' },
    path: ['periodEnd'],
  },
  {
    schema: 'Entitlement',
    name: 'unknown status',
    value: { ...demoEntitlementSubscription, status: 'cancelled' },
    path: ['status'],
  },
];

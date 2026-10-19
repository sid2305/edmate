import {
  demoEntitlementSubscription,
  demoTurnInput,
  usageMain,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { memoryUsageMeter } from '../../testing/memoryPorts.js';
import { stepEnvExtras, testDeps } from '../../testing/testSteps.js';
import type { PipelineDeps, StepEnv } from '../types.js';
import { meter } from './meter.js';

function env(deps: Partial<PipelineDeps>): StepEnv {
  return {
    input: demoTurnInput,
    deps: { ...testDeps().deps, ...deps },
    cancel: { cancelled: false, onCancel: () => undefined },
    turnId: 'turn_meter',
    ...stepEnvExtras(),
  };
}

describe('meter', () => {
  it('records every usage, in order, billed to the entitlement and the turn', async () => {
    const usage = memoryUsageMeter();
    await meter(env({ usage }), {
      usage: [usageSmall, usageMain],
      entitlement: demoEntitlementSubscription,
    });
    const ctx = {
      teacherId: 'tch_test_01',
      packageId: 'pkg_test_paid',
      studentId: 'stu_test_01',
      turnId: 'turn_meter',
      source: 'subscription',
    };
    expect(usage.rows).toEqual([
      { usage: usageSmall, ctx },
      { usage: usageMain, ctx },
    ]);
  });

  it('records nothing for no usage', async () => {
    const usage = memoryUsageMeter();
    await meter(env({ usage }), { usage: [], entitlement: demoEntitlementSubscription });
    expect(usage.rows).toEqual([]);
  });

  it('a failing port fails the step (the runner reports it)', async () => {
    const usage = { record: () => Promise.reject(new Error('queue down')) };
    await expect(
      meter(env({ usage }), { usage: [usageMain], entitlement: demoEntitlementSubscription }),
    ).rejects.toThrow('queue down');
  });
});

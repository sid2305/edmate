// Task 6.4: ScriptedGateway (rule 4, no real model calls). See docs/tasks/6.4/plan.md.
import { describe, expect, it, vi } from 'vitest';
import { LIMITS, type ModelGateway } from '@edmate/contracts';
import { summarizeSession } from './sessionSummary.js';
import { ScriptedGateway } from '../testing/scriptedGateway.js';
import { manualClock } from '../testing/clock.js';

const HISTORY = [
  { role: 'student' as const, text: 'Can you help me with fractions?' },
  { role: 'agent' as const, text: 'Sure, we can start with adding fractions.' },
];

describe('summarizeSession', () => {
  it('returns a <=60-word reply as-is', async () => {
    const gateway = new ScriptedGateway(
      { generateObject: [{ value: { summary: 'Covered adding fractions; practice next time.' } }] },
      manualClock(),
    );
    await expect(summarizeSession(gateway, HISTORY)).resolves.toBe(
      'Covered adding fractions; practice next time.',
    );
  });

  it('rejects an over-60-word reply, no value returned', async () => {
    const tooLong = Array.from({ length: LIMITS.lastSummaryMaxWords + 1 }, (_, i) => `word${i}`).join(
      ' ',
    );
    const gateway = new ScriptedGateway(
      { generateObject: [{ value: { summary: tooLong } }] },
      manualClock(),
    );
    await expect(summarizeSession(gateway, HISTORY)).rejects.toThrow();
  });

  it('returns undefined without calling the gateway for an empty session history', async () => {
    const gateway: Pick<ModelGateway, 'generateObject'> = {
      generateObject: vi.fn(() => {
        throw new Error('must not be called');
      }),
    };
    await expect(summarizeSession(gateway, [])).resolves.toBeUndefined();
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('propagates a gateway error unchanged', async () => {
    const gateway = new ScriptedGateway({ generateObject: [] }, manualClock());
    await expect(summarizeSession(gateway, HISTORY)).rejects.toThrow(/no scripted entry/);
  });
});

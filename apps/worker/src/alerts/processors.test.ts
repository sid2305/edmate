// The alert processor (task 4.3), on fakes (no Redis): raise → trust team; each escalation check
// → on-call unless acknowledged, and the next check is scheduled first (lead answer 4).
import type { SafetyAlert } from '@edmate/contracts';
import { demoSafetyAlert } from '@edmate/contracts/fixtures';
import { ALERT_ESCALATION_MS, alertJobOptions, JOB, type JobQueue } from '@edmate/queue';
import type { JobsOptions } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { PermanentJobError } from '../commit/processors.js';
import type { LogLine } from '../log.js';
import { alertProcessor } from './processors.js';
import type { AlertAudience } from './types.js';

const EXCERPT = 'EXCERPT-CANARY i want to kill myself';
const alert: SafetyAlert = { ...demoSafetyAlert, id: 'alert_1', excerptRedacted: EXCERPT };

function world(o: { acked?: boolean; notifyFails?: number; ackFails?: boolean } = {}) {
  const notified: { id: string; audience: AlertAudience }[] = [];
  const added: { name: string; data: unknown; opts: JobsOptions }[] = [];
  const lines: LogLine[] = [];
  let failures = o.notifyFails ?? 0;
  const queue: JobQueue = {
    add: (name, data, opts) => {
      added.push({ name, data, opts });
      return Promise.resolve();
    },
  };
  const process = alertProcessor({
    notifier: {
      notify(a, audience) {
        if (failures > 0) {
          failures--;
          return Promise.reject(new Error('mail relay down'));
        }
        notified.push({ id: a.id, audience });
        return Promise.resolve();
      },
    },
    ackStore: {
      acknowledge: () => Promise.resolve(),
      isAcknowledged: () =>
        o.ackFails === true ? Promise.reject(new Error('redis down')) : Promise.resolve(o.acked === true),
    },
    queue,
    escalateAfterMs: ALERT_ESCALATION_MS,
    log: (l) => lines.push(l),
  });
  return { process, notified, added, lines };
}

describe('alert.raise', () => {
  it('tells the trust team and logs ids only (never the excerpt)', async () => {
    const w = world();
    expect(await w.process({ id: 'alert_1.alert', name: JOB.alertRaise, data: { alert } })).toBe(
      'notified',
    );
    expect(w.notified).toEqual([{ id: 'alert_1', audience: 'trust_team' }]);
    expect(w.added).toEqual([]);
    expect(w.lines).toEqual([
      { level: 'info', event: 'safety_alert.notified', alertId: 'alert_1', audience: 'trust_team' },
    ]);
    expect(JSON.stringify(w.lines)).not.toContain('CANARY');
  }, 1_000);

  it('a notifier failure rejects (BullMQ retries it)', async () => {
    const w = world({ notifyFails: 1 });
    await expect(
      w.process({ name: JOB.alertRaise, data: { alert } }),
    ).rejects.toThrow('mail relay down');
  }, 1_000);

  it('a malformed payload is permanent (dead-lettered, not retried forever)', async () => {
    const w = world();
    await expect(w.process({ name: JOB.alertRaise, data: { alert: { id: 1 } } })).rejects.toThrow(
      PermanentJobError,
    );
  }, 1_000);
});

describe('alert.escalate_check', () => {
  const check = (round: number) => ({ name: JOB.alertEscalateCheck, data: { alert, round } });

  it('not acknowledged: schedules the next check first, then pages on-call', async () => {
    const w = world();
    expect(await w.process(check(0))).toBe('escalated');
    expect(w.added).toEqual([
      {
        name: JOB.alertEscalateCheck,
        data: { alert, round: 1 },
        opts: alertJobOptions('alert_1.escalate.1', ALERT_ESCALATION_MS),
      },
    ]);
    expect(w.notified).toEqual([{ id: 'alert_1', audience: 'on_call' }]);
    expect(w.lines.at(-1)).toEqual({
      level: 'warn',
      event: 'safety_alert.escalated',
      alertId: 'alert_1',
      round: 0,
    });
    expect(JSON.stringify(w.lines)).not.toContain('CANARY');
  }, 1_000);

  it('acknowledged: no page, no further check', async () => {
    const w = world({ acked: true });
    expect(await w.process(check(3))).toBe('acknowledged');
    expect(w.notified).toEqual([]);
    expect(w.added).toEqual([]);
  }, 1_000);

  it('a page that fails is retried; the retry re-adds the same next-check id (at most one pending)', async () => {
    const w = world({ notifyFails: 1 });
    await expect(w.process(check(0))).rejects.toThrow('mail relay down');
    expect(await w.process(check(0))).toBe('escalated');
    const ids = w.added.map((a) => a.opts.jobId);
    expect(ids).toEqual(['alert_1.escalate.1', 'alert_1.escalate.1']);
    expect(new Set(ids).size).toBe(1);
  }, 1_000);

  it('an ack-store failure rejects (retried), it never counts as acknowledged', async () => {
    const w = world({ ackFails: true });
    await expect(w.process(check(0))).rejects.toThrow('redis down');
    expect(w.notified).toEqual([]);
  }, 1_000);

  it('a malformed check payload is permanent', async () => {
    const w = world();
    await expect(
      w.process({ name: JOB.alertEscalateCheck, data: { alert, round: -2 } }),
    ).rejects.toThrow(PermanentJobError);
  }, 1_000);
});

it('an unknown job name is permanent', async () => {
  const w = world();
  await expect(w.process({ name: 'alert.other', data: {} })).rejects.toThrow(
    'alert.other: unknown alert job',
  );
}, 1_000);

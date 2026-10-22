// The alert processor (task 4.3; persistence in 12.5b), on fakes (no Redis, no DB): raise →
// record, then trust team; each escalation check → on-call unless acknowledged, and the next
// check is scheduled first (lead answer 4). The store's ack read is the source of truth (12.5b):
// a failed read counts as not acknowledged, and a failed escalation mark never stops a page.
import type { SafetyAlert } from '@edmate/contracts';
import { demoSafetyAlert } from '@edmate/contracts/fixtures';
import { ALERT_ESCALATION_MS, alertJobOptions, JOB, type JobQueue } from '@edmate/queue';
import type { JobsOptions } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { PermanentJobError } from '../commit/processors.js';
import type { LogLine } from '../log.js';
import { ALERT_NOTIFY_TIMEOUT_MS, alertProcessor, NotifyTimeoutError } from './processors.js';
import type { AlertAudience } from './types.js';

const EXCERPT = 'EXCERPT-CANARY i want to kill myself';
const alert: SafetyAlert = { ...demoSafetyAlert, id: 'alert_1', excerptRedacted: EXCERPT };

function world(
  o: {
    acked?: boolean;
    notifyFails?: number;
    ackFails?: boolean;
    recordFails?: boolean;
    markFails?: boolean;
  } = {},
) {
  const notified: { id: string; audience: AlertAudience }[] = [];
  const added: { name: string; data: unknown; opts: JobsOptions }[] = [];
  const recorded: SafetyAlert[] = [];
  const marked: { alert: SafetyAlert; round: number }[] = [];
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
    store: {
      record: (a) => {
        if (o.recordFails === true) return Promise.reject(new Error('insert failed'));
        recorded.push(a);
        return Promise.resolve({ written: true });
      },
      markEscalated: (a, round) => {
        if (o.markFails === true) return Promise.reject(new Error('update failed'));
        marked.push({ alert: a, round });
        return Promise.resolve({ round });
      },
      acknowledge: () => Promise.resolve(),
      isAcknowledged: () =>
        o.ackFails === true ? Promise.reject(new Error('db down')) : Promise.resolve(o.acked === true),
    },
    queue,
    escalateAfterMs: ALERT_ESCALATION_MS,
    log: (l) => lines.push(l),
  });
  return { process, notified, added, recorded, marked, lines };
}

describe('alert.raise', () => {
  it('records the alert, tells the trust team, and logs ids only (never the excerpt)', async () => {
    const w = world();
    expect(await w.process({ id: 'alert_1.alert', name: JOB.alertRaise, data: { alert } })).toBe(
      'notified',
    );
    expect(w.recorded).toEqual([alert]);
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

  it('a record failure still notifies, logs the error name, then throws so BullMQ retries', async () => {
    const w = world({ recordFails: true });
    await expect(w.process({ name: JOB.alertRaise, data: { alert } })).rejects.toThrow(
      'insert failed',
    );
    expect(w.notified).toEqual([{ id: 'alert_1', audience: 'trust_team' }]);
    expect(w.lines).toEqual([
      { level: 'info', event: 'safety_alert.notified', alertId: 'alert_1', audience: 'trust_team' },
      { level: 'error', event: 'safety_alert.store_failed', alertId: 'alert_1', error: 'Error' },
    ]);
    expect(JSON.stringify(w.lines)).not.toContain('CANARY');
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

  it('not acknowledged: schedules the next check first, marks the row escalated, then pages on-call', async () => {
    const w = world();
    expect(await w.process(check(0))).toBe('escalated');
    expect(w.added).toEqual([
      {
        name: JOB.alertEscalateCheck,
        data: { alert, round: 1 },
        opts: alertJobOptions('alert_1.escalate.1', ALERT_ESCALATION_MS),
      },
    ]);
    expect(w.marked).toEqual([{ alert, round: 0 }]);
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

  it('a failed ack read counts as not acknowledged: it pages and logs an error, never throws', async () => {
    const w = world({ ackFails: true });
    expect(await w.process(check(0))).toBe('escalated');
    expect(w.notified).toEqual([{ id: 'alert_1', audience: 'on_call' }]);
    expect(w.lines[0]).toEqual({
      level: 'error',
      event: 'safety_alert.ack_read_failed',
      alertId: 'alert_1',
      error: 'Error',
    });
  }, 1_000);

  it('a failed escalation mark never stops a page (logged, not thrown)', async () => {
    const w = world({ markFails: true });
    expect(await w.process(check(0))).toBe('escalated');
    expect(w.notified).toEqual([{ id: 'alert_1', audience: 'on_call' }]);
    expect(w.lines).toContainEqual({
      level: 'error',
      event: 'safety_alert.mark_escalated_failed',
      alertId: 'alert_1',
      round: 0,
      error: 'Error',
    });
  }, 1_000);

  it('a malformed check payload is permanent', async () => {
    const w = world();
    await expect(
      w.process({ name: JOB.alertEscalateCheck, data: { alert, round: -2 } }),
    ).rejects.toThrow(PermanentJobError);
  }, 1_000);
});

describe('a hung notifier', () => {
  const hung = (audience: AlertAudience) =>
    alertProcessor({
      notifier: {
        notify: (_a, au) => (au === audience ? new Promise<void>(() => undefined) : Promise.resolve()),
      },
      store: {
        record: () => Promise.resolve(),
        markEscalated: () => Promise.resolve(),
        acknowledge: () => Promise.resolve(),
        isAcknowledged: () => Promise.resolve(false),
      },
      queue: { add: () => Promise.resolve() },
      escalateAfterMs: ALERT_ESCALATION_MS,
      notifyTimeoutMs: 20,
      log: () => undefined,
    });

  it('the trust-team call times out and throws (BullMQ retries it)', async () => {
    await expect(hung('trust_team')({ name: JOB.alertRaise, data: { alert } })).rejects.toThrow(
      new NotifyTimeoutError('trust_team', 20),
    );
  }, 2_000);

  it('the on-call call times out and throws', async () => {
    await expect(
      hung('on_call')({ name: JOB.alertEscalateCheck, data: { alert, round: 0 } }),
    ).rejects.toBeInstanceOf(NotifyTimeoutError);
  }, 2_000);

  it('the default limit is 20 s', () => {
    expect(ALERT_NOTIFY_TIMEOUT_MS).toBe(20_000);
  }, 1_000);
});

it('an unknown job name is permanent', async () => {
  const w = world();
  await expect(w.process({ name: 'alert.other', data: {} })).rejects.toThrow(
    'alert.other: unknown alert job',
  );
}, 1_000);

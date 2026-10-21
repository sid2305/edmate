// The safety-alert producer (task 4.3): AlertSink on the alert queue. The escalation check is
// enqueued before the raise, so an alert is never lost even if the second write fails (lead
// answer 4). Job ids make a retried raise idempotent.
import { demoSafetyAlert } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  ALERT_ATTEMPTS,
  ALERT_BACKOFF_MAX_MS,
  ALERT_BACKOFF_START_MS,
  ALERT_BACKOFF_TYPE,
  ALERT_COMPLETED_TTL_SECONDS,
  ALERT_ESCALATION_MS,
  ALERT_QUEUE,
  AlertEscalateJobSchema,
  alertBackoffMs,
  alertJobOptions,
  AlertRaiseJobSchema,
  FAILED_JOB_TTL_SECONDS,
  JOB,
  jobId,
  queuedAlertSink,
} from '../src/index.js';
import { fakeQueue } from './fakeQueue.js';

const alert = { ...demoSafetyAlert, id: 'alert_1' };

describe('alert queue names, ids and options', () => {
  it('names the queue and jobs; ids are BullMQ-safe and per round', () => {
    expect(ALERT_QUEUE).toBe('edmate-safety-alert');
    expect([JOB.alertRaise, JOB.alertEscalateCheck]).toEqual(['alert.raise', 'alert.escalate_check']);
    expect(jobId.alertRaise('alert_1')).toBe('alert_1.alert');
    expect(jobId.alertEscalate('alert_1', 0)).toBe('alert_1.escalate.0');
    expect(jobId.alertEscalate('alert_1', 3)).toBe('alert_1.escalate.3');
  }, 5_000);

  it('the escalation default is 15 minutes', () => {
    expect(ALERT_ESCALATION_MS).toBe(15 * 60_000);
  }, 5_000);

  it('retries without a practical limit on a capped custom backoff; completed ids kept a day', () => {
    expect(alertJobOptions('a.alert')).toEqual({
      jobId: 'a.alert',
      attempts: ALERT_ATTEMPTS,
      backoff: { type: ALERT_BACKOFF_TYPE, delay: ALERT_BACKOFF_START_MS },
      removeOnComplete: { age: ALERT_COMPLETED_TTL_SECONDS },
      removeOnFail: { age: FAILED_JOB_TTL_SECONDS },
    });
    expect(ALERT_ATTEMPTS).toBeGreaterThanOrEqual(1_000_000);
    expect(alertJobOptions('a.escalate.0', 900_000)).toMatchObject({ delay: 900_000 });
  }, 5_000);

  it('backoff doubles from 1 s and is capped at 30 s, however many attempts', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => alertBackoffMs(n))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
    expect(alertBackoffMs(0)).toBe(ALERT_BACKOFF_START_MS);
    expect(alertBackoffMs(ALERT_ATTEMPTS)).toBe(ALERT_BACKOFF_MAX_MS);
    expect(alertBackoffMs(3, 50, 120)).toBe(120);
  }, 5_000);

  it('six failed deliveries in a row still deliver within 5 minutes (61 s of backoff)', () => {
    const waited = [1, 2, 3, 4, 5, 6].reduce((sum, n) => sum + alertBackoffMs(n), 0);
    expect(waited).toBe(61_000);
    expect(waited).toBeLessThan(5 * 60_000);
  }, 5_000);

  it('payload schemas: the alert, plus the round for an escalation check', () => {
    expect(AlertRaiseJobSchema.parse({ alert })).toEqual({ alert });
    expect(AlertEscalateJobSchema.parse({ alert, round: 2 })).toEqual({ alert, round: 2 });
    expect(AlertEscalateJobSchema.safeParse({ alert, round: -1 }).success).toBe(false);
    expect(AlertRaiseJobSchema.safeParse({ alert, extra: 1 }).success).toBe(false);
  }, 5_000);
});

describe('queuedAlertSink', () => {
  it('enqueues the 15-minute escalation check first, then the raise', async () => {
    const q = fakeQueue();
    await queuedAlertSink(q).raise(alert);
    expect(q.added).toEqual([
      {
        name: JOB.alertEscalateCheck,
        data: { alert, round: 0 },
        opts: alertJobOptions('alert_1.escalate.0', ALERT_ESCALATION_MS),
      },
      { name: JOB.alertRaise, data: { alert }, opts: alertJobOptions('alert_1.alert') },
    ]);
  }, 5_000);

  it('takes a shorter escalation delay (tests)', async () => {
    const q = fakeQueue();
    await queuedAlertSink(q, { escalateAfterMs: 50 }).raise(alert);
    expect(q.added[0]?.opts.delay).toBe(50);
  }, 5_000);

  it('rejects a non-positive delay at construction', () => {
    expect(() => queuedAlertSink(fakeQueue(), { escalateAfterMs: 0 })).toThrow(TypeError);
  }, 5_000);

  it('a retried raise re-adds the same job ids (BullMQ keeps one job per id)', async () => {
    const q = fakeQueue();
    const sink = queuedAlertSink(q);
    await sink.raise(alert);
    await sink.raise(alert);
    expect(q.added.map((j) => j.opts.jobId)).toEqual([
      'alert_1.escalate.0',
      'alert_1.alert',
      'alert_1.escalate.0',
      'alert_1.alert',
    ]);
  }, 5_000);

  it('an invalid alert is refused before anything is enqueued', async () => {
    const q = fakeQueue();
    await expect(queuedAlertSink(q).raise({ ...alert, id: 'bad id!' })).rejects.toThrow();
    expect(q.added).toEqual([]);
  }, 5_000);

  it('a queue failure rejects, so the runner retries the raise', async () => {
    await expect(queuedAlertSink(fakeQueue({ fail: true })).raise(alert)).rejects.toThrow(
      'redis down',
    );
  }, 5_000);
});

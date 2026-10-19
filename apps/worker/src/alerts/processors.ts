// The safety-alert processor (task 4.3).
//
// - `alert.raise`: tell the trust team.
// - `alert.escalate_check` (round n, 15 minutes after the raise and then every 15 minutes): if
//   nobody acknowledged the alert, schedule round n+1 first, then page on-call. Acknowledged: stop.
//
// Every failure but a malformed payload is retried with no practical attempt limit (the job
// options in @edmate/queue), so an alert is retried until delivered. A retried step may notify
// twice: an extra notification is safer than a missed one. Round ids (`<alertId>.escalate.<n>`)
// keep at most one pending check per alert. Log lines carry ids only, never the excerpt.
import {
  AlertEscalateJobSchema,
  alertJobOptions,
  AlertRaiseJobSchema,
  JOB,
  type JobQueue,
  jobId,
} from '@edmate/queue';
import { PermanentJobError } from '../commit/processors.js';
import type { Log } from '../log.js';
import type { AckStore, AlertAudience, AlertNotifier } from './types.js';

/** A notifier call that takes longer fails (and is retried): a hung vendor must not stall it. */
export const ALERT_NOTIFY_TIMEOUT_MS = 20_000;

/** The notifier did not answer in time. Names the audience and the limit, nothing else. */
export class NotifyTimeoutError extends Error {
  override readonly name = 'NotifyTimeoutError';
  constructor(audience: AlertAudience, ms: number) {
    super(`alert notify to ${audience} timed out after ${ms} ms`);
  }
}

export interface AlertJob {
  id?: string | undefined;
  name: string;
  data: unknown;
}

export type AlertJobOutcome = 'notified' | 'escalated' | 'acknowledged';

export interface AlertProcessorDeps {
  notifier: AlertNotifier;
  ackStore: AckStore;
  /** The alert queue itself, for the next escalation check. */
  queue: JobQueue;
  /** Time between escalation checks (ALERT_ESCALATION_MS; tests shorten it). */
  escalateAfterMs: number;
  /** Per notifier call (default ALERT_NOTIFY_TIMEOUT_MS). */
  notifyTimeoutMs?: number;
  log: Log;
}

function parse<T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  job: AlertJob,
): T {
  const r = schema.safeParse(job.data);
  if (!r.success) throw new PermanentJobError(`${job.name}: invalid job payload`);
  return r.data;
}

export function alertProcessor(d: AlertProcessorDeps) {
  const limit = d.notifyTimeoutMs ?? ALERT_NOTIFY_TIMEOUT_MS;
  const notify = async (alert: Parameters<AlertNotifier['notify']>[0], audience: AlertAudience) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new NotifyTimeoutError(audience, limit));
      }, limit);
    });
    try {
      await Promise.race([d.notifier.notify(alert, audience), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
  return async (job: AlertJob): Promise<AlertJobOutcome> => {
    switch (job.name) {
      case JOB.alertRaise: {
        const { alert } = parse(AlertRaiseJobSchema, job);
        await notify(alert, 'trust_team');
        d.log({
          level: 'info',
          event: 'safety_alert.notified',
          alertId: alert.id,
          audience: 'trust_team',
        });
        return 'notified';
      }
      case JOB.alertEscalateCheck: {
        const { alert, round } = parse(AlertEscalateJobSchema, job);
        if (await d.ackStore.isAcknowledged(alert.id)) return 'acknowledged';
        const next = round + 1;
        await d.queue.add(
          JOB.alertEscalateCheck,
          { alert, round: next },
          alertJobOptions(jobId.alertEscalate(alert.id, next), d.escalateAfterMs),
        );
        await notify(alert, 'on_call');
        d.log({ level: 'warn', event: 'safety_alert.escalated', alertId: alert.id, round });
        return 'escalated';
      }
      default:
        throw new PermanentJobError(`${job.name}: unknown alert job`);
    }
  };
}

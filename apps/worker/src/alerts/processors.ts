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
import type { AckStore, AlertNotifier } from './types.js';

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
  return async (job: AlertJob): Promise<AlertJobOutcome> => {
    switch (job.name) {
      case JOB.alertRaise: {
        const { alert } = parse(AlertRaiseJobSchema, job);
        await d.notifier.notify(alert, 'trust_team');
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
        await d.notifier.notify(alert, 'on_call');
        d.log({ level: 'warn', event: 'safety_alert.escalated', alertId: alert.id, round });
        return 'escalated';
      }
      default:
        throw new PermanentJobError(`${job.name}: unknown alert job`);
    }
  };
}
